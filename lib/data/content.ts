import "server-only";

import { unstable_cache } from "next/cache";

import type { ContentTier } from "@/lib/content/tiers";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Interface strings somebody changed without a deploy.
 *
 * AN OVERRIDE, NEVER A COPY. `messages/en.json` and `messages/ne.json` stay the source
 * of truth — 1,855 keys each — and `content_strings` holds only what an admin edited.
 * That is what keeps three existing guards working rather than needing rebuilding:
 * `check:messages` comparing the two catalogues key by key, `check:keys` proving every
 * key the code asks for exists, and a fresh clone with no database rendering the entire
 * product. An empty table is the normal state, not a broken one.
 *
 * A FAILED READ RENDERS THE CATALOGUE, AND THIS IS THE MOST IMPORTANT LINE IN THE FILE.
 * Every page in this product goes through here. If an unreachable table could produce
 * empty strings, a database hiccup would blank the landing page — which is rule 6's
 * shape for copy, and worse than the `/services` case it comes from, because there is
 * no screen left to explain itself on. So every failure path returns an empty override
 * map and the catalogue shows through unchanged.
 *
 * CACHED ACROSS VISITORS, NOT PER REQUEST. The landing page is static-rendered and
 * `next-intl` loads messages on every render; a per-visitor query would undo that and
 * add a Singapore round trip to every page in the product. `unstable_cache` with a tag
 * means one read serves everybody until an edit revalidates it — the same arrangement
 * `lib/data/activity.ts` uses for the homepage counts.
 */

/** The cache tag an edit revalidates. One tag, because one read serves every locale. */
export const CONTENT_STRINGS_TAG = "content-strings";

/** Fifteen minutes, matching `lib/data/activity.ts`. An edit invalidates sooner. */
const CACHE_SECONDS = 15 * 60;

export type StringOverrides = Record<string, string>;

/**
 * `{ "home.lead": "…" }` for one locale, or `{}`.
 *
 * FLAT DOTTED KEYS, because that is how next-intl addresses a message and how the
 * column stores it. Nesting it here would mean two shapes of the same thing in one
 * file and a merge that has to agree with both.
 */
async function readOverrides(locale: "en" | "ne"): Promise<StringOverrides> {
  if (!hasSupabaseConfig()) return {};

  try {
    const { data, error } = await createAdminClient()
      .from("content_strings")
      .select("message_key, value")
      .eq("locale", locale);

    if (error) {
      console.error(`[content] overrides unread — ${describeError(error)}`);
      return {};
    }

    const out: StringOverrides = {};
    for (const row of data ?? []) {
      out[row.message_key as string] = row.value as string;
    }
    return out;
  } catch (thrown) {
    console.error(`[content] overrides threw — ${describeError(thrown)}`);
    return {};
  }
}

export const contentOverrides = (locale: "en" | "ne") =>
  unstable_cache(() => readOverrides(locale), ["content-strings", locale], {
    revalidate: CACHE_SECONDS,
    tags: [CONTENT_STRINGS_TAG],
  })();

/**
 * The catalogue with the overrides laid over it.
 *
 * PURE, AND SEPARATE FROM THE READ, so the merge can be tested without a database —
 * which matters because the rule it enforces is the one worth proving: an override for
 * a key the catalogue does not have is **ignored**, not added.
 *
 * WHY IGNORED RATHER THAN ADDED. `check:keys` resolves every `t("…")` call in the
 * codebase against the catalogues, so a key only in the database is a key no code asks
 * for — dead at best. At worst it is how a typo'd edit silently becomes a new message
 * nobody renders, leaving somebody convinced they fixed a line that still reads the old
 * way. The catalogue decides what keys exist; this decides what they say.
 */
export function mergeOverrides<T extends Record<string, unknown>>(
  catalogue: T,
  overrides: StringOverrides,
): T {
  if (Object.keys(overrides).length === 0) return catalogue;

  // Cloned shallowly down each path that changes; untouched branches keep their
  // identity, so next-intl's own memoisation still sees most of the tree as the same.
  const out: Record<string, unknown> = { ...catalogue };

  for (const [key, value] of Object.entries(overrides)) {
    const path = key.split(".");
    let node: Record<string, unknown> = out;
    let ok = true;

    for (let i = 0; i < path.length - 1; i += 1) {
      const next = node[path[i]];
      if (typeof next !== "object" || next === null || Array.isArray(next)) {
        ok = false;
        break;
      }
      const copy = { ...(next as Record<string, unknown>) };
      node[path[i]] = copy;
      node = copy;
    }

    const leaf = path[path.length - 1];
    // Only replaces a string that is already there. A key the catalogue does not have,
    // or one whose path runs through a non-object, is skipped.
    if (ok && typeof node[leaf] === "string") node[leaf] = value;
  }

  return out as T;
}

/* ------------------------------------------------------------------ *
 * Editing
 * ------------------------------------------------------------------ */

/**
 * Change one string, keeping what it used to say.
 *
 * THE REVISION IS WRITTEN BEFORE THE OVERRIDE, deliberately. A failed revision write
 * leaves the string as it was, which somebody can retry; the other order would change
 * what the product says with no record of what it said — and on the money, safety and
 * legal tiers that record is the only way back. It is the ordering `settleNoShowClaim`
 * settled on for the same reason: write the thing that makes the change answerable
 * first.
 *
 * `previous_value` IS NULL WHEN THERE WAS NO OVERRIDE, and that is a real state rather
 * than a missing one: the key was reading from the JSON catalogue. A rollback to it
 * deletes the override instead of writing an empty string, which is what "put it back
 * to what the developers wrote" actually means.
 *
 * `admin.*` IS REFUSED HERE as well as hidden from the screen. A server action is a
 * public POST endpoint, so a namespace the form never offers is still one a caller can
 * name.
 */
export async function setContentString(input: {
  messageKey: string;
  locale: "en" | "ne";
  value: string;
  actorId: string;
}): Promise<{ ok: boolean; reason?: "notEditable" | "failed" }> {
  const { isEditable, keepsHistory, tierFor } = await import("@/lib/content/tiers");
  if (!isEditable(input.messageKey)) return { ok: false, reason: "notEditable" };

  const value = input.value.trim();
  if (value.length === 0 || value.length > 4000) {
    return { ok: false, reason: "failed" };
  }
  if (!hasSupabaseConfig()) return { ok: false, reason: "failed" };

  const tier = tierFor(input.messageKey);
  const db = createAdminClient();

  try {
    const { data: existing } = await db
      .from("content_strings")
      .select("value")
      .eq("message_key", input.messageKey)
      .eq("locale", input.locale)
      .maybeSingle();

    const previous = (existing?.value as string | undefined) ?? null;
    if (previous === value) return { ok: true };

    if (keepsHistory(tier)) {
      const { error: historyError } = await db
        .from("content_string_revisions")
        .insert({
          message_key: input.messageKey,
          locale: input.locale,
          previous_value: previous,
          new_value: value,
          tier,
          changed_by: input.actorId,
        });
      if (historyError) {
        console.error(`[content] history write — ${describeError(historyError)}`);
        return { ok: false, reason: "failed" };
      }
    }

    const { error } = await db.from("content_strings").upsert(
      {
        message_key: input.messageKey,
        locale: input.locale,
        value,
        tier,
        updated_by: input.actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_key,locale" },
    );
    if (error) {
      console.error(`[content] override write — ${describeError(error)}`);
      return { ok: false, reason: "failed" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[content] edit threw — ${describeError(thrown)}`);
    return { ok: false, reason: "failed" };
  }
}

/**
 * Put a string back to what a revision says it used to be.
 *
 * A ROLLBACK TO NULL DELETES THE OVERRIDE rather than writing an empty string. The two
 * are not the same on a screen: one restores the sentence the developers wrote, the
 * other leaves a blank where a sentence should be. This is the common case — most
 * rollbacks are undoing the first edit somebody made to a key.
 *
 * THE ROLLBACK IS ITSELF A REVISION. Re-applying an old value is a change like any
 * other and the history has to show it happened, or a reader of the trail sees an edit
 * with no undo and concludes it is still in force.
 */
export async function rollbackContentString(input: {
  revisionId: string;
  actorId: string;
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const db = createAdminClient();

  try {
    const { data: revision, error } = await db
      .from("content_string_revisions")
      .select("message_key, locale, previous_value, tier")
      .eq("id", input.revisionId)
      .maybeSingle();

    if (error || !revision) {
      console.error(`[content] rollback target unread — ${describeError(error)}`);
      return false;
    }

    const key = revision.message_key as string;
    const locale = revision.locale as "en" | "ne";
    const target = (revision.previous_value as string | null) ?? null;

    const { data: current } = await db
      .from("content_strings")
      .select("value")
      .eq("message_key", key)
      .eq("locale", locale)
      .maybeSingle();

    await db.from("content_string_revisions").insert({
      message_key: key,
      locale,
      previous_value: (current?.value as string | undefined) ?? null,
      // The trail has to be readable without a join, so a rollback to the catalogue
      // records what it went back to in words rather than an empty string that would
      // read as "somebody blanked this".
      new_value: target ?? "(back to the catalogue)",
      tier: revision.tier as string,
      changed_by: input.actorId,
    });

    if (target === null) {
      const { error: deleteError } = await db
        .from("content_strings")
        .delete()
        .eq("message_key", key)
        .eq("locale", locale);
      return !deleteError;
    }

    const { error: writeError } = await db.from("content_strings").upsert(
      {
        message_key: key,
        locale,
        value: target,
        tier: revision.tier as "money" | "safety" | "legal" | "staff" | "none",
        updated_by: input.actorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "message_key,locale" },
    );
    return !writeError;
  } catch (thrown) {
    console.error(`[content] rollback threw — ${describeError(thrown)}`);
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Reading, for the editor
 * ------------------------------------------------------------------ */

export type EditableString = {
  key: string;
  tier: ContentTier;
  /** What the JSON catalogue says. The baseline a rollback returns to. */
  original: { en: string; ne: string };
  /** What an admin changed it to, where they have. */
  override: { en: string | null; ne: string | null };
};

/**
 * Every key an admin may edit, with both languages side by side.
 *
 * BOTH LANGUAGES ON ONE ROW, because they are one decision. Editing the English of a
 * safety line and leaving the Nepali is how the two catalogues come to say different
 * things — which `check:messages` cannot catch, since it compares keys and placeholders
 * rather than meanings. Seeing them together is the only guard against it that exists.
 *
 * READ FROM THE JSON, not from a second copy. The catalogue is the source of truth, so
 * the editor lists what it holds and shows overrides on top; a key that is removed from
 * the JSON disappears from this screen without anybody tidying a table.
 */
export async function editableStrings(filter?: {
  namespace?: string;
  tier?: string;
}): Promise<EditableString[]> {
  const [{ isEditable, tierFor }, en, ne] = await Promise.all([
    import("@/lib/content/tiers"),
    import("../../messages/en.json"),
    import("../../messages/ne.json"),
  ]);

  const flatten = (
    value: unknown,
    prefix = "",
    out: Record<string, string> = {},
  ): Record<string, string> => {
    if (typeof value === "string") {
      out[prefix] = value;
      return out;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) {
        flatten(child, prefix ? `${prefix}.${key}` : key, out);
      }
    }
    return out;
  };

  const flatEn = flatten(en.default);
  const flatNe = flatten(ne.default);

  const [overridesEn, overridesNe] = await Promise.all([
    contentOverrides("en"),
    contentOverrides("ne"),
  ]);

  return Object.keys(flatEn)
    .filter((key) => isEditable(key))
    .filter((key) => !filter?.namespace || key.startsWith(`${filter.namespace}.`))
    .map((key) => ({
      key,
      tier: tierFor(key),
      original: { en: flatEn[key], ne: flatNe[key] ?? "" },
      override: { en: overridesEn[key] ?? null, ne: overridesNe[key] ?? null },
    }))
    .filter((row) => !filter?.tier || row.tier === filter.tier);
}

export type StringRevision = {
  id: string;
  messageKey: string;
  locale: "en" | "ne";
  previousValue: string | null;
  newValue: string;
  changedAt: string;
};

/**
 * What this key used to say, newest first.
 *
 * ONLY THE TIERS THAT KEEP HISTORY HAVE ANY, which the screen says rather than showing
 * an empty list that reads as "nothing has ever been changed here".
 */
export async function stringHistory(
  messageKey: string,
): Promise<StringRevision[] | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { data, error } = await createAdminClient()
      .from("content_string_revisions")
      .select("id, message_key, locale, previous_value, new_value, changed_at")
      .eq("message_key", messageKey)
      .order("changed_at", { ascending: false })
      .limit(50);

    // Null, never an empty array — "we could not read the history" and "this has never
    // been changed" are different facts, and only one of them means it is safe to edit
    // without looking.
    if (error) {
      console.error(`[content] history unread — ${describeError(error)}`);
      return null;
    }

    return (data ?? []).map((row) => ({
      id: row.id as string,
      messageKey: row.message_key as string,
      locale: row.locale as "en" | "ne",
      previousValue: (row.previous_value as string | null) ?? null,
      newValue: row.new_value as string,
      changedAt: row.changed_at as string,
    }));
  } catch (thrown) {
    console.error(`[content] history threw — ${describeError(thrown)}`);
    return null;
  }
}
