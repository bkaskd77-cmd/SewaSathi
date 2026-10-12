import { describe, expect, it } from "vitest";

import {
  BAND_SOURCES,
  DURATION_OUTCOMES,
  MIN_DURATION_SAMPLE,
  MINUTES_ROUNDING,
  countsAsEvidence,
  durationOutcome,
  proposeDuration,
  releaseSampleFor,
  revertSuppressedBy,
  type DurationKind,
} from "@/lib/booking";

/**
 * The loop that replaces a guessed duration with a measured one.
 *
 * IT ACTS WITHOUT A PERSON, which `proposeBand` may not, so the floors and the
 * statistic are the whole of the safety and are pinned here as BEHAVIOUR rather
 * than against the constants the code also reads. The activity-floor tests were
 * written the other way once — every case read `ACTIVITY_FLOOR`, so lowering the
 * floor to 1 left them all green and they asserted only that the floor is the
 * floor.
 */

const repeat = (value: number, times: number): number[] =>
  Array.from({ length: times }, () => value);

const minutesAt = (values: number[], published = 480, source: "invented" | "researched" | "observed" = "invented") =>
  proposeDuration({ kind: "minutes", values, published, source });

const spanAt = (values: number[], published = 4, source: "invented" | "researched" | "observed" = "invented") =>
  proposeDuration({ kind: "span", values, published, source });

describe("nothing measured is not a measurement of nothing", () => {
  it("proposes nothing at all with no evidence", () => {
    const proposal = minutesAt([]);
    expect(proposal.sample).toBe(0);
    // Null, never 0 and never the published figure — a proposal of the current
    // number would be an endorsement nobody computed, which is the mistake
    // `proposeBand` records below its own minimum sample.
    expect(proposal.observed).toBeNull();
    expect(proposal.decision).toEqual({ act: false, why: "no-evidence" });
  });

  it("writes no row for it", () => {
    expect(durationOutcome({ act: false, why: "no-evidence" })).toBeNull();
  });

  it("writes a row for everything else, and only values the column admits", () => {
    const outcomes = [
      durationOutcome({ act: true, to: 90 }),
      durationOutcome({ act: false, why: "below-floor", need: 4 }),
      durationOutcome({ act: false, why: "settled" }),
    ];
    for (const outcome of outcomes) {
      expect(outcome).not.toBeNull();
      expect(DURATION_OUTCOMES as readonly string[]).toContain(outcome as string);
    }
  });
});

describe("a measurement waits for its floor", () => {
  /*
   * ELEVEN AND TWELVE, by the number rather than by the constant. A case
   * written as `MIN_DURATION_SAMPLE.minutes - 1` would pass at any floor,
   * including a floor of 1 — which is the behaviour this phase exists to
   * prevent, since the loop applies without anybody approving.
   */
  it("holds out at eleven same-day jobs and acts at twelve", () => {
    const eleven = minutesAt(repeat(90, 11));
    expect(eleven.decision).toEqual({ act: false, why: "below-floor", need: 1 });

    const twelve = minutesAt(repeat(90, 12));
    expect(twelve.decision).toEqual({ act: true, to: 90 });
  });

  it("holds a span out to twenty, which is stricter than the minutes", () => {
    const twelve = spanAt(repeat(2, 12));
    expect(twelve.decision.act).toBe(false);

    const twenty = spanAt(repeat(2, 20));
    expect(twenty.decision).toEqual({ act: true, to: 2 });
  });

  /*
   * THE SPAN'S FLOOR IS HIGHER AND THAT IS THE POINT. A wrong minutes figure
   * reserves 90 where 120 was right; a wrong span holds four days of a
   * painter's week and four days of a customer's home, invisibly. Asserted as
   * an inequality rather than as two numbers, because what must not change is
   * the ordering.
   */
  it("always asks more of a span than of a minutes figure", () => {
    expect(MIN_DURATION_SAMPLE.span).toBeGreaterThan(MIN_DURATION_SAMPLE.minutes);
  });

  it("counts down honestly", () => {
    const five = minutesAt(repeat(60, 5));
    expect(five.decision).toEqual({
      act: false,
      why: "below-floor",
      need: MIN_DURATION_SAMPLE.minutes - 5,
    });
  });
});

describe("the statistic is a median, and that is a choice about outliers", () => {
  /*
   * THE CONTAMINATION THIS HANDLES IS REAL. A professional who taps "start" at
   * nine and "complete" at six on a forty-five-minute job records 540 minutes,
   * and the loop cannot tell that from a long job. A mean would move; a median
   * does not until a third of the sample is unusual.
   */
  it("ignores a handful of all-day readings on a short job", () => {
    const values = [...repeat(45, 10), 540, 540];
    expect(minutesAt(values).decision).toEqual({ act: true, to: 45 });
  });

  it("names the outliers rather than removing them", () => {
    const proposal = minutesAt([...repeat(45, 10), 540, 540]);
    expect(proposal.unusual).toBe(2);
    // The signal is "this product is really two products" — painting's
    // bimodality is why sub-bands exist at all. Clamping would change the
    // median not at all, so the count is the only thing worth reporting.
    expect(proposal.observed).toBe(45);
  });

  it("reports no outliers on a tight sample", () => {
    expect(minutesAt(repeat(90, 12)).unusual).toBe(0);
  });

  it("moves when the unusual jobs become the majority", () => {
    const values = [...repeat(45, 4), ...repeat(540, 8)];
    expect(minutesAt(values).decision).toEqual({ act: true, to: 540 });
  });
});

describe("a published duration is round, and a span rounds DOWN", () => {
  it("rounds minutes to the nearest five", () => {
    const proposal = minutesAt([...repeat(47, 6), ...repeat(48, 6)]);
    expect(proposal.observed).not.toBeNull();
    expect((proposal.observed as number) % MINUTES_ROUNDING).toBe(0);
  });

  /*
   * THE ASYMMETRY IS THE SPAN'S WHOLE SAFETY. An under-reserved span shows up
   * as a job running over, which somebody notices and can act on; an
   * over-reserved one silently removes capacity nobody can see. So a product
   * genuinely split between one day and two resolves to one.
   */
  it("resolves a span split between one day and two to one", () => {
    const values = [...repeat(1, 10), ...repeat(2, 10)];
    expect(spanAt(values).decision).toEqual({ act: true, to: 1 });
  });

  it("never publishes a span below one day", () => {
    expect(spanAt(repeat(1, 20)).observed).toBe(1);
  });

  it("rounds a 3.5-day span down to three", () => {
    const values = [...repeat(3, 10), ...repeat(4, 10)];
    expect(spanAt(values).observed).toBe(3);
  });
});

describe("a figure already published from this evidence is left alone", () => {
  it("is settled when the measurement matches what is already measured", () => {
    const proposal = minutesAt(repeat(90, 12), 90, "observed");
    expect(proposal.decision).toEqual({ act: false, why: "settled" });
  });

  /*
   * BUT A MATCHING GUESS IS STILL PROMOTED, because the provenance is the
   * thing that changes: `invented` keeps the figure off every screen and keeps
   * a span held to one day, and the loop having confirmed the number is exactly
   * the evidence that lifts both.
   */
  it("still acts when a GUESS happens to match the measurement", () => {
    const proposal = minutesAt(repeat(90, 12), 90, "invented");
    expect(proposal.decision).toEqual({ act: true, to: 90 });
  });

  it("acts on a researched figure the data disagrees with", () => {
    const proposal = minutesAt(repeat(90, 12), 480, "researched");
    expect(proposal.decision).toEqual({ act: true, to: 90 });
  });
});

describe("the row carries the floor that was in force", () => {
  /*
   * So a later change to MIN_DURATION_SAMPLE leaves old readings readable
   * rather than retrospectively wrong — the same reason `commission_bps` is
   * frozen onto a booking.
   */
  it("reports the floor beside the sample", () => {
    for (const kind of ["minutes", "span"] as DurationKind[]) {
      const proposal = proposeDuration({
        kind,
        values: [1, 1, 1],
        published: 1,
        source: "invented",
      });
      expect(proposal.floor).toBe(MIN_DURATION_SAMPLE[kind]);
    }
  });
});

describe("no movement cap, deliberately", () => {
  /*
   * `MAX_REVISION_MOVE` holds a BAND proposal inside a fifth of what is
   * published, because a person approves it and a capped number is still a
   * number somebody can judge. Nothing approves a duration, so capping would
   * publish a figure the data did not say and no screen would show the
   * difference. The loop's history is the guard instead: a wild jump is one row
   * in `duration_observations` with its sample beside it.
   */
  it("publishes what the data says however far it is from the guess", () => {
    const proposal = minutesAt(repeat(600, 12), 30, "invented");
    expect(proposal.decision).toEqual({ act: true, to: 600 });
  });
});

describe("which completions count as evidence about a product", () => {
  /*
   * ONE FILTER, TWO CALLERS. The nightly sweep and `/admin/duration` both need
   * it, and they each had their own copy for the length of one commit — the
   * divergence `lib/provider/measured.ts` exists to prevent, where the
   * catalogue card and `scoreParts` came to disagree about the same question.
   */
  it("counts a job whose product somebody named", () => {
    for (const source of ["model", "matcher", "customer", "professional"]) {
      expect(countsAsEvidence({ bandSource: source })).toBe(true);
    }
  });

  /*
   * A guarantee visit copies the band of the job it is putting right: the same
   * fault revisited, so its duration describes a callback and not the product.
   */
  it("excludes a guarantee visit", () => {
    expect(countsAsEvidence({ bandSource: "inherited" })).toBe(false);
  });

  /*
   * AND A NULL SOURCE WITH IT. Rule 6 — null is "not recorded", and the one
   * such row in production is itself a guarantee visit whose provenance was
   * never written. Reading it as "fresh" would hand the loop a measurement
   * nothing can vouch for.
   */
  it("excludes a product with no recorded provenance", () => {
    expect(countsAsEvidence({ bandSource: null })).toBe(false);
  });

  /*
   * EVERY SOURCE IS DECIDED, in both directions, so adding a sixth to
   * `BAND_SOURCES` without deciding whether it is evidence fails here rather
   * than quietly entering the sample.
   */
  it("has an answer for every band source the column admits", () => {
    const counted = BAND_SOURCES.filter((source) =>
      countsAsEvidence({ bandSource: source }),
    );
    expect([...counted].sort()).toEqual(
      ["customer", "matcher", "model", "professional"].sort(),
    );
  });
});

/**
 * A FORGOTTEN-OPEN JOB IS THE CONTAMINATION THIS LOOP WAS BUILT KNOWING ABOUT,
 * and it comes in two shapes rather than one. Pinned together because only one
 * of them is the median's doing.
 */
describe("a job somebody forgot to close cannot inflate a figure", () => {
  it("is not in the minutes sample at all when it crossed a night", () => {
    /*
     * THE FIRST LAYER IS THE SCHEMA, NOT THE STATISTIC.
     * `record_booking_duration()` writes `actual_working_minutes` only on a
     * same-day completion — the nights are inside the elapsed figure and there
     * is nothing that could take them out, because we hold one start stamp and
     * one finish stamp rather than one per day. So a job started on Monday and
     * closed on Thursday contributes nothing here, and this case asserts the
     * contract the sweep relies on: the minutes sample is same-day completions.
     * `tests/db/booking-duration.test.ts` is where the trigger's half is run.
     */
    const sameDayOnly = repeat(45, 12);
    expect(minutesAt(sameDayOnly).decision).toEqual({ act: true, to: 45 });
  });

  it("is outvoted in the span sample, which is where it does land", () => {
    /*
     * AND THE SECOND LAYER IS THE MEDIAN, which is the only defence the span
     * has: `actual_elapsed_days` IS written for a multi-day job, because that
     * is exactly the measurement the span loop needs, so a forgotten job
     * arrives as a genuine-looking four-day reading. At the floor of 20 a
     * handful of them cannot move the answer, and a mean would.
     */
    const oneDayJobs = repeat(1, 17);
    // Thirty days, not four: a job nobody closed is bounded by when somebody
    // finally notices, not by how long the work takes, so the reading is
    // arbitrarily large rather than plausibly wrong. That is what makes a mean
    // the wrong statistic here and not merely a slightly worse one.
    const forgotten = repeat(30, 3);
    const values = [...oneDayJobs, ...forgotten];
    const proposal = spanAt(values);

    expect(proposal.decision).toEqual({ act: true, to: 1 });
    // Named rather than removed, because three of them is the signal that this
    // product might really be two.
    expect(proposal.unusual).toBe(3);

    // The arithmetic a mean would have published, stated so the difference is
    // not left to be taken on trust: five days of a painter's week held for
    // every future booking of this product, off three jobs nobody closed.
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(Math.round(mean)).toBe(5);
  });
});

describe("a figure a person took down stays down", () => {
  const twelve = repeat(45, 12);

  it("acts with no revert on record", () => {
    expect(minutesAt(twelve).decision).toEqual({ act: true, to: 45 });
  });

  it("is held back by a revert of that exact figure", () => {
    const proposal = proposeDuration({
      kind: "minutes",
      values: twelve,
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });

    expect(proposal.decision).toEqual({
      act: false,
      why: "suppressed",
      reverted: 45,
      releaseAt: 18,
    });
    // THE OBSERVATION IS STILL REPORTED. A suppressed figure is not an
    // unmeasured one — the screen has to be able to say what the data says and
    // that somebody refused it, which is the whole point of the shadow view.
    expect(proposal.observed).toBe(45);
    expect(proposal.sample).toBe(12);
  });

  it("is not held back once the evidence has grown by half again", () => {
    const eighteen = repeat(45, 18);
    const proposal = proposeDuration({
      kind: "minutes",
      values: eighteen,
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(proposal.decision).toEqual({ act: true, to: 45 });
  });

  it("is not held back by a revert of a different figure", () => {
    /*
     * THE OTHER HALF OF THE RULE, and the half that stops a single revert
     * freezing a sub-band for ever. Somebody who refused 45 has said nothing
     * about 60: the data moved, and the loop is free.
     */
    const sixty = repeat(60, 12);
    const proposal = proposeDuration({
      kind: "minutes",
      values: sixty,
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(proposal.decision).toEqual({ act: true, to: 60 });
  });

  it("holds at seventeen jobs and releases at eighteen", () => {
    /*
     * WRITTEN AS THE NUMBERS RATHER THAN AS `releaseSampleFor(...) - 1`, which
     * is `ACTIVITY_FLOOR`'s lesson: a case computed from the constant the code
     * also reads asserts that the rule equals itself, and would stay green if
     * the growth clause were removed altogether.
     */
    const held = proposeDuration({
      kind: "minutes",
      values: repeat(45, 17),
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(held.decision.act).toBe(false);

    const released = proposeDuration({
      kind: "minutes",
      values: repeat(45, 18),
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(released.decision).toEqual({ act: true, to: 45 });
  });

  it("rounds the release sample up, so one more job is never enough", () => {
    // 13 × 1.5 is 19.5. Rounding down would release at 19, which is a sample
    // that has grown by less than the rule promises.
    expect(releaseSampleFor({ fromValue: 45, sample: 13 })).toBe(20);
    expect(releaseSampleFor({ fromValue: 45, sample: 1 })).toBe(2);
  });

  it("does not suppress below the floor, because nothing could be published", () => {
    /*
     * ORDER, ASSERTED. A sub-band with eleven jobs is `below-floor` and not
     * `suppressed`: a figure nobody could publish is not being held back by
     * anybody, and reading it as suppressed would tell the screen a person has
     * blocked something the loop was never going to do.
     */
    const proposal = proposeDuration({
      kind: "minutes",
      values: repeat(45, 11),
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(proposal.decision).toEqual({ act: false, why: "below-floor", need: 1 });
  });

  it("reads as settled rather than suppressed when the figure is already published", () => {
    const proposal = proposeDuration({
      kind: "minutes",
      values: twelve,
      published: 45,
      source: "observed",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(proposal.decision).toEqual({ act: false, why: "settled" });
  });

  it("logs a suppressed night, because the loop looked and was stopped", () => {
    const proposal = proposeDuration({
      kind: "minutes",
      values: twelve,
      published: 30,
      source: "researched",
      revert: { fromValue: 45, sample: 12 },
    });
    expect(durationOutcome(proposal.decision)).toBe("suppressed");
    expect(DURATION_OUTCOMES).toContain("suppressed");
  });

  it("answers the rule directly, both ways", () => {
    expect(
      revertSuppressedBy({ fromValue: 45, sample: 12 }, { to: 45, sample: 12 }),
    ).toBe(true);
    expect(
      revertSuppressedBy({ fromValue: 45, sample: 12 }, { to: 50, sample: 12 }),
    ).toBe(false);
    expect(
      revertSuppressedBy({ fromValue: 45, sample: 12 }, { to: 45, sample: 18 }),
    ).toBe(false);
  });
});
