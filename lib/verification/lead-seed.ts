import { knownTrade } from "./requirements";

/**
 * The handover from the open door to the real one.
 *
 * `/providers/join` takes five fields from somebody with no account;
 * `/providers/apply` is eight steps and needs four of those five. Making
 * somebody who filled the short form ten minutes ago retype their own name,
 * trade and ward is the exact friction that loses supply on a long form, and
 * it is entirely avoidable — the lead is keyed by phone and so are they.
 *
 * PURE, AND HERE RATHER THAN IN THE DATA LAYER. `lib/data/applications.ts` is
 * `server-only` and reaches React's `cache` through the audit log, so a rule
 * living there cannot be tested without a database it has no business needing.
 * The rule is the part that can be wrong; the query around it is not.
 */

/** What a lead knows about somebody, before any of it is verified. */
export type ProviderLead = {
  id: string;
  fullName: string;
  categorySlug: string;
  areaKey: string;
  yearsExperience: number;
};

/** The four answers a lead can give an application. Structurally a StepPatch. */
export type LeadSeed = {
  fullName?: string;
  trades?: string[];
  serviceAreas?: string[];
  yearsExperience?: number;
};

/**
 * One lead's five fields, as the application's first four answers.
 *
 * THE ONE PLACE THAT KNOWS THE MAPPING, so there is a single answer to "which
 * lead field becomes which application field" rather than that knowledge being
 * spread across an insert statement.
 *
 * `knownTrade` guards the category: a lead written before a trade was renamed
 * would otherwise seed an application with a slug that no longer exists, and
 * the applicant would see an empty trade list with no idea why. Losing the
 * trade must not lose the name and the ward with it.
 *
 * No lead gives an empty patch, which is the ordinary case for anybody who
 * came straight to /apply. It is not an error and is never reported as one.
 */
export function seedFromLead(lead: ProviderLead | null): LeadSeed {
  if (!lead) return {};
  return {
    fullName: lead.fullName,
    trades: knownTrade(lead.categorySlug) ? [lead.categorySlug] : [],
    serviceAreas: [lead.areaKey],
    yearsExperience: lead.yearsExperience,
  };
}
