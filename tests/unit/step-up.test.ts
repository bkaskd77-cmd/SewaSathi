import { describe, expect, it } from "vitest";

import { stepUpBlocks, stepUpFor, STEP_UP_HOURS } from "@/lib/auth/step-up";

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
