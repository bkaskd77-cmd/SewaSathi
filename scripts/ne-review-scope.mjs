/**
 * Which Nepali strings must a native speaker read before launch.
 *
 * WHY THIS IS DERIVED AND NOT A LIST SOMEBODY MAINTAINS. Every phase adds
 * Nepali, the backlog is reviewed once before launch rather than per phase, and
 * a hand-kept list of "strings awaiting a native ear" is a list that silently
 * stops being complete the first time somebody forgets to add to it. Namespace
 * rules cannot forget: a key added under `booking.payment` tomorrow is in scope
 * the moment it exists, with nobody having to remember anything.
 *
 * NOT EVERY STRING — THE ONES WHERE BEING WRONG COSTS SOMETHING. 1,400 keys is
 * not a review, it is a week nobody has. These are the screens where a
 * translation that merely means the right thing is not good enough:
 *
 *   money      a number somebody is about to pay, or a promise about their
 *              money. `booking.payment` carries the blind cash entry and the
 *              sentence that makes it honest; `booking.guarantee` is what the
 *              guarantee covers and for how long.
 *   safety     what somebody reads when they are frightened. The hazard lines
 *              are the reason `foldNepali` exists; wrong register here reads as
 *              a product that does not understand what is happening.
 *   legal      the terms a customer agrees to at sign-in, and the enforcement
 *              ladder a professional is judged by.
 *   staff      money copy on an admin screen. Lower stakes — no customer reads
 *              it — but a reviewer settling a disputed amount in bad Nepali is
 *              still deciding somebody's money.
 *
 * Anything outside these namespaces gets read if there is time, and is not what
 * `nepali-native-read` in LAUNCH-BLOCKERS.md is blocking on.
 */

/** Prefix → why it matters. Ordered most-costly first; the report prints in this order. */
export const REVIEW_SCOPE = [
  { tier: "money", prefix: "booking.payment", why: "A figure somebody is about to hand over, and the promise about their guarantee that makes blind entry honest." },
  { tier: "money", prefix: "booking.guarantee", why: "What the guarantee covers, for how long, and who pays for the return visit." },
  { tier: "money", prefix: "booking.notifications", why: "Told to somebody who is not looking at the screen — no surrounding context to repair a wrong word." },
  { tier: "safety", prefix: "safety", why: "Read while frightened. Register matters more than accuracy here." },
  { tier: "safety", prefix: "triage", why: "The first thing a stranger reads, and the path a hazard is described down." },
  { tier: "legal", prefix: "legal", why: "Labels around the terms a customer agrees to at sign-in. The prose itself is a document, not a key — see PROSE_DOCUMENTS." },
  { tier: "staff", prefix: "admin.mismatches", why: "A reviewer settling a disputed cash amount." },
  { tier: "staff", prefix: "admin.guaranteeClaims", why: "A reviewer deciding how much of a customer's money goes back, against a ceiling and a parts deduction they have to read correctly to weigh. Same room as admin.mismatches and a larger consequence: this one moves money out." },
  { tier: "money", prefix: "provider.jobs.materials", why: "A figure the professional types at settlement that later reduces what they can be asked to refund. Wrong wording here reads as 'what did the job cost', which is a different number." },
  { tier: "money", prefix: "provider.dashboard.claims.parts", why: "Their answer decides whether the parts cost comes off a refund they may fund. A mistranslated option is somebody answering the opposite of what they meant about their own money." },
];

/**
 * The Nepali that is NOT in the catalogue, and would have been missed.
 *
 * The enforcement ladder and the three legal pages are long-form documents in
 * `lib/content/`, written as `{ en: {...}, ne: {...} }` rather than as message
 * keys — so a scope built from `messages/ne.json` alone reports them as read
 * when nobody has looked at them at all. That is the exact failure this whole
 * mechanism exists to prevent, one directory over, and a test asserting every
 * rule matches something is what surfaced it.
 *
 * They are counted as documents rather than keys because there is nothing to
 * count: a section of prose is reviewed or it is not, and pretending it is 40
 * strings would make the backlog number meaningless in both directions.
 */
export const PROSE_DOCUMENTS = [
  {
    tier: "legal",
    path: "lib/content/pages/standards.ts",
    why: "The enforcement ladder, read by a professional deciding whether to trust us. Deterrence nobody can read is a trap rather than a deterrent.",
  },
  {
    tier: "legal",
    path: "lib/content/legal/terms.ts",
    why: "What a customer agrees to at sign-in.",
  },
  {
    tier: "legal",
    path: "lib/content/legal/privacy.ts",
    why: "What we hold about somebody and what we do with it.",
  },
  {
    tier: "legal",
    path: "lib/content/legal/refunds.ts",
    why: "The guarantee, the window, and who pays for the return visit.",
  },
];

/** Every leaf path in a catalogue, dot-separated. */
export function leaves(value, prefix = "") {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  );
}

/**
 * The keys in scope, each with the tier that put it there.
 *
 * `reviewed` is the hand-kept half and the only half a person edits: a key
 * moves out of the backlog when somebody has actually read it, which is not
 * something a rule can infer.
 */
export function inScope(catalogue, reviewed = []) {
  const done = new Set(reviewed);
  const out = [];
  for (const key of leaves(catalogue)) {
    const rule = REVIEW_SCOPE.find(
      (r) => key === r.prefix || key.startsWith(`${r.prefix}.`),
    );
    if (!rule) continue;
    out.push({ key, tier: rule.tier, prefix: rule.prefix, why: rule.why, reviewed: done.has(key) });
  }
  return out;
}
