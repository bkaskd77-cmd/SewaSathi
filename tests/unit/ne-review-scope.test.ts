import { describe, expect, it } from "vitest";

import {
  BLOCKING_TIERS,
  PROSE_DOCUMENTS,
  REVIEW_SCOPE,
  backlog,
  inScope,
  isBlockingTier,
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
    /*
     * Not an arbitrary ceiling: the whole catalogue is ~1,700 keys and the point of
     * the tiers is that the pass is finishable. If this fails because a tier was
     * widened, the question is whether the pass is still one sitting.
     *
     * IT WAS ASKED AND THE ANSWER IS NO, which is worth writing down rather than
     * raising the number again quietly. The scope went 288 → 346 (the payout
     * destination and payee name) → 393 (`/admin/payouts`) → 422 (the professional's
     * own money view), and at roughly twenty seconds a string that is over two
     * hours. One sitting it is not.
     *
     * The ceiling stays because the thing it actually guards is still true: the
     * scope must not drift toward the whole catalogue, where "everything needs a
     * native read" would mean nothing does. What had to change is the SHAPE of the
     * pass rather than its size.
     *
     * AND IT HAS: `nepali-native-read` now blocks on the money, safety and legal
     * tiers only — 273 keys and 4 documents — while the staff tier stays counted and
     * printed and does not hold a launch. So this number is no longer the size of the
     * thing somebody has to finish before shipping, which is why the cases below
     * assert the split by naming the namespaces rather than by counting them: a
     * count moves every time a phase adds a string, and a test that has to be
     * renumbered to stay green is a test people renumber without reading.
     */
    expect(scope.length).toBeGreaterThan(50);
    expect(scope.length).toBeLessThan(460);
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

/**
 * Which half of the backlog refuses a launch.
 *
 * WHAT THESE PIN AND WHY NOT A COUNT. `nepali-native-read` blocks on money, safety
 * and legal; the staff tier is counted, printed and does not hold a launch. The
 * cheap way to assert that is `blocking.keys.length === 273`, and it is the wrong
 * way twice over: it goes red every time a phase adds a payment string, so it gets
 * renumbered without being read, and renumbering it is exactly how somebody would
 * clear a launch by relabelling a money namespace as `staff` — the failure these
 * cases exist to catch.
 *
 * So they name the namespaces instead. A rule moved out of the blocking tiers fails
 * here, and adding strings to one does not.
 */
describe("the split that decides a launch", () => {
  const MUST_BLOCK = [
    "booking.payment",
    "booking.guarantee",
    "booking.notifications",
    "booking.detail.cancel",
    "booking.account",
    "provider.money",
    "provider.payouts",
    "join.apply.payout",
    "safety",
    "triage",
    "legal",
  ];

  /*
   * Each of these states a term, names a figure somebody is about to hand over, or
   * is read while frightened. `booking.detail.cancel` is in because in this product
   * the window IS the policy — there is no fee to soften a misreading — and
   * `booking.account` because the activity opt-out decides whether somebody's first
   * name appears on the homepage, which is consent rather than a preference.
   */
  it("holds a launch on every namespace that states a term or a figure", () => {
    for (const prefix of MUST_BLOCK) {
      const rule = REVIEW_SCOPE.find((r) => r.prefix === prefix);
      expect(rule, `no scope rule covers "${prefix}"`).toBeDefined();
      expect(
        isBlockingTier(rule!.tier),
        `"${prefix}" is tier "${rule!.tier}", which does not block a launch`,
      ).toBe(true);
    }
  });

  /* The other direction: the exclusion is the staff tier and nothing else. */
  it("does not hold a launch on an admin screen", () => {
    const admin = REVIEW_SCOPE.filter((r) => r.prefix.startsWith("admin."));
    expect(admin.length).toBeGreaterThan(0);
    for (const rule of admin) {
      expect(isBlockingTier(rule.tier), `${rule.prefix} blocks a launch`).toBe(
        false,
      );
    }
    expect(BLOCKING_TIERS).not.toContain("staff");
  });

  it("counts the staff tier even though it does not block, so it stays visible", async () => {
    const ne = (await import("../../messages/ne.json")).default;
    const { waiting } = backlog(ne, { keys: [] });
    // Reclassifying is not doing: the number keeps a denominator and a line of its own.
    expect(waiting.inScope).toBeGreaterThan(0);
    expect(waiting.keys.length).toBe(waiting.inScope);
  });

  /*
   * THE DOCUMENTS ARE IN THE BLOCKING HALF AND CAN NOW BE SIGNED OFF. They could
   * not be before: `ne-reviewed.json` held `keys`, a document has no key, and
   * `ne:review` listed all four unconditionally for ever — a gate on something
   * nobody can satisfy is not a gate.
   */
  it("blocks on the prose documents, and lets a path sign one off", async () => {
    const ne = (await import("../../messages/ne.json")).default;
    const before = backlog(ne, {});
    expect(before.blocking.documents.length).toBe(PROSE_DOCUMENTS.length);

    const after = backlog(ne, { documents: [PROSE_DOCUMENTS[0].path] });
    expect(after.blocking.documents.length).toBe(PROSE_DOCUMENTS.length - 1);
    // The denominator does not shrink — "3 of 4 read" is progress, "3 of 3" is not.
    expect(after.documents.length).toBe(PROSE_DOCUMENTS.length);
  });

  it("reads a missing sign-off file as nothing read, never as all clear", async () => {
    const ne = (await import("../../messages/ne.json")).default;
    expect(backlog(ne).blocking.keys.length).toBe(
      backlog(ne, { keys: [], documents: [] }).blocking.keys.length,
    );
    expect(backlog(ne).blocking.keys.length).toBeGreaterThan(0);
  });
});
