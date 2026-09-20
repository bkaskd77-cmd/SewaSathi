import { describe, expect, it } from "vitest";

import {
  attentionFor,
  isHappeningNow,
  isLiveBooking,
  summarise,
} from "@/lib/booking";
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

/**
 * The price correction, which is the trip gate one step later.
 *
 * `enforce_price_correction` refuses `in_progress` while the question is open,
 * so a booking waiting on this answer is a booking with a professional
 * possibly already outside and no way to begin. It looked exactly like a
 * booking that was proceeding, which is the failure `confirmTrip` exists for.
 */
describe("an unanswered price correction", () => {
  const corrected: AttentionInput = {
    ...base,
    status: "accepted",
    providerBandAt: "2026-09-19T09:00:00Z",
  };

  it("asks while nobody has answered", () => {
    expect(attentionFor(corrected)).toBe("respondToCorrection");
  });

  it("stops asking once they agree", () => {
    expect(
      attentionFor({
        ...corrected,
        bandChangeApprovedAt: "2026-09-19T09:05:00Z",
      }),
    ).toBeNull();
  });

  it("stops asking once they decline", () => {
    expect(
      attentionFor({
        ...corrected,
        bandChangeDeclinedAt: "2026-09-19T09:05:00Z",
      }),
    ).toBeNull();
  });

  /**
   * Declining cancels the booking, so the question dies with it. Re-asking
   * would be asking somebody to answer for work that is not going to happen.
   */
  it("drops the question when the booking is no longer live", () => {
    expect(
      attentionFor({ ...corrected, status: "cancelled" }),
    ).toBeNull();
  });

  /**
   * The stamp is the existence test, not the slug: retiring a product clears
   * `provider_band_slug` through an `on delete set null` foreign key, and an
   * answered correction must not silently become a fresh question.
   */
  it("asks on a correction whose product was later retired", () => {
    expect(
      attentionFor({ ...corrected, providerBandAt: "2026-01-02T00:00:00Z" }),
    ).toBe("respondToCorrection");
  });

  it("wants nothing from a booking nobody corrected", () => {
    expect(attentionFor({ ...base, status: "accepted" })).toBeNull();
  });
});

/**
 * The free return visit.
 *
 * It finishes `completed` and `unpaid` exactly like a job somebody owes money
 * for, because nothing is ever charged — so the dashboard would have put
 * "Pay now" on the visit we sent BECAUSE the first job failed. The worst
 * possible place to ask for money, and it was the default behaviour.
 */
describe("a guarantee return visit", () => {
  const visit: AttentionInput = {
    ...base,
    status: "completed",
    paymentStatus: "unpaid",
    billable: false,
  };

  it("never asks the customer to pay for it", () => {
    expect(attentionFor(visit)).toBeNull();
  });

  it("still asks on the ordinary unpaid job beside it", () => {
    expect(attentionFor({ ...visit, billable: true })).toBe("pay");
  });

  it("treats a caller that does not read the column as billable", () => {
    const { billable: _omitted, ...withoutFlag } = visit;
    expect(attentionFor(withoutFlag)).toBe("pay");
  });

  /**
   * A visit that turned out to be a different problem IS billable — the
   * verdict flips the flag — so it must ask like any other job.
   */
  it("asks once a verdict has made the visit billable", () => {
    expect(attentionFor({ ...visit, billable: true })).toBe("pay");
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

  /**
   * Both gates at once is a real booking: a first visit to a new address where
   * the professional then finds a different job. The trip gate wins because
   * nothing has been dispatched at all yet.
   */
  it("puts the trip gate ahead of a price correction", () => {
    expect(
      attentionFor({
        ...base,
        status: "accepted",
        confirmationRequired: true,
        providerBandAt: "2026-09-19T09:00:00Z",
      }),
    ).toBe("confirmTrip");
  });

  /**
   * An amount cannot honestly be approved against a band that is itself in
   * dispute — the 2x ceiling would be measured off a number nobody has agreed
   * to. So the correction is asked first.
   */
  it("puts a price correction ahead of an unapproved amount", () => {
    expect(
      attentionFor({
        ...base,
        status: "in_progress",
        providerBandAt: "2026-09-19T09:00:00Z",
        finalAmount: 9000,
      }),
    ).toBe("respondToCorrection");
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

  /**
   * A guarantee claim keeps a finished job in flight.
   *
   * The status stays `completed` for ever — the claim is a second visit, not a
   * rerun of the first — so the status alone filed a customer who had reported
   * their tap leaking again under "Earlier", beside jobs closed months ago,
   * while they waited for us to send somebody.
   */
  it("keeps a completed booking up while a claim is in flight", () => {
    expect(
      isHappeningNow({ status: "completed", hasLiveClaim: true }),
    ).toBe(true);
  });

  it("files it away again once the claim is settled", () => {
    expect(
      isHappeningNow({ status: "completed", hasLiveClaim: false }),
    ).toBe(false);
    expect(isHappeningNow({ status: "completed" })).toBe(false);
  });

  it("changes nothing about a booking that is live on its own", () => {
    for (const status of live) {
      expect(isHappeningNow({ status })).toBe(true);
    }
  });

  /**
   * A claim cannot outlive its booking being cancelled, but if one ever did,
   * the honest answer is still that something is happening on it — somebody is
   * going out. The rule is about whether anybody is moving, not about status.
   */
  it("says so even on a cancelled booking with a claim", () => {
    expect(
      isHappeningNow({ status: "cancelled", hasLiveClaim: true }),
    ).toBe(true);
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

/**
 * A refund we have agreed and not sent keeps the booking in front of somebody.
 *
 * THE FAILURE IT PREVENTS. Two of our three rails cannot move money from
 * inside this product, so an approved refund waits on a person going and
 * sending it. Without this the card dropped into "Earlier" — quiet and small,
 * beside jobs closed months ago — while the customer waited for money we had
 * already told them they would get.
 */
describe("a refund agreed but not yet sent", () => {
  it("keeps a finished booking under 'happening now'", () => {
    expect(
      isHappeningNow({ status: "completed", hasUnpaidRefund: true }),
    ).toBe(true);
  });

  it("lets it settle back into history once the money has gone", () => {
    expect(
      isHappeningNow({ status: "completed", hasUnpaidRefund: false }),
    ).toBe(false);
  });

  /*
   * DELIBERATELY NOT AN `attentionFor` KIND. "Needs you" is a list of things
   * the customer must act on; their own unpaid refund is not one of them, and
   * putting it there would ask somebody to chase us for money we have already
   * agreed to pay. It is ours to finish, so it lives where a live claim lives.
   */
  it("never asks the customer to do anything about it", () => {
    const owed: AttentionInput = {
      ...base,
      status: "completed",
      paymentStatus: "paid",
      finalAmount: 2000,
      finalAmountApprovedAt: "2026-09-01T10:00:00Z",
    };
    expect(attentionFor(owed)).toBeNull();
  });
});
