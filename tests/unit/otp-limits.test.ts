import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The door into the product, and the ceilings on it.
 *
 * Until Phase 9 this ran in the browser: `lib/auth/otp.ts` was `"use client"`,
 * so every request went from the visitor's phone straight to Supabase and NONE
 * of these limits existed. The only thing between an attacker and a flood of
 * paid SMS — or an unlimited guess at a six-digit code — was the provider's
 * own defaults.
 *
 * These cases would all have failed before the move, because there was nothing
 * on our side to fail. They are the proof that the send now happens somewhere
 * we control.
 */

const signInWithOtp = vi.fn();
const verifyOtpCall = vi.fn();
const maybeSingle = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => verifyOtpCall(...args),
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }),
    }),
  }),
}));

const recorded: Array<Record<string, unknown>> = [];
vi.mock("@/lib/audit", () => ({
  recordSecurityEvent: async (event: Record<string, unknown>) => {
    recorded.push(event);
  },
}));

/*
 * Imported normally rather than with a top-level await: the tsconfig's module
 * target does not allow one, and `vi.mock` is hoisted above these anyway, so
 * the mocks are in place before either module is evaluated.
 */
import { sendOtp, verifyOtp } from "@/lib/auth/otp";
import { LIMITS, resetRateLimits } from "@/lib/server/rate-limit";

const NUMBER = "+9779841234567";
const OTHER = "+9779800000001";

beforeEach(() => {
  resetRateLimits();
  recorded.length = 0;
  signInWithOtp.mockReset().mockResolvedValue({ error: null });
  verifyOtpCall.mockReset();
  maybeSingle.mockReset().mockResolvedValue({ data: { full_name: "Bikas" } });
});

describe("one number cannot be used to send an unlimited number of messages", () => {
  it("sends up to the ceiling", async () => {
    for (let i = 0; i < LIMITS["otp:number"].perMinute; i += 1) {
      expect((await sendOtp(NUMBER, { ip: "1.1.1.1" })).ok).toBe(true);
    }
    expect(signInWithOtp).toHaveBeenCalledTimes(LIMITS["otp:number"].perMinute);
  });

  it("refuses the one after it, and does not pay for the SMS", async () => {
    // The point is the second assertion: a refusal that still calls the
    // provider has cost us the message it was meant to prevent.
    for (let i = 0; i < LIMITS["otp:number"].perMinute; i += 1) {
      await sendOtp(NUMBER, { ip: "1.1.1.1" });
    }
    signInWithOtp.mockClear();

    const outcome = await sendOtp(NUMBER, { ip: "1.1.1.1" });

    expect(outcome).toMatchObject({ ok: false, error: "tooManyRequests" });
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it("counts a different number separately", async () => {
    for (let i = 0; i < LIMITS["otp:number"].perMinute; i += 1) {
      await sendOtp(NUMBER, { ip: "1.1.1.1" });
    }
    expect((await sendOtp(OTHER, { ip: "1.1.1.1" })).ok).toBe(true);
  });
});

describe("one network cannot walk the number space", () => {
  it("refuses past the per-IP ceiling even with a fresh number each time", async () => {
    // The per-number limit is useless against somebody trying a different
    // number every time; this is the ceiling that answers that.
    let refused = false;
    for (let i = 0; i < LIMITS["otp:ip"].perMinute + 1; i += 1) {
      const outcome = await sendOtp(`+97798000${String(i).padStart(5, "0")}`, {
        ip: "9.9.9.9",
      });
      if (!outcome.ok) refused = true;
    }
    expect(refused).toBe(true);
  });

  it("is looser than the per-number one, because an office is one address", async () => {
    // Locking a whole building out of signing in is worse than the flood it
    // prevents, so this ceiling is deliberately the higher of the two.
    expect(LIMITS["otp:ip"].perMinute).toBeGreaterThan(
      LIMITS["otp:number"].perMinute,
    );
  });
});

describe("a six-digit code cannot be guessed", () => {
  beforeEach(() => {
    verifyOtpCall.mockResolvedValue({
      data: { user: null },
      error: { status: 403, message: "Token has expired or is invalid" },
    });
  });

  it("locks out after the attempt ceiling", async () => {
    for (let i = 0; i < LIMITS["otp:attempt"].perMinute; i += 1) {
      await verifyOtp(NUMBER, "000000", { ip: "1.1.1.1" });
    }
    verifyOtpCall.mockClear();

    const outcome = await verifyOtp(NUMBER, "000000", { ip: "1.1.1.1" });

    expect(outcome).toMatchObject({ ok: false, error: "tooManyRequests" });
    // Refused before the provider is asked, so a locked-out attacker cannot
    // even learn whether the code was right.
    expect(verifyOtpCall).not.toHaveBeenCalled();
  });

  it("spends the budget on correct guesses too", async () => {
    /*
     * The ceiling is consumed BEFORE the attempt, not only on failure.
     * Otherwise an attacker whose guess happens to be right pays nothing for
     * it, and the budget only ever limits the guesses that were going to fail
     * anyway.
     */
    verifyOtpCall.mockResolvedValue({
      data: { user: { id: "user-1" } },
      error: null,
    });

    for (let i = 0; i < LIMITS["otp:attempt"].perMinute; i += 1) {
      await verifyOtp(NUMBER, "123456", { ip: "1.1.1.1" });
    }
    const outcome = await verifyOtp(NUMBER, "123456", { ip: "1.1.1.1" });
    expect(outcome).toMatchObject({ ok: false, error: "tooManyRequests" });
  });

  it("records the lockout where an admin can see it", async () => {
    for (let i = 0; i < LIMITS["otp:attempt"].perMinute + 1; i += 1) {
      await verifyOtp(NUMBER, "000000", { ip: "1.1.1.1" });
    }
    expect(
      recorded.some(
        (event) =>
          event.kind === "auth.otpFailed" &&
          (event.detail as { refused?: string })?.refused === "lockedOut",
      ),
    ).toBe(true);
  });
});

describe("nothing reveals whether a number is one of our customers", () => {
  it("answers identically for a number that exists and one that does not", async () => {
    // `signInWithOtp` creates the account when there is none, so there is no
    // difference to leak — and this asserts we have not introduced one.
    const known = await sendOtp(NUMBER, { ip: "1.1.1.1" });
    resetRateLimits();
    const unknown = await sendOtp("+9779812121212", { ip: "1.1.1.1" });

    expect(known).toEqual(unknown);
  });

  it("answers identically when the provider fails, whatever the number", async () => {
    signInWithOtp.mockResolvedValue({
      error: { status: 500, message: "Error sending confirmation sms" },
    });

    const first = await sendOtp(NUMBER, { ip: "1.1.1.1" });
    resetRateLimits();
    const second = await sendOtp("+9779812121212", { ip: "1.1.1.1" });

    expect(first).toEqual(second);
  });
});

describe("the phone number is not the key", () => {
  it("never writes a raw number into the audit log", async () => {
    /*
     * The rate-limit keys reach a third party's Redis and the audit log is
     * read by people. A list of either must not be a list of every number that
     * has tried to sign in, so both carry a hash.
     */
    await sendOtp(NUMBER, { ip: "1.1.1.1" });

    const serialised = JSON.stringify(recorded);
    expect(serialised).not.toContain(NUMBER);
    expect(serialised).not.toContain("9841234567");
  });
});
