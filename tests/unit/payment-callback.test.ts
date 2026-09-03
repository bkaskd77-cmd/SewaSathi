import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CUSTOMER_PAYMENT_ERRORS, paymentErrorKey, readCallback } from "@/lib/payments";

/**
 * Reading a gateway's return URL, and the copy that answers a failure.
 *
 * Both are small, both are pure, and both are the kind of thing that breaks
 * silently: a reference we fail to extract becomes a customer whose payment
 * never settles, and a missing message key becomes `errors.saveFailed` printed
 * on a page in a language the reader cannot work around.
 */

/** eSewa's return payload: base64 of a JSON object. */
function esewaData(payload: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

describe("finding our reference on the way back", () => {
  it("reads eSewa's transaction_uuid out of the base64 payload", () => {
    const search = new URLSearchParams({
      data: esewaData({
        transaction_uuid: "SKP-abc",
        status: "COMPLETE",
        total_amount: "1500",
      }),
    });
    const read = readCallback("esewa", search);
    expect(read.reference).toBe("SKP-abc");
    // The decoded fields are handed to the adapter, but only as a lookup hint.
    expect(read.params.status).toBe("COMPLETE");
  });

  it("reads Khalti's purchase_order_id", () => {
    const search = new URLSearchParams({
      pidx: "pidx-1",
      status: "Completed",
      purchase_order_id: "SKP-xyz",
    });
    const read = readCallback("khalti", search);
    expect(read.reference).toBe("SKP-xyz");
    expect(read.params.pidx).toBe("pidx-1");
  });

  it("prefers our own ref over the gateway's echo of it", () => {
    // Ours is on the URL because we put it there. A gateway echoing something
    // different means something is wrong, and ours is the one that maps to a
    // row we wrote.
    const search = new URLSearchParams({
      ref: "SKP-ours",
      data: esewaData({ transaction_uuid: "SKP-theirs" }),
    });
    expect(readCallback("esewa", search).reference).toBe("SKP-ours");
  });

  it("survives a payload that is not base64 JSON", () => {
    const search = new URLSearchParams({ data: "not-base64-{{{" });
    const read = readCallback("esewa", search);
    // No reference, and no exception — the route redirects to /bookings.
    expect(read.reference).toBeNull();
  });

  it("does not decode eSewa's payload for another gateway", () => {
    const search = new URLSearchParams({
      data: esewaData({ transaction_uuid: "SKP-abc" }),
    });
    expect(readCallback("khalti", search).reference).toBeNull();
  });

  it("returns null rather than guessing when nothing carries a reference", () => {
    expect(readCallback("esewa", new URLSearchParams()).reference).toBeNull();
    expect(
      readCallback("khalti", new URLSearchParams({ status: "Completed" }))
        .reference,
    ).toBeNull();
  });

  it("ignores nested objects in the payload rather than stringifying them", () => {
    const search = new URLSearchParams({
      ref: "SKP-1",
      data: esewaData({ transaction_uuid: "SKP-1", extra: { a: 1 } }),
    });
    expect(readCallback("esewa", search).params.extra).toBeUndefined();
  });
});

describe("the failure sentence a customer sees", () => {
  const catalogue = (locale: string) =>
    JSON.parse(
      readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf8"),
    ) as { booking: { payment: { errors: Record<string, string> } } };

  for (const locale of ["en", "ne"]) {
    it(`${locale} has copy for every reason on the allow-list`, () => {
      const errors = catalogue(locale).booking.payment.errors;
      for (const reason of CUSTOMER_PAYMENT_ERRORS) {
        expect(errors[reason], `${locale}: errors.${reason}`).toBeTruthy();
      }
      // The fallback every other reason collapses to.
      expect(errors.failed).toBeTruthy();
    });
  }

  it("falls back rather than naming a key we have no copy for", () => {
    expect(paymentErrorKey("saveFailed")).toBe("errors.failed");
    expect(paymentErrorKey("")).toBe("errors.failed");
    expect(paymentErrorKey("alreadyPaid")).toBe("errors.alreadyPaid");
  });
});
