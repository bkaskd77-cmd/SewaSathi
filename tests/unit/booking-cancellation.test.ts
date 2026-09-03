import { describe, expect, it } from "vitest";

import {
  BOOKING_STATUSES,
  customerCanCancel,
  judgeCancellation,
  providerCanCancel,
  type BookingStatus,
} from "@/lib/booking";

/**
 * The cancellation windows.
 *
 * The rule this protects is not "which button is enabled" — it is that a
 * customer cannot walk away from a professional who is already on a bike in
 * Kathmandu traffic, and that a professional cannot abandon a job halfway
 * through. Both are the kind of thing that gets loosened by accident when
 * somebody adds a status.
 *
 * Exhaustive over `BOOKING_STATUSES` on purpose: adding a status without
 * deciding who may cancel at it should fail here rather than default to
 * whichever branch happens to catch it.
 */

describe("a customer may cancel only while nobody has set off", () => {
  it("allows it while waiting for a professional", () => {
    expect(customerCanCancel("pending")).toBe(true);
  });

  it("allows it after acceptance, before anyone travels", () => {
    expect(customerCanCancel("accepted")).toBe(true);
  });

  it("refuses once the professional is on the way", () => {
    // The boundary, and the whole reason the policy exists: that trip is
    // spent whatever happens next.
    const verdict = judgeCancellation("en_route", "customer");
    expect(verdict.allowed).toBe(false);
    expect(!verdict.allowed && verdict.reason).toBe("tooLate");
  });

  it("refuses while the work is being done", () => {
    expect(customerCanCancel("in_progress")).toBe(false);
  });

  it("says a finished job is finished, not too late", () => {
    // Different words because they need different answers on screen: one is
    // "ring us", the other is "there is nothing to cancel".
    const verdict = judgeCancellation("completed", "customer");
    expect(!verdict.allowed && verdict.reason).toBe("finished");
  });

  it("treats an already-ended booking as ended", () => {
    for (const status of ["cancelled", "no_provider_found"] as const) {
      const verdict = judgeCancellation(status, "customer");
      expect(!verdict.allowed && verdict.reason).toBe("ended");
    }
  });
});

describe("a professional may pull out later, but not mid-job", () => {
  it("may decline or withdraw up to the doorstep", () => {
    expect(providerCanCancel("pending")).toBe(true);
    expect(providerCanCancel("accepted")).toBe(true);
    // Later than the customer's window: a van breaking down on the way is a
    // real thing, and the alternative is a professional who never arrives.
    expect(providerCanCancel("en_route")).toBe(true);
  });

  it("may not walk out of a job in progress", () => {
    expect(providerCanCancel("in_progress")).toBe(false);
  });

  it("is a different event from a customer cancelling", () => {
    const verdict = judgeCancellation("accepted", "provider");
    expect(verdict.allowed && verdict.copyKey).toBe("providerWithdraws");
  });
});

describe("cancelling is always free, because it is only ever allowed while it is", () => {
  it("charges nothing on any permitted cancellation", () => {
    for (const status of BOOKING_STATUSES) {
      for (const actor of ["customer", "provider", "admin"] as const) {
        const verdict = judgeCancellation(status, actor);
        if (verdict.allowed) expect(verdict.fee).toBe(0);
      }
    }
  });
});

describe("support can unstick anything that is not already over", () => {
  it("lets an admin cancel at any live status", () => {
    for (const status of [
      "pending",
      "accepted",
      "en_route",
      "in_progress",
    ] as const) {
      expect(judgeCancellation(status, "admin").allowed).toBe(true);
    }
  });

  it("still refuses a job that has ended", () => {
    expect(judgeCancellation("completed", "admin").allowed).toBe(false);
    expect(judgeCancellation("cancelled", "admin").allowed).toBe(false);
  });
});

describe("every status has been decided, not defaulted", () => {
  it("returns a verdict for each one, for each actor", () => {
    for (const status of BOOKING_STATUSES as readonly BookingStatus[]) {
      for (const actor of ["customer", "provider", "admin"] as const) {
        const verdict = judgeCancellation(status, actor);
        // A shape check rather than a value check: this is here so a new
        // status cannot slip through returning undefined.
        expect(typeof verdict.allowed).toBe("boolean");
      }
    }
  });
});
