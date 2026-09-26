/**
 * The link into booking.
 *
 * One place builds this URL, because the booking flow (Phase 6) has to be able
 * to change its parameter names without a hunt through every card, profile and
 * triage result that links to it.
 *
 * The intent travels in the URL rather than in state: a logged-out customer is
 * sent through /login, and `safeRedirect` puts them back here — on the booking
 * they were making, with the professional and the urgency they chose, not on
 * the homepage.
 */
/**
 * The query parameter the triage id travels under.
 *
 * ONE CONSTANT BECAUSE THIS IS THE SEAM THAT BROKE. `bookingHref` writes it and
 * `/book` reads it, and for the whole life of the product nothing wrote it at
 * all — the measurement was lost at a seam rather than in any one component,
 * and a rename touching only one side would lose it again, silently and with
 * every test still green. Both sides import this, so they cannot disagree; the
 * literal string is pinned by `tests/unit/triage-attribution.test.ts`, so
 * renaming the constant itself fails loudly.
 */
export const TRIAGE_PARAM = "triage";

export function bookingHref(options: {
  category: string;
  providerId?: string | null;
  urgency?: string | null;
  /** What they typed into the hero, if they came that way. */
  q?: string | null;
  /**
   * Which product the triage identified, if it could tell.
   *
   * TRAVELS IN THE URL WITH EVERYTHING ELSE, for the same reason the rest of
   * the intent does: a signed-out customer goes through /login and comes back
   * here, and anything held in memory instead would be gone by then — leaving
   * the booking with no length for no reason other than that they had to sign
   * in.
   */
  band?: string | null;
  /** Which path named it — see the note on `bandSource` in lib/data/bookings. */
  bandSource?: string | null;
  /**
   * The `triage_logs` row that produced this journey, when there was one.
   *
   * TRAVELS THE SAME WAY AND FOR A DIFFERENT REASON. Everything else in this
   * URL is intent the customer would lose across a login round trip. This is
   * not intent at all — it changes nothing about the booking — it is the join
   * that lets us later ask whether the triage was right. It rides here because
   * this is the path the customer takes and there is nowhere else to put it.
   *
   * Absent on every journey that did not start at a logged triage, which is
   * most of them: somebody browsing /services directly has no triage to
   * attribute their booking to, and that is a fact rather than a gap.
   */
  triageLogId?: string | null;
}): string {
  const params = new URLSearchParams({ category: options.category });
  if (options.providerId) params.set("provider", options.providerId);
  if (options.urgency) params.set("urgency", options.urgency);
  if (options.q) params.set("q", options.q);
  if (options.band) params.set("band", options.band);
  // Only alongside a band. A source for no product is a fact about nothing.
  if (options.band && options.bandSource) {
    params.set("bandSource", options.bandSource);
  }
  if (options.triageLogId) params.set(TRIAGE_PARAM, options.triageLogId);
  return `/book?${params.toString()}`;
}
