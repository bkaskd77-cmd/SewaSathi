import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";

import en from "@/messages/en.json";
import ne from "@/messages/ne.json";

/**
 * Counts that read correctly at one.
 *
 * WHAT WENT WRONG. `/admin/guarantee-claims` shipped reading "This customer
 * has claimed **1 times** on 6 finished jobs" — on the screen where somebody
 * decides how much of a customer's money goes back. Copy that reads as broken
 * beside a figure makes the figure look careless too, and this panel's whole
 * job is to be read carefully.
 *
 * WHY A TEST AS WELL AS A LINT RULE. `check:messages` now refuses `{n}` in
 * front of a plural noun, which catches the shape. This renders the strings
 * through next-intl's own formatter and asserts the sentence, which catches
 * the thing the shape was standing in for — a branch that exists but selects
 * wrongly passes the lint and fails here.
 *
 * ONE IS THE ONLY INTERESTING NUMBER, plus zero where a `=0` branch was
 * written. Two is included as the control: if every case reads the same, the
 * branch is not branching.
 */

const t = (locale: "en" | "ne") =>
  createTranslator({
    locale,
    messages: locale === "en" ? en : ne,
    namespace: "admin.guaranteeClaims.signals",
  });

describe("how often this customer has claimed", () => {
  it("says once, not 1 times", () => {
    const claimed = t("en")("claimRateValue", { n: "1", count: 1, jobs: "6" });
    expect(claimed).toBe("Once, on 6 finished jobs");
    expect(claimed).not.toContain("1 times");
  });

  it("still says times for more than one", () => {
    expect(t("en")("claimRateValue", { n: "3", count: 3, jobs: "6" })).toBe(
      "3 times on 6 finished jobs",
    );
  });

  /*
   * Zero is worth its own branch here rather than "0 times": this panel is
   * read to decide a refund, and "never" is an answer where "0 times" is an
   * arithmetic result somebody still has to interpret.
   */
  it("says never rather than 0 times", () => {
    expect(t("en")("claimRateValue", { n: "0", count: 0, jobs: "6" })).toBe(
      "Never, on 6 finished jobs",
    );
  });

  it("reads correctly in Nepali at every count", () => {
    // पटक does not inflect, so one and many share a branch — a Nepali plural
    // branch would invent a distinction the language does not make. Zero is
    // separate because "० पटक" is not how anybody says "never".
    const ne1 = t("ne")("claimRateValue", { n: "1", count: 1, jobs: "6" });
    const ne3 = t("ne")("claimRateValue", { n: "3", count: 3, jobs: "6" });
    const ne0 = t("ne")("claimRateValue", { n: "0", count: 0, jobs: "6" });

    expect(ne1).toContain("1 पटक");
    expect(ne3).toContain("3 पटक");
    expect(ne0).toContain("कहिल्यै होइन");
    expect(ne0).not.toContain("पटक");
  });

  it("carries the corrected spelling of काममध्ये", () => {
    // Shipped as "कामामध्ये" with a spurious ा. It is काम + मध्ये, which the
    // line below it in the same panel already had right.
    const rendered = t("ne")("priorRefundsValue", {
      n: "2",
      count: 2,
      jobs: "6",
      amount: "रु ५,०००",
    });
    expect(rendered).toContain("काममध्ये");
    expect(rendered).not.toContain("कामामध्ये");
  });
});

describe("refunds already agreed on their work", () => {
  it("says none rather than 0 · Rs 0 in total", () => {
    // The common case — most professionals have no refunds — and what was on
    // screen when this was found.
    expect(
      t("en")("priorRefundsValue", { n: "0", count: 0, jobs: "3", amount: "Rs 0" }),
    ).toBe("None, on 3 finished jobs");
  });

  it("gives the total once there is one", () => {
    expect(
      t("en")("priorRefundsValue", { n: "2", count: 2, jobs: "3", amount: "Rs 5,000" }),
    ).toBe("2 on 3 finished jobs · Rs 5,000 in total");
  });
});

describe("how many payouts a debt takes to clear", () => {
  const preview = (locale: "en" | "ne") =>
    createTranslator({
      locale,
      messages: locale === "en" ? en : ne,
      namespace: "admin.guaranteeClaims.preview",
    });

  it("says one job, not 1 jobs", () => {
    const line = preview("en")("recovery", { n: "1", count: 1, share: "25" });
    expect(line).toContain("about one job of this size");
    expect(line).not.toContain("1 jobs");
  });

  it("says jobs for more than one", () => {
    expect(preview("en")("recovery", { n: "4", count: 4, share: "25" })).toContain(
      "about 4 jobs of this size",
    );
  });
});

/**
 * The six that predated the bug, and are customer-facing.
 *
 * These were not found by anybody looking at them — they were found by
 * measuring the catalogue for the shape after the refund screen went wrong.
 * "1 jobs done" sat on the bookings summary and "1 years' experience" on a
 * provider card, both live.
 */
describe("the counts a customer sees", () => {
  const services = (locale: "en" | "ne") =>
    createTranslator({
      locale,
      messages: locale === "en" ? en : ne,
      namespace: "services.card",
    });

  it("says one year's experience, not 1 years'", () => {
    expect(services("en")("yearsExperience", { n: "1", count: 1 })).toBe(
      "1 year’s experience",
    );
    expect(services("en")("yearsExperience", { n: "9", count: 9 })).toBe(
      "9 years’ experience",
    );
  });

  it("says 1 yr, not 1 yrs", () => {
    expect(services("en")("years", { n: "1", count: 1 })).toBe("1 yr");
    expect(services("en")("years", { n: "4", count: 4 })).toBe("4 yrs");
  });

  it("says one job done, not 1 jobs done", () => {
    const bookings = createTranslator({
      locale: "en",
      messages: en,
      namespace: "booking.bookings",
    });
    expect(bookings("summary", { n: "1", count: 1, amount: "Rs 900" })).toBe(
      "1 job done · Rs 900 paid",
    );
    expect(bookings("summary", { n: "5", count: 5, amount: "Rs 9,000" })).toBe(
      "5 jobs done · Rs 9,000 paid",
    );
  });

  it("says one job on both provider lists", () => {
    const alternatives = createTranslator({
      locale: "en",
      messages: en,
      namespace: "booking.alternatives",
    });
    const flow = createTranslator({
      locale: "en",
      messages: en,
      namespace: "booking.flow.provider",
    });
    expect(alternatives("jobsDone", { n: "1", count: 1 })).toBe("1 job");
    expect(flow("jobs", { n: "1", count: 1 })).toBe("1 job");
  });
});

/**
 * The same shape on the triage accuracy screen.
 *
 * WHY THESE AND NOT EVERY STRING IN THE PRODUCT. That screen's whole discipline
 * is that no rate is ever printed without the sample it came from, so these two
 * strings are the denominator — every number on the page goes through one of
 * them. "62% — 8 of 1 rows" would undermine the exact thing the screen exists to
 * be trusted about, and the lint only sees that the branch is there.
 */
const ta = (locale: "en" | "ne") =>
  createTranslator({
    locale,
    messages: locale === "en" ? en : ne,
    namespace: "admin.triageAccuracy",
  });

describe("a rate beside the sample it came out of", () => {
  it("says one row, not 1 rows", () => {
    const one = ta("en")("ofTotal", { pct: "100", n: "1", count: 1, total: "1" });
    expect(one).toBe("100% — 1 of 1 row");
    expect(one).not.toContain("1 rows");
  });

  it("still says rows for more than one", () => {
    expect(ta("en")("ofTotal", { pct: "62", n: "8", count: 13, total: "13" })).toBe(
      "62% — 8 of 13 rows",
    );
  });

  it("says one request, not 1 requests", () => {
    const one = ta("en")("latency.ms", { ms: "1900", count: 1, n: "1" });
    expect(one).toBe("1900ms over 1 request");
    expect(one).not.toContain("1 requests");
  });

  it("reads correctly in Nepali at one and at many", () => {
    // पङ्क्ति and अनुरोध do not inflect, so both counts share one branch —
    // a Nepali plural branch would invent a distinction the language lacks.
    const one = ta("ne")("ofTotal", { pct: "100", n: "१", count: 1, total: "१" });
    const many = ta("ne")("ofTotal", { pct: "६२", n: "८", count: 13, total: "१३" });
    expect(one).toContain("पङ्क्तिमध्ये");
    expect(many).toContain("पङ्क्तिमध्ये");
    expect(ta("ne")("latency.ms", { ms: "1900", count: 1, n: "१" })).toContain(
      "अनुरोधमा",
    );
  });
});
