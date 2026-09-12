import { describe, expect, it } from "vitest";

import {
  MINIMUM_AGE,
  ageOn,
  judgeAge,
  judgeReference,
  payoutIsSomebodyElses,
  samePhone,
} from "@/lib/verification";

/**
 * Three fields the form collected, showed to a reviewer, and never checked.
 *
 * All three were found by walking the application rather than by reading it,
 * and all three had the same shape: a number in a box is not a fact until
 * something asks whether it can be true.
 */

const APPLICANT = "9779800000012";

describe("samePhone", () => {
  it("sees through the ways one number gets written", () => {
    // Every rule below is trivially defeated if this is wrong — typing +977 in
    // front of a number would make it a different person.
    for (const written of [
      "9843119897",
      "+9779843119897",
      "9779843119897",
      "+977 9843 119 897",
      "09843119897",
    ]) {
      expect(samePhone(written, "9843119897")).toBe(true);
    }
  });

  it("reads Devanagari numerals as the same number", () => {
    // Entered by real people on real phones set to Nepali.
    expect(samePhone("९८४३११९८९७", "9843119897")).toBe(true);
  });

  it("does not call two different numbers the same", () => {
    expect(samePhone("9843119897", "9843119898")).toBe(false);
  });

  it("treats an empty value as matching nothing", () => {
    // Otherwise two applicants with no number recorded would look identical.
    expect(samePhone("", "")).toBe(false);
    expect(samePhone(null, undefined)).toBe(false);
  });
});

describe("references must be two different people", () => {
  it("refuses the applicant's own number", () => {
    // Straight from the walkthrough: both references were the applicant.
    expect(
      judgeReference({
        phone: "+9779800000012",
        applicantPhone: APPLICANT,
        existing: [],
      }),
    ).toBe("sameAsApplicant");
  });

  it("refuses a number already listed, however it is written", () => {
    // The second reference in the screenshot was the same number as the
    // first. Writing it differently must not get it past.
    expect(
      judgeReference({
        phone: "+977 9843 119 897",
        applicantPhone: APPLICANT,
        existing: ["9843119897"],
      }),
    ).toBe("alreadyListed");
  });

  it("accepts a genuine second person", () => {
    expect(
      judgeReference({
        phone: "9841234567",
        applicantPhone: APPLICANT,
        existing: ["9843119897"],
      }),
    ).toBe("ok");
  });
});

describe("age", () => {
  const asOf = new Date("2026-09-12T00:00:00Z");

  it("refuses somebody under the minimum", () => {
    const verdict = judgeAge("2010-02-14", asOf);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("tooYoung");
      expect(verdict.age).toBe(16);
    }
  });

  it("accepts the walkthrough applicant, who was old enough after all", () => {
    // Worth keeping. The date on that screen read as a minor at a glance and
    // was not one — born February 2008 is eighteen by September 2026. The gap
    // it exposed was real and different: nothing checked the field at all, so
    // a date of 2012 would have been approved just as readily.
    expect(judgeAge("2008-02-14", asOf)).toEqual({ ok: true, age: 18 });
  });

  it("counts the birthday, not the year", () => {
    // Somebody turning 18 tomorrow is 17 today, and the difference is a minor
    // in a stranger's house.
    expect(ageOn("2008-09-13", asOf)).toBe(MINIMUM_AGE - 1);
    expect(ageOn("2008-09-12", asOf)).toBe(MINIMUM_AGE);
  });

  it("accepts somebody old enough", () => {
    expect(judgeAge("1990-01-01", asOf)).toEqual({ ok: true, age: 36 });
  });

  it("refuses a date that cannot be read or is in the future", () => {
    expect(judgeAge("not a date", asOf)).toMatchObject({ reason: "unreadable" });
    expect(judgeAge("2030-01-01", asOf)).toMatchObject({ reason: "future" });
    expect(judgeAge(null, asOf)).toMatchObject({ reason: "missing" });
  });
});

describe("where the money goes", () => {
  it("notices a payout number that is not theirs", () => {
    // Allowed — often a spouse's or a son's wallet — but the reviewer is told
    // rather than shown a number that looks like every other number.
    expect(
      payoutIsSomebodyElses({
        payoutAccount: "9843119897",
        applicantPhone: APPLICANT,
      }),
    ).toBe(true);
  });

  it("says nothing when it is their own number written differently", () => {
    // A false flag here is worse than none: it teaches the reviewer to skip
    // the line, and then the real one goes past too.
    expect(
      payoutIsSomebodyElses({
        payoutAccount: "+977 9800 000 012",
        applicantPhone: APPLICANT,
      }),
    ).toBe(false);
  });

  it("claims nothing it cannot demonstrate", () => {
    for (const payoutAccount of [null, "", "   "]) {
      expect(
        payoutIsSomebodyElses({ payoutAccount, applicantPhone: APPLICANT }),
      ).toBe(false);
    }
    expect(
      payoutIsSomebodyElses({
        payoutAccount: "9843119897",
        applicantPhone: null,
      }),
    ).toBe(false);
  });
});
