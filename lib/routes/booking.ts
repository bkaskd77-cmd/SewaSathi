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
}): string {
  const params = new URLSearchParams({ category: options.category });
  if (options.providerId) params.set("provider", options.providerId);
  if (options.urgency) params.set("urgency", options.urgency);
  if (options.q) params.set("q", options.q);
  if (options.band) params.set("band", options.band);
  return `/book?${params.toString()}`;
}
