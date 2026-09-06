import { describe, expect, it } from "vitest";

import { CATEGORY_SEED } from "@/lib/config/services";
import {
  CLAIM_VERDICTS,
  EXCLUSIONS,
  GUARANTEE_WINDOWS,
  MAX_CLAIMS_PER_BOOKING,
  claimIsAllowed,
  claimOutcome,
  guaranteeExpiresAt,
  guaranteeFor,
  isWithinGuarantee,
  whoPays,
  type ClaimRequest,
} from "@/lib/config/guarantee";

/**
 * The guarantee.
 *
 * Two things are being protected here and they pull in opposite directions.
 *
 * The first is the promise: a customer told on the payment screen that a
 * window exists must find that window is real, is the right one for their
 * trade, and is not quietly a day shorter than published.
 *
 * The second is that the promise cannot be farmed. The version of this policy
 * that pays out automatically after two failed visits is a repeatable route to
 * free work for anybody willing to describe a different problem each time in
 * the same trade. `claimOutcome` is what closes that, and the test that
 * matters most in this file is the one asserting no verdict — none of them,
 * ever — produces a refund without a person.
 */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const FINISHED = new Date("2026-09-01T10:00:00Z");

function after(ms: number): Date {
  return new Date(FINISHED.getTime() + ms);
}

describe("every service we sell has a window", () => {
  it("covers all ten seeded categories", () => {
    // Exhaustive over the seed on purpose. Adding a trade without deciding its
    // window should fail here rather than silently fall through to the default
    // — the default exists for data drift in production, not as an answer.
    for (const category of CATEGORY_SEED) {
      expect(
        GUARANTEE_WINDOWS[category.slug],
        `no guarantee window for "${category.slug}"`,
      ).toBeDefined();
    }
  });

  it("does not use one number for every trade", () => {
    // The whole point of the change. A single figure across ten trades is
    // meaningless for cleaning and arbitrary for painting.
    const distinct = new Set(
      Object.values(GUARANTEE_WINDOWS).map((window) => window.days),
    );
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("gives a repair 30 days, painting 90, and cleaning 48 hours", () => {
    expect(guaranteeFor("plumbing").days).toBe(30);
    expect(guaranteeFor("painting").days).toBe(90);
    expect(guaranteeFor("home-cleaning").days).toBe(2);
    expect(guaranteeFor("home-cleaning").kind).toBe("reclean");
    expect(guaranteeFor("movers-packers").kind).toBe("report");
  });

  it("falls back to the ordinary repair window rather than to nothing", () => {
    // A category added to the database and not to this file must not leave a
    // customer with a guarantee that silently covers zero days.
    expect(guaranteeFor("a-trade-we-have-not-written-down").days).toBe(30);
  });

  it("gives every window a label the catalogue can render", () => {
    for (const window of Object.values(GUARANTEE_WINDOWS)) {
      expect(["d30", "d90", "h48"]).toContain(window.labelKey);
    }
  });
});

describe("the window boundary", () => {
  it("is inside on day 29 of a 30-day repair", () => {
    expect(isWithinGuarantee("plumbing", FINISHED, after(29 * DAY))).toBe(true);
  });

  it("is outside on day 31", () => {
    expect(isWithinGuarantee("plumbing", FINISHED, after(31 * DAY))).toBe(false);
  });

  it("closes exactly on the published day, not a day later", () => {
    // A boundary has to fall on one side. The published number is the promise,
    // not the promise plus a day.
    expect(guaranteeExpiresAt("plumbing", FINISHED).getTime()).toBe(
      FINISHED.getTime() + 30 * DAY,
    );
    expect(isWithinGuarantee("plumbing", FINISHED, after(30 * DAY))).toBe(false);
  });

  it("keeps painting open at 60 days, where a repair would have closed", () => {
    expect(isWithinGuarantee("painting", FINISHED, after(60 * DAY))).toBe(true);
    expect(isWithinGuarantee("plumbing", FINISHED, after(60 * DAY))).toBe(false);
  });

  it("closes a clean at 72 hours and keeps it open at 24", () => {
    expect(isWithinGuarantee("home-cleaning", FINISHED, after(24 * HOUR))).toBe(
      true,
    );
    expect(isWithinGuarantee("home-cleaning", FINISHED, after(72 * HOUR))).toBe(
      false,
    );
  });

  it("treats an unparseable date as outside rather than as forever", () => {
    expect(isWithinGuarantee("plumbing", "not a date", after(DAY))).toBe(false);
  });
});

describe("the visit is the verification", () => {
  it("bills the professional only when the same fault came back", () => {
    expect(whoPays("sameFault")).toBe("provider");
    expect(claimOutcome("sameFault").free).toBe(true);
  });

  it("bills the customer for a different problem", () => {
    // THE HOLE THIS CLOSES. "Same subject, different issue" is a new job at
    // the ordinary price — not a free visit that can be repeated.
    expect(whoPays("differentProblem")).toBe("customer");
    expect(claimOutcome("differentProblem").free).toBe(false);
  });

  it("bills the customer when nothing is wrong, or they caused it", () => {
    expect(whoPays("nothingWrong")).toBe("customer");
    expect(whoPays("customerCaused")).toBe("customer");
  });

  it("never produces a refund without a person — for any verdict", () => {
    // The single most important assertion in this file. A re-do costs us
    // almost nothing because the labour is the professional's; a refund costs
    // real money. If a verdict could ever settle one on its own, the policy
    // becomes farmable again.
    for (const verdict of CLAIM_VERDICTS) {
      expect(claimOutcome(verdict).refund).toBe("person");
    }
  });

  it("has a verdict for every way a visit can end", () => {
    expect([...CLAIM_VERDICTS].sort()).toEqual([
      "customerCaused",
      "differentProblem",
      "nothingWrong",
      "sameFault",
    ]);
  });
});

describe("what the guarantee excludes", () => {
  it("excludes consequential damage", () => {
    // The line that keeps liability bounded. "Guarantee" with no scope reads
    // as everything, including the water the failed pipe let out.
    expect(EXCLUSIONS).toContain("consequential");
  });

  it("excludes a different fault, declined work and supplied parts", () => {
    expect(EXCLUSIONS).toContain("differentFault");
    expect(EXCLUSIONS).toContain("declinedWork");
    expect(EXCLUSIONS).toContain("suppliedParts");
  });
});

describe("who may claim, decided before anybody looks", () => {
  const base: ClaimRequest = {
    categorySlug: "plumbing",
    status: "completed",
    settled: true,
    completedAt: FINISHED,
    openClaims: 0,
    totalClaims: 0,
    now: after(3 * DAY),
  };

  it("allows a first claim on a finished, paid job inside the window", () => {
    const verdict = claimIsAllowed(base);
    expect(verdict.allowed).toBe(true);
    expect(verdict.allowed && verdict.guarantee.days).toBe(30);
  });

  it("refuses a job that is not finished", () => {
    const verdict = claimIsAllowed({ ...base, status: "in_progress" });
    expect(!verdict.allowed && verdict.reason).toBe("notCompleted");
  });

  it("refuses a job that was never paid for", () => {
    // There is nothing to guarantee against a figure that was never recorded,
    // which is exactly what the cash screen tells the customer.
    const verdict = claimIsAllowed({ ...base, settled: false });
    expect(!verdict.allowed && verdict.reason).toBe("notSettled");
  });

  it("refuses a second claim while one is still open", () => {
    const verdict = claimIsAllowed({ ...base, openClaims: 1, totalClaims: 1 });
    expect(!verdict.allowed && verdict.reason).toBe("claimOpen");
  });

  it("refuses a third claim on one booking", () => {
    const verdict = claimIsAllowed({
      ...base,
      totalClaims: MAX_CLAIMS_PER_BOOKING,
    });
    expect(!verdict.allowed && verdict.reason).toBe("limitReached");
  });

  it("allows a second claim once the first has closed", () => {
    expect(
      claimIsAllowed({ ...base, openClaims: 0, totalClaims: 1 }).allowed,
    ).toBe(true);
  });

  it("refuses once the window has closed", () => {
    const verdict = claimIsAllowed({ ...base, now: after(45 * DAY) });
    expect(!verdict.allowed && verdict.reason).toBe("outsideWindow");
  });

  it("refuses a job with no completion date at all", () => {
    const verdict = claimIsAllowed({ ...base, completedAt: null });
    expect(!verdict.allowed && verdict.reason).toBe("outsideWindow");
  });

  it("applies the cleaning window, not the repair one, to a clean", () => {
    // The bug this prevents is a claim path that reads one number for every
    // trade — a house clean guaranteed for thirty days.
    const clean = {
      ...base,
      categorySlug: "home-cleaning",
      now: after(3 * DAY),
    };
    expect(!claimIsAllowed(clean).allowed).toBe(true);
    expect(claimIsAllowed({ ...clean, now: after(12 * HOUR) }).allowed).toBe(
      true,
    );
  });
});
