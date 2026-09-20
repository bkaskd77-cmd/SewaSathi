import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { LIST_NOTE_KINDS, listNoteKey } from "@/lib/notify/channel";

/**
 * A notification kind with no sentence must show nothing, never its own name.
 *
 * THE REGRESSION. `/bookings` built the catalogue key by stripping `booking.`
 * off the kind, which is right for the kinds that carry that prefix and wrong
 * for every other one. next-intl reads a dot as nesting and renders a miss as
 * the key path, so an unread `claim.resolved` put
 * `booking.notifications.claim.resolved` on a customer's list — no build
 * error, no runtime error, and invisible to `check:messages` because both
 * languages are equally missing it. Found while adding the two refund kinds,
 * which would have walked straight into it.
 */

const catalogue = (locale: "en" | "ne") =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).booking
    .notifications as Record<string, string>;

describe("turning a notification kind into a sentence", () => {
  it("does not leak a key path for a kind with no copy", () => {
    // The exact kind that shipped broken.
    expect(listNoteKey("claim.resolved")).toBeNull();
    expect(listNoteKey("claim.opened")).toBeNull();
    expect(listNoteKey("claim.ledger")).toBeNull();
  });

  it("returns null rather than something for a kind nobody defined", () => {
    expect(listNoteKey("booking.somethingNew")).toBeNull();
    expect(listNoteKey("")).toBeNull();
    expect(listNoteKey("notifications.accepted")).toBeNull();
  });

  it("names a leaf, never a dotted path — a dot is what broke it", () => {
    for (const kind of LIST_NOTE_KINDS) {
      expect(listNoteKey(kind)).not.toContain(".");
    }
  });

  it("every allowed kind has copy in both catalogues", () => {
    const en = catalogue("en");
    const ne = catalogue("ne");
    for (const kind of LIST_NOTE_KINDS) {
      const key = listNoteKey(kind)!;
      expect(en[key], `en is missing ${key} (for ${kind})`).toBeTruthy();
      expect(ne[key], `ne is missing ${key} (for ${kind})`).toBeTruthy();
    }
  });

  it("carries the two refund kinds, which are separate events", () => {
    // Approved is not sent. One key covering both would have to be written
    // before the second happened.
    expect(listNoteKey("claim.refundApproved")).toBe("refundApproved");
    expect(listNoteKey("claim.refundSent")).toBe("refundSent");
  });
});
