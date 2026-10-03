import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The trip confirmation is actually armed now, and the test asserts the ends.
 *
 * WHAT WAS WRONG. `bookings.confirmation_required` has existed for phases with a
 * trigger that genuinely stops a customer clearing it from a browser, and
 * `tests/db/*` proved that trigger works. `attentionFor` ranks `confirmTrip` first
 * of everything a customer can be asked to do, `/bookings/[id]` has the action and
 * `confirmTrip` writes the answer. Every link was built. **Nothing ever set the
 * flag**, so the guard protected nothing and the prompt could never appear — the
 * `bookings.triage_log_id` shape exactly, where a per-link test would have passed
 * throughout and did.
 *
 * SO THIS CHECKS THE TWO ENDS: that an unproven address causes
 * `confirmation_required: true` to be written, and that `createBooking` is what
 * reaches for it. A test of `confirmationPlan` alone would have been green for every
 * one of those phases.
 *
 * THE RULES THEMSELVES ARE NOT RETESTED HERE. `addressTrust` and
 * `confirmationPlan` are pure and tested where they live; what is new is the wiring,
 * and the two cases below are about whether a write happens at all.
 */

type Update = Record<string, unknown>;

let addressRow: { upheld_no_shows: number } | null = { upheld_no_shows: 0 };
let completedJobs = 0;
const updates: Update[] = [];

/**
 * The narrowest stand-in that can answer the three calls `armConfirmation` makes:
 * the address read, the completed-jobs count, and the update it may write.
 */
class Query {
  private table: string;
  private counting = false;

  constructor(table: string) {
    this.table = table;
  }

  select(_expression: string, options?: { count?: string; head?: boolean }) {
    this.counting = Boolean(options?.count);
    return this;
  }

  eq() {
    return this;
  }

  update(values: Update) {
    updates.push(values);
    return this;
  }

  maybeSingle() {
    return Promise.resolve({ data: addressRow, error: null });
  }

  then<T>(
    resolve: (value: {
      data: unknown;
      count?: number;
      error: unknown;
    }) => T,
  ) {
    if (this.counting) {
      return Promise.resolve({ data: null, count: completedJobs, error: null }).then(
        resolve,
      );
    }
    return Promise.resolve({ data: null, error: null }).then(resolve);
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => new Query(table) }),
}));

vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => true }));

/* React's per-request memo, which `lib/data/source.ts` reaches and there is no
   request here. A pass-through, as in `tests/unit/activity-strip.test.ts`. */
vi.mock("react", async (original) => ({
  ...((await original()) as Record<string, unknown>),
  cache: <T,>(fn: T) => fn,
}));

beforeEach(() => {
  addressRow = { upheld_no_shows: 0 };
  completedJobs = 0;
  updates.length = 0;
});

describe("arming a booking", () => {
  it("asks for a confirmation on an address nobody has proved", async () => {
    const { armConfirmation } = await import("@/lib/data/customer-risk");

    const result = await armConfirmation({
      bookingId: "b-1",
      addressId: "a-1",
      isEmergency: false,
      now: new Date("2026-10-02T06:00:00.000Z"),
    });

    expect(result.required).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0].confirmation_required).toBe(true);
    // 20 minutes for a routine job — the hold, not a block on the booking.
    expect(updates[0].confirmation_hold_until).toBe("2026-10-02T06:20:00.000Z");
  });

  /*
   * AND THE OTHER DIRECTION, which is what stops this becoming friction everybody
   * meets. An address where a job has been completed is proven, nothing is written,
   * and a returning customer is never asked to confirm their own front door again —
   * `confirmationPlan`'s whole argument about teaching people to tap through.
   */
  it("writes nothing for an address that has already had a job done", async () => {
    completedJobs = 1;
    const { armConfirmation } = await import("@/lib/data/customer-risk");

    const result = await armConfirmation({
      bookingId: "b-2",
      addressId: "a-2",
      isEmergency: false,
    });

    expect(result.required).toBe(false);
    expect(updates).toHaveLength(0);
  });

  /*
   * An upheld no-show undoes `proven`, which is the laundering case: one real job at
   * a fake address, then trips swallowed for ever. The flag comes back.
   */
  it("asks again at an address that swallowed a trip, even with a job done there", async () => {
    completedJobs = 3;
    addressRow = { upheld_no_shows: 1 };
    const { armConfirmation } = await import("@/lib/data/customer-risk");

    expect((await armConfirmation({
      bookingId: "b-3",
      addressId: "a-3",
      isEmergency: false,
    })).required).toBe(true);
  });

  /*
   * An emergency is held LONGER, not shorter, and never refused. Somebody with water
   * coming through the ceiling may be moving furniture rather than watching a phone.
   */
  it("holds an emergency longer rather than giving up sooner", async () => {
    const { armConfirmation } = await import("@/lib/data/customer-risk");

    const routine = await armConfirmation({
      bookingId: "b-4",
      addressId: "a-4",
      isEmergency: false,
      now: new Date("2026-10-02T06:00:00.000Z"),
    });
    const emergency = await armConfirmation({
      bookingId: "b-5",
      addressId: "a-5",
      isEmergency: true,
      now: new Date("2026-10-02T06:00:00.000Z"),
    });

    expect(routine.holdUntil).toBe("2026-10-02T06:20:00.000Z");
    expect(emergency.holdUntil).toBe("2026-10-02T06:45:00.000Z");
    expect(emergency.required).toBe(true);
  });
});

describe("the end that was missing", () => {
  /*
   * THE LINK, ASSERTED ON THE SOURCE. Everything above would have passed in every
   * phase where this guard was inert, because `armConfirmation` was always correct —
   * it simply had no caller. This case is the one that goes red if the call is ever
   * removed from booking creation again, which is the failure that actually happened.
   */
  const CREATE = readFileSync("lib/data/bookings.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("is reached from createBooking", () => {
    expect(CREATE).toMatch(/armConfirmation\(/);
    expect(CREATE).toMatch(/from "@\/lib\/data\/customer-risk"/);
  });

  /*
   * And it must not be able to fail the booking. The event already happened —
   * `notify()`'s rule — and a customer whose job vanished because an anti-fraud flag
   * could not be written is a worse outcome than a trip we might have held.
   */
  it("cannot fail the booking it is arming", () => {
    const call = CREATE.slice(CREATE.indexOf("armConfirmation("));
    expect(CREATE.slice(0, CREATE.indexOf("armConfirmation("))).toMatch(/try \{/);
    expect(call).toMatch(/catch/);
  });
});
