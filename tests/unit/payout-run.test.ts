import { describe, expect, it } from "vitest";

import {
  isPayoutRunDay,
  payoutPeriod,
  PAYOUT_RUN,
} from "@/lib/config/payout-policy";
import {
  canTransitionPayout,
  heldReasonFor,
  needsReversal,
  PAYOUT_STATUSES,
  PAYOUT_TRANSITIONS,
} from "@/lib/payments/client";

/**
 * The pure decisions the payout run is made of.
 *
 * WHY THESE ARE WORTH A FILE OF THEIR OWN. The db test proves the schema, the
 * indexes and the arithmetic against real Postgres; none of it can reach the
 * questions below, because each one is about a date or a precedence rather than a
 * row. A weekly run folded into a daily cron is only safe if "is it the day" is
 * exactly right on all seven, and the hold precedence decides which sentence a
 * person reads on the screen where they release somebody's earnings.
 */

const DAY = 24 * 60 * 60 * 1000;

describe("only one day in seven produces anything", () => {
  it("is the run day on Tuesday and no other day", () => {
    // 2026-09-27 is a Sunday, so this walks Sunday through Saturday in order and
    // the expectation is positional rather than a second copy of the rule.
    const sunday = new Date("2026-09-27T04:00:00.000Z");
    const days = Array.from({ length: 7 }, (_, i) =>
      isPayoutRunDay(new Date(sunday.getTime() + i * DAY)),
    );

    expect(days).toEqual([false, false, true, false, false, false, false]);
  });

  it("names the day in a constant rather than in a cron expression", () => {
    /*
     * THE WHOLE REASON THE DAY LIVES IN CODE. Vercel's Hobby plan has one schedule
     * and it is daily, so weekly cannot be expressed there; and a day-of-week check
     * in code is testable where a cron expression is not. `runPayouts` is therefore
     * safe to invoke on any day, twice, or late.
     */
    expect(PAYOUT_RUN.runDayOfWeek).toBe(2);
    expect(isPayoutRunDay(new Date("2026-09-29T00:00:00.000Z"))).toBe(true);
    expect(isPayoutRunDay(new Date("2026-09-29T23:59:59.000Z"))).toBe(true);
  });
});

describe("the period is derived from the date and never from the clock", () => {
  it("gives two runs on the same day the same period", () => {
    /*
     * THIS IS WHAT MAKES `payouts_provider_period_idx` BITE. "Now minus seven days"
     * would give an early run and a late one two different `period_start` values,
     * and the second would insert a second payout for the same week rather than
     * being refused.
     */
    const early = payoutPeriod(new Date("2026-09-29T00:05:00.000Z"));
    const late = payoutPeriod(new Date("2026-09-29T23:55:00.000Z"));

    expect(early.start.toISOString()).toBe(late.start.toISOString());
    expect(early.end.toISOString()).toBe(late.end.toISOString());
  });

  it("settles the week ending at the previous Monday", () => {
    const { start, end } = payoutPeriod(new Date("2026-09-29T04:00:00.000Z"));

    expect(end.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(start.toISOString()).toBe("2026-09-21T00:00:00.000Z");
    // Seven days exactly, so no day is settled twice and none is skipped.
    expect(end.getTime() - start.getTime()).toBe(7 * DAY);
  });

  it("covers every day exactly once across consecutive runs", () => {
    const thisWeek = payoutPeriod(new Date("2026-09-29T04:00:00.000Z"));
    const nextWeek = payoutPeriod(new Date("2026-10-06T04:00:00.000Z"));

    // The periods abut: next week's start IS this week's end, so a settlement on
    // the boundary belongs to one payout and not to both or neither.
    expect(nextWeek.start.toISOString()).toBe(thisWeek.end.toISOString());
  });
});

describe("what holds a payout, and in what order", () => {
  const ready = { readiness: { ok: true } };
  const cooling = { readiness: { ok: false, reason: "cooling" } };
  const unconfirmed = { readiness: { ok: false, reason: "unconfirmed" } };

  it("does not hold a payable week to a ready destination", () => {
    expect(heldReasonFor(4000, ready)).toBeNull();
  });

  it("holds a week they owe us whatever the destination says", () => {
    /*
     * NEGATIVE OUTRANKS EVERYTHING, and the reason is on the screen rather than in
     * the arithmetic: where they owe us, their bank account is irrelevant, and
     * reporting "cooling" for such a week would tell a professional to wait for a
     * date that has nothing to do with why nothing arrived.
     *
     * `runPayouts` TAKES THIS ANSWER AND DRAFTS NOTHING, rather than writing a held
     * row — `payouts_one_in_flight_idx` would then block every later week until a
     * person failed it by hand, which is weekly busywork over a row nobody can act
     * on. The judgement still belongs here, because the question "why would this not
     * be sent" is asked by more than the run.
     */
    expect(heldReasonFor(-600, ready)).toBe("negative");
    expect(heldReasonFor(-600, cooling)).toBe("negative");
    expect(heldReasonFor(-600, null)).toBe("negative");
  });

  it("holds when there is nowhere to send it", () => {
    expect(heldReasonFor(2000, null)).toBe("no_destination");
  });

  it("passes each destination refusal through as its own reason", () => {
    expect(heldReasonFor(2000, cooling)).toBe("cooling");
    expect(heldReasonFor(2000, unconfirmed)).toBe("unconfirmed");
  });

  it("treats a refusal it does not recognise as nowhere to send it", () => {
    /*
     * `retired` cannot reach here — `currentDestination` reads only the live row —
     * and if a fourth reason is ever added this must not fall through to "send it".
     * The safe reading of an unrecognised refusal is that there is no address.
     */
    expect(heldReasonFor(2000, { readiness: { ok: false, reason: "retired" } })).toBe(
      "no_destination",
    );
  });
});

describe("the payout machine", () => {
  it("cannot reach a rail from a draft, however it is called", () => {
    // The structural half of "the run only ever creates drafts". A cron that could
    // skip the approval is a cron whose bug sends money.
    expect(canTransitionPayout("draft", "sent")).toBe(false);
    expect(canTransitionPayout("draft", "approved")).toBe(true);
    expect(canTransitionPayout("approved", "sent")).toBe(true);
  });

  it("reverses only what was actually sent", () => {
    expect(needsReversal("sent")).toBe(true);
    for (const status of PAYOUT_STATUSES.filter((s) => s !== "sent")) {
      expect(needsReversal(status), `${status} moved no money`).toBe(false);
    }
  });

  it("ends at confirmed and at failed", () => {
    expect(PAYOUT_TRANSITIONS.confirmed).toEqual([]);
    expect(PAYOUT_TRANSITIONS.failed).toEqual([]);
  });

  it("lets every state reach failed except the terminal two", () => {
    /*
     * A DRAFT HAS TO BE ABANDONABLE. A destination goes into cooldown, a listing
     * closes, the period is recalculated — and without `draft -> failed` the row
     * would sit unresolved for ever while `payouts_provider_period_idx` refuses a
     * replacement for that week.
     */
    for (const status of ["draft", "approved", "sent"] as const) {
      expect(PAYOUT_TRANSITIONS[status]).toContain("failed");
    }
  });
});

describe("withholding tax", () => {
  it("is zero, which means withhold nothing rather than nobody chose", () => {
    /*
     * ZERO IS A DECISION HERE and null would be the wrong shape: the rate genuinely
     * may be zero for some professionals. What is outstanding is an accountant
     * confirming it, which lives in LAUNCH-BLOCKERS rather than as a number nobody
     * has checked. At 0 the run writes NO `tax_withheld` row at all — a row for zero
     * rupees would assert a withholding was calculated and came to nothing.
     */
    expect(PAYOUT_RUN.withholdingTaxBps).toBe(0);
  });
});
