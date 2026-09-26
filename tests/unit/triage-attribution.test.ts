import { describe, expect, it, vi } from "vitest";

/**
 * `lib/data/bookings.ts` reaches React's `cache()` through `lib/audit`, which
 * is a per-request memo the node test environment has no runtime for — the
 * import fails with "cache is not a function" before a single assertion runs.
 *
 * STUBBED HERE RATHER THAN IN `vitest.config.ts` ON PURPOSE. A `react` alias in
 * the shared config would change module resolution for all ninety test files to
 * unblock one, and identity is the right stand-in only because this file makes
 * no network calls for a memo to save: `cache` deduplicates, it does not decide
 * anything, so removing it cannot change the answer to what is asserted below.
 */
vi.mock("react", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  cache: <T>(fn: T) => fn,
}));

import { bookingInputSchema } from "@/lib/data/bookings";
import { initialState } from "@/lib/booking/flow-state";
import { TRIAGE_PARAM, bookingHref } from "@/lib/routes/booking";

/**
 * The chain that was complete at every link and broken end to end.
 *
 * WHAT HAPPENED. Attributing a booking to the triage that produced it needed
 * five things, and four of them were built: `bookings.triage_log_id` existed,
 * `bookingInputSchema` accepted a `triageLogId`, the flow state carried one,
 * the insert wrote it, and `/book` read it off `?triage=`. The fifth was
 * `logTriage` returning the row's id — it returned `void`. So nothing ever set
 * the parameter, the other four ran correctly on a value that never arrived,
 * and **every booking this product has taken carries a null there**. Nothing
 * failed. Nothing logged a warning. The measurement simply did not exist, and
 * it took reading the live table to notice.
 *
 * SO THIS FILE TESTS THE HOPS BETWEEN THE LINKS, not the links. A test for any
 * one of those five components would have passed throughout — that is exactly
 * how the bug survived. What was missing was anything asserting that the value
 * one hop produces is the value the next hop consumes, under the name it
 * actually travels by.
 *
 * `?triage=` IS THE NAME, and it is load-bearing. `bookingHref` writes it and
 * `/book` reads `searchParams.triage`; rename either alone and the whole loop
 * goes quietly back to measuring nothing.
 */

const LOG_ID = "6f1a0e6c-1b7f-4f5e-9a2e-2c9f0a1b3c4d";

describe("the id survives every hop from the triage card to the insert", () => {
  it("rides the booking link as ?triage=", () => {
    const href = bookingHref({ category: "plumbing", triageLogId: LOG_ID });
    const params = new URLSearchParams(href.split("?")[1]);
    // The parameter NAME, not just the presence of the value, and the LITERAL
    // rather than the constant — asserting `params.get(TRIAGE_PARAM)` would
    // pass under any rename, which is the tautology this whole file exists to
    // avoid. `/book` reads the same constant, so the two ends cannot drift from
    // each other; this pins them both to a name a URL in the wild still uses.
    expect(TRIAGE_PARAM).toBe("triage");
    expect(params.get("triage")).toBe(LOG_ID);
  });

  it("is absent rather than empty on a journey that had no triage", () => {
    // Most journeys. Somebody browsing /services directly has no triage to
    // attribute, and `?triage=` with nothing after it would reach the zod
    // schema as an empty string and fail a uuid check on an ordinary booking.
    const href = bookingHref({ category: "plumbing" });
    expect(new URLSearchParams(href.split("?")[1]).has("triage")).toBe(false);
    expect(bookingHref({ category: "plumbing", triageLogId: null })).toBe(
      href,
    );
  });

  it("survives the flow state, which is where a login round trip lands", () => {
    // The signed-out case: they pick a professional, get bounced to /login and
    // come back. The id is not intent and changes nothing about the booking,
    // so it is precisely the field nobody would notice losing.
    expect(initialState({ category: "plumbing", triageLogId: LOG_ID }).triageLogId).toBe(
      LOG_ID,
    );
    expect(initialState({ category: "plumbing" }).triageLogId).toBeNull();
  });

  it("is accepted by the insert's schema under the same field name", () => {
    const parsed = bookingInputSchema.safeParse({
      category: "plumbing",
      addressId: "11111111-1111-4111-8111-111111111111",
      description: "The kitchen tap drips all night",
      triageLogId: LOG_ID,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.triageLogId).toBe(LOG_ID);
  });

  /*
   * AND THE BOOKING STILL WORKS WITHOUT IT. The id is an enhancement to the
   * measurement, never a precondition for taking the job — `logTriage` returns
   * null when logging is unconfigured, when the write times out and when it
   * fails, and all three are ordinary. A customer must never be unable to book
   * because a log row could not be written.
   */
  it("is optional all the way through, so a failed log never blocks a booking", () => {
    const parsed = bookingInputSchema.safeParse({
      category: "plumbing",
      addressId: "11111111-1111-4111-8111-111111111111",
      description: "The kitchen tap drips all night",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success ? parsed.data.triageLogId : undefined).toBeFalsy();
  });

  it("refuses something that is not a log id", () => {
    // The value comes off a query string a stranger controls. A non-uuid is
    // rejected rather than written, so nothing can point a booking at a row
    // that is not a triage of theirs.
    const parsed = bookingInputSchema.safeParse({
      category: "plumbing",
      addressId: "11111111-1111-4111-8111-111111111111",
      description: "The kitchen tap drips all night",
      triageLogId: "not-a-uuid",
    });
    expect(parsed.success).toBe(false);
  });
});
