/**
 * Which wards and trades are open to customers, as one rule.
 *
 * WHAT THIS IS FOR. A soft launch is "take work in two wards and two trades
 * until the first fifty jobs go well, then widen" — and the widening has to be
 * a tap rather than a deploy, or it happens late and under pressure. The
 * alternative mechanism already in the product is RETIREMENT, and it is the
 * wrong instrument: `retired_at` records that we STOPPED, with a reason and an
 * actor, so soft-launching through it writes a history saying we withdrew from
 * most of Kathmandu and then went back in. See the migration header.
 *
 * PURE, AND THAT IS WHY IT IS IN `lib/config/`. Four surfaces need this rule —
 * the catalogue read, the area read, `createBooking`'s refusal and the admin
 * screen — and a rule written four times is the shape this repository keeps
 * paying for. `lib/provider/measured.ts` is the same arrangement for "does this
 * stat have evidence behind it".
 *
 * THE SWITCH IS NOT DERIVED FROM THE LISTS, which is the one invariant here.
 * `enabled` says which question is being asked; the arrays only ever answer the
 * narrow one. Reading an empty array as "everything is open" would make a
 * truncated write open the whole country, and reading it as "nothing is open"
 * would close the product on the same accident — rule 6, where the default and
 * the measurement must not be the same value.
 */

/** The scope as the row holds it. */
export type LaunchScope = {
  enabled: boolean;
  areaKeys: readonly string[];
  categorySlugs: readonly string[];
};

/**
 * The scope a deployment with no database has: off, so everything live is open.
 *
 * `getCategories`' and `allAreas`' reasoning — with no keys the seed IS the
 * data, there is no row it can be stale against, and withholding the catalogue
 * would break a fresh checkout to guard against nothing. It is NOT the answer
 * to a FAILED read, which is a different fact and is `null`: see
 * `lib/data/launch-scope.ts`.
 */
export const SCOPE_OFF: LaunchScope = {
  enabled: false,
  areaKeys: [],
  categorySlugs: [],
};

/**
 * Is this ward or trade open to customers right now?
 *
 * ONE PREDICATE OVER BOTH KINDS, because the rule is identical and two copies
 * would be two places to forget the `enabled` clause. The caller says which
 * list to read; nothing here knows what an area or a category is.
 */
export function scopeAllows(
  scope: LaunchScope,
  kind: "area" | "category",
  key: string,
): boolean {
  if (!scope.enabled) return true;
  const open = kind === "area" ? scope.areaKeys : scope.categorySlugs;
  return open.includes(key);
}

/**
 * Is the scope actually holding anything back?
 *
 * For the screen and for `?debug=data`. A scope that is ON but names every live
 * ward and trade narrows nothing, and saying "soft launch active" over it would
 * be the kind of warning that teaches people to ignore warnings.
 */
export function scopeNarrows(
  scope: LaunchScope,
  liveAreaKeys: readonly string[],
  liveCategorySlugs: readonly string[],
): boolean {
  if (!scope.enabled) return false;
  return (
    liveAreaKeys.some((key) => !scope.areaKeys.includes(key)) ||
    liveCategorySlugs.some((slug) => !scope.categorySlugs.includes(slug))
  );
}

/**
 * What the admin screen says about the scope as it stands, in one word.
 *
 * FOUR STANDINGS AND THE FOURTH IS THE ONE WORTH HAVING. `closed` is enabled
 * with nothing open on one side or the other — the product takes no bookings at
 * all — and it is a real state somebody may want, so it is named rather than
 * refused. The danger is that it looks identical to `narrowed` on a screen that
 * only prints two counts, and it is the state a half-finished edit lands in.
 *
 * `off` and `open` are deliberately different words for different facts: the
 * scope not being in force, and the scope being in force but letting everything
 * through. Collapsing them would hide that somebody turned it on.
 */
export type ScopeStanding = "off" | "open" | "narrowed" | "closed";

export function scopeStanding(
  scope: LaunchScope,
  liveAreaKeys: readonly string[],
  liveCategorySlugs: readonly string[],
): ScopeStanding {
  if (!scope.enabled) return "off";

  const openAreas = liveAreaKeys.filter((key) => scope.areaKeys.includes(key));
  const openCategories = liveCategorySlugs.filter((slug) =>
    scope.categorySlugs.includes(slug),
  );

  /*
   * EITHER SIDE EMPTY CLOSES THE PRODUCT, because a booking needs both a ward
   * and a trade. Reporting `narrowed` because the other list still has entries
   * in it would be the most reassuring possible description of a shut shop.
   */
  if (openAreas.length === 0 || openCategories.length === 0) return "closed";

  return scopeNarrows(scope, liveAreaKeys, liveCategorySlugs)
    ? "narrowed"
    : "open";
}

/**
 * The scope with one key added or removed, for the admin screen's toggles.
 *
 * HERE RATHER THAN IN THE WRITER, so the screen can render the result of a tap
 * before it is saved and the test can reach it without a database — the
 * `isFresh` lesson, which was written inside a `server-only` module and then
 * copied. Sorted, so two scopes that are the same set are the same row and the
 * audit diff does not show a reordering as a change.
 */
export function withKey(
  scope: LaunchScope,
  kind: "area" | "category",
  key: string,
  open: boolean,
): LaunchScope {
  const field = kind === "area" ? "areaKeys" : "categorySlugs";
  const current = new Set(kind === "area" ? scope.areaKeys : scope.categorySlugs);
  if (open) current.add(key);
  else current.delete(key);
  return { ...scope, [field]: [...current].sort() };
}
