import { describe, expect, it } from "vitest";

import { guaranteeFor } from "@/lib/config/guarantee";
import {
  cutoffFor,
  deletesEarlyOn,
  isExpired,
  RETENTION,
  retentionIsArmed,
} from "@/lib/retention/policy";

/**
 * How long we keep things.
 *
 * The rules are pure so they can be argued about here rather than inside a
 * cron job. The cases below are about the properties that would make a
 * retention policy dangerous rather than useful: deleting the financial record
 * along with the personal data, deleting sooner than a dispute arrives, or
 * running at all before anybody has approved the numbers.
 */

const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY);

describe("nothing is deleted before it has stopped being useful", () => {
  it("keeps a booking photo through the guarantee window it serves", () => {
    // Sixty days: the 30-day repair guarantee, plus a month of slack for a
    // claim made on the last day and settled slowly.
    expect(isExpired("bookingPhotos", at(30))).toBe(false);
    expect(isExpired("bookingPhotos", at(59))).toBe(false);
  });

  it("deletes it once that window has closed", () => {
    expect(isExpired("bookingPhotos", at(61))).toBe(true);
  });

  it("outlives the repair guarantee it exists for", () => {
    // The photo has to survive a claim made on the last day of the window,
    // not merely until the window opens. Tied to the guarantee rather than
    // chosen on its own, so moving one moves the other deliberately.
    expect(RETENTION.bookingPhotos.days).toBeGreaterThan(
      guaranteeFor("plumbing").days,
    );
  });

  it("holds a saved address for two years after its last booking", () => {
    // A customer who comes back expects it to be there, and retyping it is a
    // real cost to them. Two years is where that stops being worth the risk.
    expect(isExpired("addresses", at(500))).toBe(false);
    expect(isExpired("addresses", at(800))).toBe(true);
  });

  it("never expires anything whose clock has not started", () => {
    // A booking with no completion date is a booking still running.
    expect(isExpired("bookingPhotos", null)).toBe(false);
  });

  it("ignores a date it cannot read rather than treating it as ancient", () => {
    // The dangerous direction: an unparseable timestamp read as epoch zero
    // would make every such row instantly expired.
    expect(isExpired("addresses", "not a date")).toBe(false);
  });
});

describe("money outlives everything else", () => {
  it("keeps payment records far longer than security events", () => {
    expect(RETENTION.paymentEvents.days).toBeGreaterThan(
      RETENTION.securityEvents.days,
    );
  });

  it("keeps them for years, not months", () => {
    // Erring long here costs storage. Erring short costs a penalty.
    expect(RETENTION.paymentEvents.days).toBeGreaterThanOrEqual(1825);
  });
});

describe("the identifying half goes and the record stays", () => {
  it("redacts an address rather than deleting it", () => {
    /*
     * Bookings reference addresses and a booking is a financial record.
     * Deleting the row would take that with it, which is why "delete
     * everything" is the wrong instrument — the doorstep goes, the ward stays.
     */
    expect(RETENTION.addresses.action).toBe("redact");
  });

  it("redacts the triage text rather than the whole log", () => {
    // The pricing signal is in the category; the sentence is about a person.
    expect(RETENTION.triageText.action).toBe("redact");
  });

  it("deletes an identity document outright, because there is no half of it worth keeping", () => {
    expect(RETENTION.rejectedDocuments.action).toBe("delete");
    expect(RETENTION.verifiedDocuments.action).toBe("delete");
  });

  it("holds a rejected document for far less time than a verified one", () => {
    // A rejected citizenship certificate proves nothing and is the most
    // dangerous thing in the building.
    expect(RETENTION.rejectedDocuments.days).toBeLessThan(
      RETENTION.verifiedDocuments.days,
    );
  });

  it("gives somebody long enough to fetch a missing police clearance", () => {
    /*
     * The first number here was thirty days, reasoned only from "how long to
     * appeal". Most rejections are not appeals — they are a missing paper, and
     * getting one in Nepal means weeks of queuing at an office that is shut
     * half the days you can go. At thirty days somebody who did everything we
     * asked comes back with the certificate and has to re-upload their whole
     * identity from nothing.
     */
    expect(RETENTION.rejectedDocuments.days).toBeGreaterThanOrEqual(90);
  });

  it("deletes a rejected document the moment a re-application is approved", () => {
    /*
     * The privacy answer is not a shorter clock, it is this. On the common
     * path the documents are held for LESS time than thirty days would have;
     * only somebody who never comes back has theirs kept to the full window.
     * Phase 10 must call this at the point of approval, which is why it is a
     * named obligation rather than a comment.
     */
    expect(deletesEarlyOn("rejectedDocuments")).toBeTruthy();
    expect(deletesEarlyOn("addresses")).toBeNull();
  });
});

describe("the sweep does not run until somebody has approved the numbers", () => {
  it("is disarmed unless the environment says otherwise", () => {
    // A retention policy that starts deleting the moment it merges is a data
    // loss incident with a changelog entry.
    expect(retentionIsArmed()).toBe(false);
  });

  it("computes a cutoff in the past, not the future", () => {
    const cutoff = cutoffFor("notifications");
    expect(cutoff.getTime()).toBeLessThan(Date.now());
  });

  it("gives every rule a reason somebody can argue with", () => {
    for (const [key, rule] of Object.entries(RETENTION)) {
      expect(rule.why.length, `${key} has no reasoning`).toBeGreaterThan(20);
      expect(rule.from.length, `${key} does not say what starts its clock`).toBeGreaterThan(5);
      expect(rule.days, `${key} has an implausible duration`).toBeGreaterThan(0);
    }
  });
});
