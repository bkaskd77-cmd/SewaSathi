import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { notificationPath } from "@/lib/notify/path";

/**
 * Where a notification takes the person who taps it.
 *
 * EVERY PUSH IN THIS PRODUCT OPENED THE CUSTOMER'S BOOKING PAGE. The service
 * worker derived the path from the booking id alone, and three kinds that wake
 * a phone go to a professional — so `booking.assigned`, which exists to get
 * somebody to accept work, landed them on a route that reads scoped to the
 * customer and then answers 404.
 *
 * THE WORST ONE CARRIES NO BOOKING AT ALL. `payout.destinationChanged` is the
 * account-takeover control, push-only by design because an SMS read at send
 * time warns whoever took the account over — and its push opened `/bookings`,
 * a customer's job list, rather than the money screen the warning is about.
 *
 * **ITS IN-APP HALF WAS ALREADY FINE and a first draft of this phase claimed
 * otherwise.** `/provider/payouts` carries that sentence itself, off
 * `payout_destinations`, with the date the account changed and a number to
 * ring, and `notification-copy.test.ts` pins the absent `LIST_NOTES` entry as a
 * decision so nobody puts a payout warning on a customer's booking list. A
 * second copy on the same screen was written here and reverted: two surfaces
 * answering one question is the thing this repo refuses. What was broken is
 * only where the tap landed.
 */

describe("a provider-bound notification opens the provider's product", () => {
  it("sends work being offered to the jobs screen, not the customer's booking", () => {
    /*
     * THE CASE THAT 404ED. `/bookings/{id}` reads with `{ customerId }` and
     * calls `notFound()`, so this was a dead end on the one notification whose
     * whole purpose is getting a job accepted.
     */
    const path = notificationPath({
      kind: "booking.assigned",
      audience: "provider",
      bookingId: "abc",
    });
    expect(path).toBe("/provider/jobs#job-abc");
    expect(path.startsWith("/bookings")).toBe(false);
  });

  it("sends the payout warning to the money screen", () => {
    /* It has no booking and never will — it is about where this person is
       paid, and the reader's one judgement ("that is not mine") can only be
       made beside the account. */
    expect(
      notificationPath({
        kind: "payout.destinationChanged",
        audience: "provider",
        bookingId: null,
      }),
    ).toBe("/provider/payouts");
  });

  it("falls back to the jobs list when there is no booking", () => {
    expect(
      notificationPath({
        kind: "booking.widened",
        audience: "provider",
        bookingId: null,
      }),
    ).toBe("/provider/jobs");
  });
});

describe("a customer-bound notification is unchanged", () => {
  it("opens the booking, or the list without one", () => {
    expect(
      notificationPath({
        kind: "booking.accepted",
        audience: "customer",
        bookingId: "xyz",
      }),
    ).toBe("/bookings/xyz");
    expect(
      notificationPath({
        kind: "booking.noProviderFound",
        audience: "customer",
        bookingId: null,
      }),
    ).toBe("/bookings");
  });
});

describe("the same kind goes both ways, which is why the audience decides", () => {
  it("routes booking.quoteExpired by who is reading it", () => {
    /*
     * THE REASON A MAP FROM KIND TO PATH CANNOT WORK. This kind is sent to the
     * customer in one place in `lib/data/survey.ts` and to the professional in
     * another, so any per-kind table would be wrong for one of them whichever
     * way it was written.
     */
    const forCustomer = notificationPath({
      kind: "booking.quoteExpired",
      audience: "customer",
      bookingId: "q1",
    });
    const forProvider = notificationPath({
      kind: "booking.quoteExpired",
      audience: "provider",
      bookingId: "q1",
    });
    expect(forCustomer).not.toBe(forProvider);
    expect(forCustomer).toBe("/bookings/q1");
    expect(forProvider).toBe("/provider/jobs#job-q1");
  });
});

describe("every notification says which side it is for", () => {
  /**
   * THE WIRING, NOT THE FUNCTION — #18's lesson. `audience` being required is
   * what put the question in front of all twenty-eight senders, and a later
   * one added with the wrong side would route a professional into the
   * customer's product again with everything above still green.
   *
   * The recipient expression is the evidence: a call writing
   * `recipientId: booking.customerId` must say `customer`, and one writing
   * `providerId` or a listing's `profileId` must say `provider`.
   */
  /** Every data module. `lib/notify` is excluded: it defines the field. */
  function sources(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry === "notify") continue;
        found.push(...sources(path));
      } else if (entry.endsWith(".ts")) {
        found.push(path);
      }
    }
    return found;
  }

  const files = sources("lib");

  it("agrees with its own recipient expression at every call site", () => {
    const wrong: string[] = [];
    let checked = 0;

    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const declared = /audience: "(customer|provider)"/.exec(line);
        if (!declared) return;
        /* On this line for a both-sides literal, else the line above it. */
        const context = line.includes("recipientId")
          ? line
          : (lines[i - 1] ?? "");
        if (!context.includes("recipientId")) return;
        checked += 1;

        const expression = context.split("recipientId:")[1] ?? "";
        const provider = /provider|profileId/i.test(expression);
        const customer = /customer/i.test(expression);
        if (provider === customer) return; // not decidable from the expression
        const expected = provider ? "provider" : "customer";
        if (declared[1] !== expected) {
          wrong.push(
            `${file}:${i + 1} says ${declared[1]} for ${expression.trim()}`,
          );
        }
      });
    }

    /* Asserted first: a pattern that stopped matching would make the case
       below pass over nothing, which is how a guard goes quiet. */
    expect(checked, "no audiences found — the pattern has stopped matching")
      .toBeGreaterThan(20);
    expect(wrong).toEqual([]);
  });
});
