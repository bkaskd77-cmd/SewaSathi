import { describe, expect, it } from "vitest";

import {
  afterSecurity,
  authenticatedAt,
  stepUpBlocks,
  stepUpFor,
  STEP_UP_HOURS,
} from "@/lib/auth/step-up";

/**
 * The admin second-factor gate.
 *
 * The case worth the file is `enrol`: an admin who has never set up a factor
 * must be sent to the enrolment screen rather than refused, or the commit that
 * protects the only admin account in the product is the commit that locks it
 * out of itself.
 */

const now = new Date("2026-09-24T12:00:00Z");
const hoursAgo = (n: number) => new Date(now.getTime() - n * 60 * 60 * 1000);

const admin = {
  role: "admin",
  hasFactor: true,
  verified: true,
  verifiedAt: hoursAgo(1),
  now,
};

describe("who the gate applies to", () => {
  it("does not apply to a customer or a professional", () => {
    for (const role of ["customer", "provider"]) {
      expect(
        stepUpFor({ ...admin, role, hasFactor: false, verified: false }),
      ).toBe("not-required");
    }
  });

  it("applies to an admin", () => {
    expect(stepUpFor(admin)).toBe("ok");
  });
});

describe("an admin who has never enrolled", () => {
  /*
   * THE LOCKOUT CASE. This is why the gate can ship before anybody has a
   * factor: it sends them to set one up rather than refusing them, so the
   * account that needs the enrolment screen can always reach it.
   */
  it("is sent to enrol, not refused", () => {
    expect(
      stepUpFor({ ...admin, hasFactor: false, verified: false, verifiedAt: null }),
    ).toBe("enrol");
  });

  it("still counts as blocked from the queues", () => {
    // Blocked from the admin screens, but with somewhere to go — the two are
    // different facts and the middleware needs both.
    expect(stepUpBlocks("enrol")).toBe(true);
  });
});

describe("the window", () => {
  it("lets a verified session straight through", () => {
    expect(stepUpFor({ ...admin, verifiedAt: hoursAgo(0) })).toBe("ok");
  });

  it("challenges a session that never used the factor", () => {
    expect(stepUpFor({ ...admin, verified: false, verifiedAt: null })).toBe(
      "challenge",
    );
  });

  it("challenges again once the window has passed", () => {
    expect(stepUpFor({ ...admin, verifiedAt: hoursAgo(STEP_UP_HOURS) })).toBe(
      "challenge",
    );
    expect(stepUpFor({ ...admin, verifiedAt: hoursAgo(24) })).toBe("challenge");
  });

  it("holds right up to the boundary", () => {
    expect(
      stepUpFor({ ...admin, verifiedAt: hoursAgo(STEP_UP_HOURS - 0.01) }),
    ).toBe("ok");
  });

  /*
   * ABSOLUTE, NOT SLIDING. The verdict is a function of when the code was
   * typed and nothing else — no activity renews it. A sliding window renews
   * itself for ever on a machine somebody left open, which is the scenario
   * this exists for.
   */
  it("is not renewed by anything but typing a code", () => {
    const stale = { ...admin, verifiedAt: hoursAgo(STEP_UP_HOURS + 1) };
    expect(stepUpFor(stale)).toBe("challenge");
    // An hour later it is still challenge, not "more expired". There is no
    // state here but the timestamp.
    expect(
      stepUpFor({ ...stale, now: new Date(now.getTime() + 3600_000) }),
    ).toBe("challenge");
  });

  /*
   * A CLAIM THAT IS ABSENT IS NOT EVIDENCE THE WINDOW IS OPEN. Getting this
   * backwards would grant access on a malformed token rather than refuse it.
   */
  it("treats a verified session with no timestamp as expired", () => {
    expect(stepUpFor({ ...admin, verified: true, verifiedAt: null })).toBe(
      "challenge",
    );
  });
});

describe("what the number is", () => {
  it("is one working day, and one constant", () => {
    // Named here so changing it is a decision somebody makes on purpose, in a
    // commit that says why.
    expect(STEP_UP_HOURS).toBe(8);
  });
});

/**
 * The return trip, which did not exist.
 *
 * `/admin` bounces an un-enrolled admin to `/account/security?next=/admin`,
 * and the screen ignored the parameter entirely — so somebody who set up their
 * authenticator was left sitting on the security page with no way back, having
 * never been told why they were sent there. Carrying `next` and then dropping
 * it is worse than not carrying it: the product asked for something, got it,
 * and did nothing with it.
 *
 * Null means stay. A path means go. It must not send anybody back before the
 * gate they were bounced by would actually let them through, or they arrive
 * and get bounced straight here again.
 */
describe("where somebody goes after satisfying the security screen", () => {
  const ready = { next: "/admin", hasFactor: true, needsCode: false };

  it("returns them once the factor exists and is proved", () => {
    expect(afterSecurity(ready)).toBe("/admin");
  });

  it("keeps them here while there is no factor at all", () => {
    expect(afterSecurity({ ...ready, hasFactor: false })).toBeNull();
  });

  it("keeps them here while a code is still owed", () => {
    // Enrolled, but this session has not proved it. Returning now means
    // arriving at /admin and being bounced straight back.
    expect(afterSecurity({ ...ready, needsCode: true })).toBeNull();
  });

  it("stays put when they came here on their own", () => {
    // No `next` means nobody sent them; they opened their own settings.
    expect(afterSecurity({ ...ready, next: "/" })).toBeNull();
  });
});

describe("when this session last proved who it is", () => {
  /**
   * THE BUG THIS EXISTS TO STOP, AND IT SHIPPED. `changeDestination` refuses a
   * session that has not re-authenticated inside `REAUTH_WINDOW_MINUTES`, and
   * the timestamp it was given came from the access token's `iat`. A Supabase
   * access token is refreshed silently, and a refresh mints a NEW token with a
   * NEW `iat` — so for any session that stays active, `iat` is always minutes
   * old. The gate read "recently active", which is exactly what a stolen
   * session is.
   *
   * `amr` is the claim that survives a refresh, because it describes the
   * session's authentication events rather than the token carrying them. The
   * correct rule was already written down one function away: `mfaState` reads
   * `amr` under a comment saying the timestamp is "the moment of verification,
   * which is what the re-challenge window is measured from — not the session's
   * start, and not now".
   *
   * These cases are pure on purpose. Proving it end to end needs a real session
   * left alone for an hour; this pins the judgement without one, which is why
   * every other decision in this file is pure too.
   */

  const HOUR = 60 * 60;
  const NOW = new Date("2026-10-01T12:00:00Z");
  const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

  it("refuses a refreshed token whose authentication is old", () => {
    /*
     * THE CASE THE WHOLE FIX IS FOR. `iat` one minute ago because the token was
     * just refreshed; `amr` six hours ago because that is when somebody last
     * typed a code. Reading `iat` accepts this. Reading `amr` refuses it.
     */
    const at = authenticatedAt({
      iat: seconds(NOW) - 60,
      amr: [{ method: "otp", timestamp: seconds(NOW) - 6 * HOUR }],
    });

    expect(at).not.toBeNull();
    expect(seconds(at!)).toBe(seconds(NOW) - 6 * HOUR);
  });

  it("takes the most recent method, not the first", () => {
    // A second factor used minutes ago is a proof of identity; this morning's
    // OTP is not. The newest entry is the answer whatever order they arrive in.
    const at = authenticatedAt({
      amr: [
        { method: "otp", timestamp: seconds(NOW) - 6 * HOUR },
        { method: "totp", timestamp: seconds(NOW) - 120 },
      ],
    });

    expect(seconds(at!)).toBe(seconds(NOW) - 120);
  });

  it("ignores iat even when iat is older, because it answers a different question", () => {
    // Not a preference for the larger number: `iat` is never the answer. A
    // clock skew or a long-lived token must not move an authentication time.
    const at = authenticatedAt({
      iat: seconds(NOW) - 12 * HOUR,
      amr: [{ method: "otp", timestamp: seconds(NOW) - 60 }],
    });

    expect(seconds(at!)).toBe(seconds(NOW) - 60);
  });

  it("is null when there is no amr at all", () => {
    /*
     * A claim that is absent is not evidence the window is open — `stepUpFor`'s
     * own rule for a missing timestamp, applied where guessing wrong hands
     * somebody's earnings to a stranger. `isFresh` treats null as expired.
     */
    expect(authenticatedAt({ iat: seconds(NOW) })).toBeNull();
    expect(authenticatedAt({ amr: [] })).toBeNull();
    expect(authenticatedAt({})).toBeNull();
  });

  it("ignores an entry with no usable timestamp rather than trusting the method", () => {
    // A method name without a time says something happened and not when.
    expect(authenticatedAt({ amr: [{ method: "otp" }] })).toBeNull();
    expect(
      authenticatedAt({ amr: [{ method: "otp", timestamp: Number.NaN }] }),
    ).toBeNull();
  });
});
