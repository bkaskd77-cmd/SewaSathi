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
}): string {
  const params = new URLSearchParams({ category: options.category });
  if (options.providerId) params.set("provider", options.providerId);
  if (options.urgency) params.set("urgency", options.urgency);
  if (options.q) params.set("q", options.q);
  return `/book?${params.toString()}`;
}
