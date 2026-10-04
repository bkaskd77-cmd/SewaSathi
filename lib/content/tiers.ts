/**
 * Which tier a message key belongs to, and whether editing it keeps history.
 *
 * ONE RULE, NOT TWO. `scripts/ne-review-scope.mjs` already maps a namespace prefix to
 * `money`, `safety`, `legal` or `staff` — it is what decides which Nepali strings block
 * a launch — and the content editor needs exactly the same answer to decide which edits
 * keep a revision. Writing a second list here would be the duplication this repository
 * has paid for repeatedly: two copies that agree until somebody edits one.
 *
 * SO THE SCRIPT IS THE SOURCE AND THIS IMPORTS IT. `REVIEW_SCOPE` and `BLOCKING_TIERS`
 * are plain data in an `.mjs` module with no Node-only imports, so a TypeScript module
 * can read them directly. `tests/unit/content-tiers.test.ts` asserts the two stay
 * aligned, because an import is only as good as the shape on the other side.
 */
import { BLOCKING_TIERS, REVIEW_SCOPE } from "../../scripts/ne-review-scope.mjs";

export type ContentTier = "money" | "safety" | "legal" | "staff" | "none";

type ScopeRule = { tier: string; prefix: string; why: string };

const RULES = REVIEW_SCOPE as ScopeRule[];

/**
 * The tier for a key, or `none` when no rule claims it.
 *
 * `none` IS A REAL ANSWER AND NOT A FAILURE. Most of the catalogue is ordinary
 * interface copy — a button label, a column heading — that nothing blocks a launch for
 * and nothing needs a revision trail over. Treating an unclaimed key as `staff` would
 * quietly widen the blocking backlog; treating it as `money` would make every edit keep
 * history for no reason.
 *
 * LONGEST PREFIX WINS, so `booking.detail.cancel` (money) is not swallowed by a shorter
 * rule that happens to also match. The scope script finds the first match because its
 * list is authored in order; this cannot rely on that, because it is asked about one
 * key at a time rather than walking the catalogue.
 */
export function tierFor(key: string): ContentTier {
  let best: ScopeRule | null = null;
  for (const rule of RULES) {
    if (key !== rule.prefix && !key.startsWith(`${rule.prefix}.`)) continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best ? (best.tier as ContentTier) : "none";
}

/**
 * Does an edit to this key have to keep a revision?
 *
 * THE MONEY, SAFETY AND LEGAL TIERS, which is the same three that block a launch —
 * because the reason is the same. A wrong word in a price explanation, a safety
 * instruction or the terms costs somebody money or safety and cannot be noticed by
 * reading the screen it is on. Those are the edits worth being able to undo precisely
 * rather than from memory.
 */
export function keepsHistory(tier: ContentTier): boolean {
  return (BLOCKING_TIERS as string[]).includes(tier);
}

/**
 * Keys an admin may change at all.
 *
 * `admin.*` IS REFUSED, and it is the one exclusion. 551 of the catalogue's 1,855 keys
 * are strings only staff read — including the strings on the editing screen itself. An
 * admin who breaks `admin.content.save` breaks the button they would need to fix it,
 * and no customer ever sees the benefit. Enforced here rather than by a check
 * constraint, because the exclusion is about namespaces and the database should not
 * hold a second copy of a namespace list.
 */
export function isEditable(key: string): boolean {
  return !key.startsWith("admin.");
}
