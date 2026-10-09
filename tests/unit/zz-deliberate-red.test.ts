import { describe, expect, it } from "vitest";

/**
 * A deliberately failing test, pushed on purpose, reverted immediately.
 *
 * WHY THIS EXISTS FOR ONE COMMIT. `LAUNCH-BLOCKERS.md § ci-gates-deploy` is open on one
 * unwitnessed case: a commit whose CI has COMPLETED AND FAILED, skipped by the gate with
 * that reason in the Vercel log. The other two halves are proven — an unverified commit
 * was seen refused and a green one was seen deployed — and this one cannot happen by
 * accident, because the deploy hook only fires from a green `verify`. So it has to be
 * done deliberately, once.
 *
 * NOTHING ABOUT THE PRODUCT IS BROKEN BY IT. The application code in this commit is the
 * code that passed on the commit before; the only red thing is the line below. If the
 * gate were to fail and deploy this commit anyway, production would serve exactly what
 * it serves now — which is what makes this a safe experiment rather than a brave one.
 */
describe("the deploy gate", () => {
  it("fails on purpose, so a red commit can be seen being refused", () => {
    expect("red").toBe("green");
  });
});
