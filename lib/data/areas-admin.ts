import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { AREA_KEY_SHAPE } from "@/lib/config/areas";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Opening a ward and withdrawing one.
 *
 * SEPARATE FROM `lib/data/areas.ts` ON PURPOSE. That module is the READ, reached
 * by the landing page, `/services`, the booking flow and `/providers/join`
 * through the cookie-free anon client — public data, no privileges. This one
 * holds the service-role key and is reached by two admin actions. Keeping them
 * in one file would put that key on the import graph of every public page, and
 * `check:secrets`' source pass is what would eventually say so.
 *
 * RETIRE, NEVER DELETE. `addresses.area_key`, `provider_leads.area_key` and
 * `providers.service_areas` all hold these keys with no foreign key behind them,
 * so a delete orphans live bookings and leaves an old booking page unable to say
 * where the job was. There is no delete path here and there should never be one:
 * the table has no DELETE policy, no browser grant, and `retireArea` is the only
 * way an area leaves the pickers.
 *
 * FORWARD ONLY, AND STRUCTURALLY SO. Retiring changes nothing that already
 * happened — a booking in that ward keeps its address, its quote and its
 * professional, and an accepted job still travels. What it changes is every
 * NEW choice: `bookableAreas()` stops returning it, so the address picker, the
 * application form and the catalogue filter all drop it on the next request.
 */

export type AreaWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unreadable"
        | "refused"
        | "noReason"
        | "exists"
        | "notFound"
        | "badKey"
        | "badWard"
        | "blank";
    };

export type NewArea = {
  key: string;
  city: string;
  cityNe: string;
  wardNumber: number;
  name: string;
  nameNe: string;
  actorId: string;
};

/** Open a ward. It is live from the next request, in every picker at once. */
export async function addArea(input: NewArea): Promise<AreaWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  const key = input.key.trim().toLowerCase();
  /* TWO LAYERS. `areas_key_shape` is what makes a bad key impossible; this is
     what turns the refusal into "a key looks like kathmandu-4" rather than a
     Postgres error string. The two texts are compared in the db suite. */
  if (!AREA_KEY_SHAPE.test(key)) return { ok: false, reason: "badKey" };
  if (!Number.isInteger(input.wardNumber) || input.wardNumber <= 0) {
    return { ok: false, reason: "badWard" };
  }

  const words = {
    city: input.city.trim(),
    cityNe: input.cityNe.trim(),
    name: input.name.trim(),
    nameNe: input.nameNe.trim(),
  };
  /*
   * ALL FOUR OR NONE. A ward with an English name and no Nepali one renders the
   * English into a Nepali page — the half-translated screen rule 5 exists to
   * prevent, and the one place it would be invisible, because a place name in
   * Latin script on a Devanagari page reads as a place name somebody chose not
   * to translate rather than as a missing field.
   */
  if (Object.values(words).some((v) => v.length === 0)) {
    return { ok: false, reason: "blank" };
  }

  try {
    const db = createAdminClient();
    const { error } = await db.from("areas").insert({
      key,
      city: words.city,
      city_ne: words.cityNe,
      ward_number: input.wardNumber,
      name: words.name,
      name_ne: words.nameNe,
      /*
       * AT THE END OF THE LIST. A new ward sorts last rather than guessing where
       * it belongs among the three cities — somebody can see it, and a wrong
       * position is a cosmetic fix where a silent reorder of a picker everybody
       * is used to is not.
       */
      sort_order: 1000,
    });

    if (error) {
      /* 23505 is the primary key: the ward already exists, retired or not, and
         re-opening a retired one is `reopenArea` rather than an insert. */
      if (error.code === "23505") return { ok: false, reason: "exists" };
      console.error(`[areas] insert failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }

    await recordSecurityEvent({
      kind: "area.opened",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "area",
      subjectId: key,
      detail: {
        city: words.city,
        ward: input.wardNumber,
        name: words.name,
        /*
         * SAID OUT LOUD IN THE LOG, because it is the consequence nobody would
         * think to look for: distance ranking reads
         * `seed/area-centroids.json`, which this ward is not in until somebody
         * runs `scripts/fetch-ward-centroids.mjs`. Until then it ranks on its
         * ward alone — not broken, and not what the screen's other wards do.
         */
        centroid: "not fetched — run scripts/fetch-ward-centroids.mjs",
      },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[areas] insert threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/**
 * Stop taking new work in a ward.
 *
 * THE REASON IS REQUIRED HERE, BY THE FORM AND BY `areas_retired_shape`, and
 * the rule is the one `/providers/standards` sets for an enforcement step: six
 * months on, "why did we stop serving ward 26" is exactly what somebody asks,
 * and a withdrawal recorded with no words is one nobody can answer.
 */
export async function retireArea(input: {
  key: string;
  reason: string;
  actorId: string;
}): Promise<AreaWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };
  const reason = input.reason.trim();
  if (reason.length === 0) return { ok: false, reason: "noReason" };

  try {
    const db = createAdminClient();
    /*
     * GUARDED ON IT NOT ALREADY BEING RETIRED, so a double submit is one
     * retirement with one date rather than a second one that re-dates the
     * first. `notFound` covers both "no such ward" and "already retired",
     * which from the screen are the same answer: nothing to do.
     */
    const { data, error } = await db
      .from("areas")
      .update({
        retired_at: new Date().toISOString(),
        retired_reason: reason,
        retired_by: input.actorId,
      })
      .eq("key", input.key)
      .is("retired_at", null)
      .select("key");

    if (error) {
      console.error(`[areas] retire failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }
    if (!data || data.length === 0) return { ok: false, reason: "notFound" };

    await recordSecurityEvent({
      kind: "area.retired",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "area",
      subjectId: input.key,
      detail: { reason },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[areas] retire threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/**
 * Serve a ward again.
 *
 * NOT A ONE-WAY DOOR, deliberately. A ward withdrawn by mistake, or one we left
 * and came back to, must not need a migration to reopen — and the audit log
 * carries both moves, so the history reads as what happened rather than as a
 * row that was always live. The triple goes back to null together, which is
 * what `areas_retired_shape` requires.
 */
export async function reopenArea(input: {
  key: string;
  actorId: string;
}): Promise<AreaWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  try {
    const db = createAdminClient();
    const { data, error } = await db
      .from("areas")
      .update({ retired_at: null, retired_reason: null, retired_by: null })
      .eq("key", input.key)
      .not("retired_at", "is", null)
      .select("key");

    if (error) {
      console.error(`[areas] reopen failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }
    if (!data || data.length === 0) return { ok: false, reason: "notFound" };

    await recordSecurityEvent({
      kind: "area.reopened",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "area",
      subjectId: input.key,
      detail: {},
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[areas] reopen threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}
