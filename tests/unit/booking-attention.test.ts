import { describe, expect, it } from "vitest";

import { attentionFor, isLiveBooking, summarise } from "@/lib/booking";
import type { AttentionInput } from "@/lib/booking";
import type { BookingStatus } from "@/lib/booking";

/**
 * What a booking needs from the customer.
 *
 * The case worth the file is `confirmTrip`: dispatch holds until the customer
 * answers, so a booking stuck in that gate is a job that never happens and
 * nobody is told. It has to outrank everything else on the dashboard.
 */

const base: AttentionInput = {
  status: "pending",
  confirmationRequired: false,
  confirmedAt: null,
  finalAmount: null,
  finalAmountApprovedAt: null,
  amountMismatchAt: null,
  paymentStatus: "unpaid",
};

describe("what needs the customer", () => {
  it("wants nothing from an ordinary booking in flight", () => {
    expect(attentionFor(base)).toBeNull();
    expect(attentionFor({ ...base, status: "en_route" })).toBeNull();
  });

  it("asks for the trip confirmation while it is the gate", () => {
    expect(
      attentionFor({ ...base, confirmationRequired: true }),
    ).toBe("confirmTrip");
  });

  it("stops asking once they have answered", () => {
    expect(
      attentionFor({
        ...base,
        confirmationRequired: true,
        confirmedAt: "2026-09-01T10:00:00Z",
      }),
    ).toBeNull();
  });

  /**
   * A cancelled booking's unanswered gate is not a question anybody still
   * needs to answer, and putting it on the dashboard would be asking somebody
   * to act on a job that has ended.
   */
  it("drops the gate when the booking is no longer live", () => {
    expect(
      attentionFor({
        ...base,
        status: "cancelled",
        confirmationRequired: true,
      }),
    ).toBeNull();
  });

  it("asks for approval on a figure nobody has agreed", () => {
    expect(attentionFor({ ...base, finalAmount: 5000 })).toBe("approveAmount");
  });

  it("says nothing once the figure is agreed", () => {
    expect(
      attentionFor({
        ...base,
        finalAmount: 5000,
        finalAmountApprovedAt: "2026-09-01T10:00:00Z",
      }),
    ).toBeNull();
  });

  it("asks for payment on finished, unpaid work", () => {
    expect(
      attentionFor({
        ...base,
        status: "completed",
        finalAmount: 2000,
        finalAmountApprovedAt: "2026-09-01T10:00:00Z",
      }),
    ).toBe("pay");
  });

  it("says nothing about a finished job that is paid for", () => {
    expect(
      attentionFor({
        ...base,
        status: "completed",
        finalAmount: 2000,
        finalAmountApprovedAt: "2026-09-01T10:00:00Z",
        paymentStatus: "paid",
      }),
    ).toBeNull();
  });

  it("asks them to book again when nobody was found", () => {
    expect(attentionFor({ ...base, status: "no_provider_found" })).toBe(
      "rebook",
    );
  });

  it("surfaces a mismatch", () => {
    expect(
      attentionFor({
        ...base,
        status: "completed",
        finalAmount: 2000,
        finalAmountApprovedAt: "2026-09-01T10:00:00Z",
        amountMismatchAt: "2026-09-01T11:00:00Z",
      }),
    ).toBe("resolveMismatch");
  });
});

describe("only one thing is asked at a time", () => {
  /**
   * A card with two calls to action has none. The blocking one wins, and the
   * next surfaces the moment it is dealt with.
   */
  it("puts the trip gate ahead of an unapproved amount", () => {
    expect(
      attentionFor({
        ...base,
        confirmationRequired: true,
        finalAmount: 9000,
      }),
    ).toBe("confirmTrip");
  });

  it("puts an unapproved amount ahead of the payment", () => {
    expect(
      attentionFor({
        ...base,
        status: "completed",
        finalAmount: 9000,
      }),
    ).toBe("approveAmount");
  });
});

describe("which half of the page a booking sits in", () => {
  const live: BookingStatus[] = [
    "pending",
    "accepted",
    "en_route",
    "in_progress",
  ];
  const done: BookingStatus[] = ["completed", "cancelled", "no_provider_found"];

  it("splits the statuses with nothing left over", () => {
    for (const status of live) expect(isLiveBooking(status)).toBe(true);
    for (const status of done) expect(isLiveBooking(status)).toBe(false);
  });
});

describe("the customer's own totals", () => {
  /**
   * ONLY WHAT WE ACTUALLY KNOW. A total that quietly included quoted ranges
   * would be a number the customer could disprove with their own wallet.
   */
  it("counts finished jobs and sums only what was paid", () => {
    const result = summarise([
      { status: "completed", finalAmount: 3000, paymentStatus: "paid" },
      { status: "completed", finalAmount: 2000, paymentStatus: "unpaid" },
      { status: "completed", finalAmount: null, paymentStatus: "paid" },
      { status: "cancelled", finalAmount: 9999, paymentStatus: "paid" },
      { status: "en_route", finalAmount: null, paymentStatus: "unpaid" },
    ]);

    expect(result.done).toBe(3);
    expect(result.spent).toBe(3000);
  });

  it("is zero for somebody with nothing finished", () => {
    expect(summarise([])).toEqual({ done: 0, spent: 0 });
  });
});
