import type { Provider } from "@/lib/data/providers";
import { rankProviders } from "@/lib/data/ranking";

/**
 * Who to offer a customer whose professional has just pulled out.
 *
 * This is the moment the product either earns its keep or loses the customer.
 * Somebody asked for a specific person, was told yes, and has now been told
 * no — and every minute they spend on a screen that only says "we are looking"
 * is a minute they spend finding a number in a shop window instead. So the
 * answer to a withdrawal is never "wait": it is three names, ready to book,
 * chosen the same way the directory would choose them.
 *
 * PURE ON PURPOSE. The database read lives in `lib/data/providers.ts`; this is
 * the decision, and it is a decision worth testing directly — the failure it
 * guards against is showing somebody the professional who just walked away.
 *
 * THE WIDENING IS TIERED, NOT FILTERED. A ward is where travel is cheap and
 * fast, and it is where the search starts; but a customer with one plumber
 * left in their ward is not helped by being shown one plumber. So the tiers
 * fill in order — ward, then the rest of the city, then anywhere we operate —
 * and each suggestion carries the tier it came from, because "20 minutes away"
 * is information the customer needs before they tap, not after somebody fails
 * to arrive.
 *
 * Ranking inside a tier is the ordinary one, urgency and all, which means the
 * withdrawal penalty applies here too: the replacement for somebody who pulled
 * out is not chosen from people who habitually pull out.
 */

export type Reach = "ward" | "city" | "anywhere";

export type Alternative = {
  provider: Provider;
  /** How far this suggestion reaches for. Shown, never silently applied. */
  reach: Reach;
  relevance: number;
};

/** Three. Enough to feel like a choice, few enough to decide on a phone. */
export const MAX_ALTERNATIVES = 3;

function reachOf(provider: Provider, area: string | null | undefined): Reach {
  if (!area) return "anywhere";
  if (provider.serviceAreas.includes(area)) return "ward";
  const city = area.split("-")[0];
  return provider.serviceAreas.some((a) => a.startsWith(`${city}-`))
    ? "city"
    : "anywhere";
}

const TIERS: Reach[] = ["ward", "city", "anywhere"];

export function pickAlternatives(
  providers: Provider[],
  options: {
    /** The customer's ward, e.g. "lalitpur-4". */
    area?: string | null;
    urgency?: string | null;
    /**
     * Listings that must not appear: whoever just refused, and whoever holds
     * the job now. Refusing a job and being offered it back one screen later
     * is the single worst thing this list could do.
     */
    exclude?: readonly string[];
    limit?: number;
  } = {},
): Alternative[] {
  const excluded = new Set(options.exclude ?? []);
  const limit = options.limit ?? MAX_ALTERNATIVES;

  const eligible = providers.filter((p) => !excluded.has(p.id));
  const ranked = rankProviders(eligible, {
    urgency: options.urgency,
    area: options.area,
  });

  const out: Alternative[] = [];
  for (const tier of TIERS) {
    for (const provider of ranked) {
      if (out.length >= limit) return out;
      if (reachOf(provider, options.area) !== tier) continue;
      out.push({ provider, reach: tier, relevance: provider.relevance });
    }
  }
  return out;
}
