import { describe, expect, it } from "vitest";

import {
  PROSE_DOCUMENTS,
  REVIEW_SCOPE,
  inScope,
  leaves,
} from "../../scripts/ne-review-scope.mjs";

/**
 * The Nepali backlog counts itself.
 *
 * WHY A DERIVED SCOPE RATHER THAN A LIST. The native-speaker pass happens once,
 * before launch, and every phase between now and then adds Nepali. A
 * hand-maintained list of "strings awaiting a native ear" is complete until the
 * first time somebody forgets to append to it, and nothing about it says when
 * that happened. Namespace rules cannot forget: a key added under
 * `booking.payment` is in scope the moment it exists.
 *
 * WHAT THIS PINS. That the rules actually match by prefix and not by substring
 * (`booking.paymentsomething` is a different namespace), that the hand-kept
 * reviewed list subtracts, and that the scope stays a batch somebody can
 * actually sit down with rather than the whole catalogue.
 */

describe("what falls in scope", () => {
  const catalogue = {
    booking: {
      payment: { paid: { title: "Paid" } },
      paymentish: { nope: "not this namespace" },
      bookings: { needs: { pay: "Pay" } },
    },
    safety: { gas: "Leave the building" },
    home: { lead: "Nothing to review here" },
  };

  it("takes a namespace and its descendants", () => {
    const keys = inScope(catalogue).map((entry) => entry.key);
    expect(keys).toContain("booking.payment.paid.title");
    expect(keys).toContain("safety.gas");
  });

  /*
   * A prefix match on the raw string would pull `booking.paymentish` in with
   * `booking.payment`, and the person doing the pass would be handed strings
   * from a screen nobody claimed was in scope.
   */
  it("matches on the dot boundary, not on the characters", () => {
    const keys = inScope(catalogue).map((entry) => entry.key);
    expect(keys).not.toContain("booking.paymentish.nope");
  });

  it("leaves everything else alone", () => {
    const keys = inScope(catalogue).map((entry) => entry.key);
    expect(keys).not.toContain("home.lead");
    expect(keys).not.toContain("booking.bookings.needs.pay");
  });

  it("carries the tier and the reason, so the report can group and explain", () => {
    const entry = inScope(catalogue).find(
      (e) => e.key === "booking.payment.paid.title",
    );
    expect(entry?.tier).toBe("money");
    expect(entry?.why.length).toBeGreaterThan(20);
  });
});

describe("signing one off", () => {
  const catalogue = { safety: { gas: "Leave", fire: "Get out" } };

  it("drops a key somebody has read", () => {
    const waiting = inScope(catalogue, ["safety.gas"]).filter((e) => !e.reviewed);
    expect(waiting.map((e) => e.key)).toEqual(["safety.fire"]);
  });

  it("still reports it as in scope, so the denominator does not shrink", () => {
    // "3 of 200 read" is progress; "3 of 3 read" is a lie by omission.
    expect(inScope(catalogue, ["safety.gas"])).toHaveLength(2);
  });
});

describe("the real catalogue", () => {
  it("is a batch a person could sit down with", async () => {
    const ne = (await import("../../messages/ne.json")).default;
    const scope = inScope(ne);
    // Not an arbitrary ceiling: the whole catalogue is ~1,400 keys and the
    // point of the tiers is that the pass is finishable. If this fails because
    // a tier was widened, the question is whether the pass is still one sitting.
    expect(scope.length).toBeGreaterThan(50);
    expect(scope.length).toBeLessThan(400);
  });

  it("every rule matches something, so a renamed namespace is caught", async () => {
    const ne = (await import("../../messages/ne.json")).default;
    const keys = leaves(ne);
    for (const { prefix } of REVIEW_SCOPE) {
      const hit = keys.some((k) => k === prefix || k.startsWith(`${prefix}.`));
      expect(hit, `no key matches the scope rule "${prefix}"`).toBe(true);
    }
  });
});

describe("the Nepali that is not in the catalogue", () => {
  /*
   * THE GAP THE RULE TEST FOUND. The first version of the scope named a
   * `provider.standards` namespace that does not exist — the enforcement
   * ladder and the three legal pages are long-form documents in
   * `lib/content/`, not message keys. A backlog built from the catalogue alone
   * reported them as read when nobody had looked at them, which is the exact
   * failure the whole mechanism exists to prevent, one directory over.
   */
  it("names every prose document, and each one exists", async () => {
    const { existsSync } = await import("node:fs");
    expect(PROSE_DOCUMENTS.length).toBeGreaterThan(0);
    for (const { path: file } of PROSE_DOCUMENTS) {
      expect(existsSync(file), `${file} is listed but not on disk`).toBe(true);
    }
  });

  it("carries a reason for each, so the reviewer knows what it costs", () => {
    for (const doc of PROSE_DOCUMENTS) {
      expect(doc.why.length).toBeGreaterThan(20);
      expect(doc.tier.length).toBeGreaterThan(0);
    }
  });
});
