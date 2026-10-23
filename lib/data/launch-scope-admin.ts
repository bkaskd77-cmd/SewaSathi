import "server-only";

import { updateTag } from "next/cache";

import { recordSecurityEvent } from "@/lib/audit";
import { type LaunchScope } from "@/lib/config/launch-scope";
import { allAreas } from "@/lib/data/areas";
import { allCategories } from "@/lib/data/categories";
import { LAUNCH_SCOPE_TAG } from "@/lib/data/launch-scope";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Moving the soft-launch scope: the switch, and which wards and trades are open.
 *
 * SEPARATE FROM `lib/data/launch-scope.ts` ON PURPOSE, which is `areas-admin`'s
 * arrangement and its reason: that module is the READ, reached by the landing
 * page, `/services`, every category page and the booking flow through the
 * cookie-free anon client. This one holds the service-role key. Keeping them in
 * one file would put that key on the import graph of every public page, and
 * `check:secrets`' source pass is what would eventually say so.
 *
 * ONE WRITER RATHER THAN SIX. A ward toggle, a trade toggle, the switch and the
 * note are all one row, so a per-field writer would be four ways to write one
 * fact — and worse, four audit rows for one decision. The screen sends the whole
 * scope it wants; this re-reads what is there, writes the new one and records
 * the difference.
 *
 * THE SCOPE CROSSES THE WIRE AND THE KEYS ARE LOOKED UP, which is
 * `stateBand`'s split and it matters here for the same reason: what a person
 * SAW is theirs to send, because a decision has to record what was read, but
 * what a rule is ENFORCED against is ours. A forged POST naming
 * `kathmandu-999` would otherwise sit in the row for ever, invisible on a
 * screen that renders checkboxes from the live list.
 *
 * KEYS ARE VALIDATED AGAINST EVERY ONE EVER, not against the live ones. A ward
 * retired while somebody had the screen open is still a real key, and refusing
 * the whole save over it would be a lost edit for no gain — the reads intersect
 * the scope with what is live, so a retired key in there narrows to nothing
 * rather than resurrecting anything. Junk is what this refuses.
 */

export type ScopeWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unreadable"
        | "refused"
        /** A key or slug that is not a ward or trade we have ever had. */
        | "unknownKey";
      /** Which ones, so the screen can say rather than just refuse. */
      unknown?: string[];
    };

export type ScopeWrite = LaunchScope & {
  note: string | null;
  actorId: string;
};

const NOTE_MAX = 280;

export async function setLaunchScope(
  input: ScopeWrite,
): Promise<ScopeWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  const db = createAdminClient();

  /*
   * THE KEYS WE HAVE EVER HAD, read through the public reads so there is one
   * definition of what a ward is. `allAreas` falls back to the seed and
   * `allCategories` to its own, which is right here: this is a validity check
   * on an identifier rather than a question about what is open, and refusing
   * every save because a catalogue query hiccupped would be the worse failure.
   */
  const [areas, categories] = await Promise.all([allAreas(), allCategories()]);
  /*
   * `allCategories` RETURNS NULL ON A FAILED READ, and that refuses the save.
   * It is the opposite call from `allAreas` three words earlier, which falls
   * back to the seed — and the difference is not an inconsistency, it is those
   * two functions' own established contracts. With no list of trades there is
   * nothing to validate a slug against, and accepting whatever arrived would
   * be a validation in name only.
   */
  if (categories === null) return { ok: false, reason: "unreadable" };

  const knownAreas = new Set(areas.map((area) => area.key));
  const knownCategories = new Set(categories.map((category) => category.slug));

  const unknown = [
    ...input.areaKeys.filter((key) => !knownAreas.has(key)),
    ...input.categorySlugs.filter((slug) => !knownCategories.has(slug)),
  ];
  if (unknown.length > 0) {
    return { ok: false, reason: "unknownKey", unknown };
  }

  /*
   * SORTED AND DEDUPLICATED, so two saves of the same set are the same row.
   * Without it the audit detail shows a reordering as a change, and "what did
   * we open on the 14th" becomes a question somebody has to diff by eye.
   */
  const areaKeys = [...new Set(input.areaKeys)].sort();
  const categorySlugs = [...new Set(input.categorySlugs)].sort();
  const note = input.note?.trim().slice(0, NOTE_MAX) || null;

  /*
   * WHAT IS THERE NOW, for the audit row. Read through the service role rather
   * than through `launchScope()`, because that one is cached for a minute and
   * an audit row has to record what this write actually replaced — a stale
   * "before" is worse than none, since it reads as a change nobody made.
   */
  const { data: current, error: readError } = await db
    .from("launch_scope")
    .select("enabled, area_keys, category_slugs")
    .limit(1)
    .maybeSingle();

  if (readError) {
    console.error(`[launch-scope] read failed — ${describeError(readError)}`);
    return { ok: false, reason: "unreadable" };
  }

  const before: LaunchScope = {
    enabled: current?.enabled ?? false,
    areaKeys: current?.area_keys ?? [],
    categorySlugs: current?.category_slugs ?? [],
  };

  const { error } = await db
    .from("launch_scope")
    .update({
      enabled: input.enabled,
      area_keys: areaKeys,
      category_slugs: categorySlugs,
      note,
      updated_by: input.actorId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) {
    console.error(`[launch-scope] update failed — ${describeError(error)}`);
    return { ok: false, reason: "refused" };
  }

  /*
   * THREE KINDS, which is `area.reopened`'s and `announcement.restored`'s rule:
   * turning the scope ON is the soft launch beginning, turning it OFF is the
   * product opening everywhere, and moving the lists is neither. A single
   * `scopeChanged` would make the two decisions that change what the product
   * IS indistinguishable from a Tuesday widening, in the table that is the only
   * history this feature has.
   */
  const kind =
    before.enabled === input.enabled
      ? "launch.scopeChanged"
      : input.enabled
        ? "launch.scopeEnabled"
        : "launch.scopeDisabled";

  await recordSecurityEvent({
    kind,
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "launch_scope",
    subjectId: "launch_scope",
    /*
     * BOTH SIDES IN THE DETAIL. There is no history table here — the
     * `announcements` decision, for the same reason — so these rows ARE the
     * record, and a row saying only "the scope changed" answers none of the
     * questions a soft launch raises later. "When did we open ward 12" is a
     * `before`/`after` diff or it is nothing.
     */
    detail: {
      before: {
        enabled: before.enabled,
        areas: before.areaKeys,
        categories: before.categorySlugs,
      },
      after: { enabled: input.enabled, areas: areaKeys, categories: categorySlugs },
      note,
    },
  });

  /*
   * `updateTag`, NOT `revalidateTag`, so a widening is readable on the very
   * next render rather than after the minute's cache — the `announcements`
   * lesson. The tag covers every surface that reads the scope, because they all
   * go through the one cached read.
   */
  updateTag(LAUNCH_SCOPE_TAG);

  return { ok: true };
}
