import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TONES,
  nepalStampToIso,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementTone,
} from "@/lib/config/announcements";
import {
  toAnnouncement,
  type AnnouncementRow,
} from "@/lib/data/announcements";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Putting a sentence in front of everybody, and taking it down.
 *
 * SEPARATE FROM `lib/data/announcements.ts` FOR THE REASON `areas-admin.ts` IS
 * SEPARATE FROM `areas.ts`: that module is the READ, reached by the landing
 * page and both frames through the cookie-free anon client, and it must stay
 * off the import graph of the service-role key. `check:secrets`' source pass is
 * what would eventually say so.
 *
 * NO BROWSER MAY WRITE ONE. `announcements` grants `select` to `anon` and
 * nothing else, and every write here is the service role behind the admin gate.
 * This is copy that reaches every visitor on every page — a browser that could
 * insert a row could put a sentence of its own on the landing page, which is
 * the `push_subscriptions` reasoning with a bigger audience.
 *
 * THE EIGHT-HOUR WINDOW, NOT THE FIFTEEN MINUTES, and that is the one decision
 * here worth arguing. `adminActor()` is the words gate: it is what
 * `setCategoryContent` and the string editor take, where `stateBand`,
 * `retireCategory` and `retireArea` take `freshAdminActor()`. A banner moves no
 * money, reveals nobody's data, and is reversible in one tap by the switch that
 * is the whole reason `enabled` exists separately from the window. It is also
 * the one surface whose entire value is being able to say something TODAY —
 * demanding an authenticator code before "we are closed for Dashain" can go up
 * at seven in the morning is how a product comes to have nothing to say on the
 * day it matters. Nothing in `lib/config/admin-money.ts` is declared for this
 * module, deliberately: it is not a money path.
 */

export type AnnouncementWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "unreadable"
        | "refused"
        | "notFound"
        | "blank"
        | "tooLong"
        | "badAudience"
        | "badTone"
        | "badWindow";
    };

/**
 * One row as the admin screen reads it.
 *
 * NO `profiles` EMBED, AND THAT IS NOT A SHORTCUT. `created_by` and
 * `updated_by` both reference `profiles`, so `profiles(full_name)` from this
 * table is AMBIGUOUS — PostgREST refuses it and the refusal arrives as a failed
 * query rather than a missing field, which is how four reads in this product
 * came to answer "we could not read it" for days. The question it would answer
 * is already answered properly: `security_events` records every publish, edit
 * and withdrawal with the actor, which is the copy no caller can tidy.
 */
export type AnnouncementRecord = Announcement & {
  createdAt: string;
  updatedAt: string | null;
};

const ADMIN_COLUMNS =
  "id, body_en, body_ne, audience, tone, starts_at, ends_at, enabled, created_at, updated_at";

/**
 * Every banner ever, newest first.
 *
 * NULL IS A FAILED READ AND THE SCREEN SAYS SO, where `liveAnnouncements`
 * returns an empty list and renders nothing. That split is deliberate and it is
 * the `allAreas` / `bookableAreas` posture: nobody came to a page for a banner,
 * so an error message above the whole product would be noise — but somebody
 * opening this screen IS asking, and "no announcements" over a broken query is
 * how a person publishes a second copy of a banner that is already up.
 *
 * WITHDRAWN AND EXPIRED ROWS STAY, quiet and below. Hiding them would make the
 * one action available on them — putting one back up — unreachable, and would
 * leave somebody wondering whether the banner they took down last month had
 * been deleted after all. `/admin/areas`' rule, and there is no delete path
 * here either.
 */
export async function allAnnouncements(): Promise<AnnouncementRecord[] | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { data, error } = await createAdminClient()
      .from("announcements")
      .select(ADMIN_COLUMNS)
      .order("starts_at", { ascending: false });

    if (error) {
      console.error(`[announcements] list failed — ${describeError(error)}`);
      return null;
    }

    return (data ?? []).map((row) => {
      const typed = row as unknown as AnnouncementRow & {
        created_at: string;
        updated_at: string | null;
      };
      return {
        ...toAnnouncement(typed),
        createdAt: typed.created_at,
        updatedAt: typed.updated_at,
      };
    });
  } catch (thrown) {
    console.error(`[announcements] list threw — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * The checks the form's refusals are written from.
 *
 * PURE AND SHARED BY PUBLISH AND EDIT, so the two cannot drift about what a
 * valid banner is — which is the divergence `lib/provider/measured.ts` and
 * `countsAsEvidence` exist to prevent. The body bound is
 * `ANNOUNCEMENT_BODY_MAX` and is printed above the box rather than discovered
 * here.
 */
function refuseBody(bodyEn: string, bodyNe: string) {
  if (bodyEn.length === 0 || bodyNe.length === 0) {
    return { ok: false, reason: "blank" } as const;
  }
  if (
    bodyEn.length > ANNOUNCEMENT_BODY_MAX ||
    bodyNe.length > ANNOUNCEMENT_BODY_MAX
  ) {
    return { ok: false, reason: "tooLong" } as const;
  }
  return null;
}

export type NewAnnouncement = {
  bodyEn: string;
  bodyNe: string;
  audience: string;
  tone: string;
  /** Empty means now. */
  startsAt: string;
  /** Empty means "until somebody takes it down". */
  endsAt: string;
  actorId: string;
};

/** Put a banner up. */
export async function publishAnnouncement(
  input: NewAnnouncement,
): Promise<AnnouncementWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  const bodyEn = input.bodyEn.trim();
  const bodyNe = input.bodyNe.trim();
  const refusal = refuseBody(bodyEn, bodyNe);
  if (refusal) return refusal;

  if (
    !(ANNOUNCEMENT_AUDIENCES as readonly string[]).includes(input.audience)
  ) {
    return { ok: false, reason: "badAudience" };
  }
  if (!(ANNOUNCEMENT_TONES as readonly string[]).includes(input.tone)) {
    return { ok: false, reason: "badTone" };
  }

  /*
   * THE BOXES SEND NEPAL TIME AND THIS SERVER RUNS ON UTC. `nepalStampToIso` is
   * the one place that knows it — see its own note. Parsing these with
   * `Date.parse` would have published a banner 5h45 later than the admin typed,
   * which is late by exactly the amount nobody checks.
   */
  const startsAt = nepalStampToIso(input.startsAt);
  const endsAt = nepalStampToIso(input.endsAt);
  if (startsAt === false || endsAt === false) {
    return { ok: false, reason: "badWindow" };
  }
  /*
   * THE ORDER IS CHECKED HERE SO THE REFUSAL IS A SENTENCE, not a constraint
   * name arriving as "that did not save". `announcements_window` refuses the
   * same thing in the database and is the thing actually in force — this is the
   * `addCategory` arrangement for a band, where the check constraint is the
   * guarantee and the application's copy of it is the copy that can explain
   * itself.
   */
  const effectiveStart = startsAt ?? new Date().toISOString();
  if (endsAt !== null && Date.parse(endsAt) <= Date.parse(effectiveStart)) {
    return { ok: false, reason: "badWindow" };
  }

  try {
    const { data, error } = await createAdminClient()
      .from("announcements")
      .insert({
        body_en: bodyEn,
        body_ne: bodyNe,
        audience: input.audience as AnnouncementAudience,
        tone: input.tone as AnnouncementTone,
        starts_at: effectiveStart,
        ends_at: endsAt,
        enabled: true,
        created_by: input.actorId,
      })
      .select("id");

    if (error) {
      console.error(`[announcements] insert failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }

    await recordSecurityEvent({
      kind: "announcement.published",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "announcement",
      subjectId: data?.[0]?.id ?? null,
      /*
       * THE WORDS ARE IN THE LOG, both languages, because they are the thing
       * decided. A banner is published copy with no personal data in it, and an
       * audit row naming only "a banner was published" would answer none of the
       * questions a banner raises later — what did it say, who read it, how
       * long was it up.
       */
      detail: {
        bodyEn,
        bodyNe,
        audience: input.audience,
        tone: input.tone,
        startsAt: effectiveStart,
        endsAt,
      },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[announcements] insert threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/**
 * Fix the words, the tone or the end date of a banner that is already up.
 *
 * EDIT EXISTS FOR ONE CASE AND IT IS A GOOD ONE: a typo in a sentence sitting
 * above every page in the product. Without it the only fix is take-down and
 * re-publish, which leaves the wrong words up for as long as that takes and
 * splits one announcement into two rows nobody can read as one thing.
 *
 * THE AUDIENCE AND THE START ARE NOT EDITABLE, deliberately. Changing who a
 * banner is for is publishing a different banner — the professionals who read
 * it cannot un-read it — and `starts_at` is a historical fact about when this
 * went up, which a report would later be wrong about. Both are available by
 * taking this one down and putting up another, which is the honest shape of
 * that change.
 */
export async function editAnnouncement(input: {
  id: string;
  bodyEn: string;
  bodyNe: string;
  tone: string;
  endsAt: string;
  actorId: string;
}): Promise<AnnouncementWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  const bodyEn = input.bodyEn.trim();
  const bodyNe = input.bodyNe.trim();
  const refusal = refuseBody(bodyEn, bodyNe);
  if (refusal) return refusal;

  if (!(ANNOUNCEMENT_TONES as readonly string[]).includes(input.tone)) {
    return { ok: false, reason: "badTone" };
  }

  const endsAt = nepalStampToIso(input.endsAt);
  if (endsAt === false) return { ok: false, reason: "badWindow" };

  try {
    const db = createAdminClient();
    /*
     * `starts_at` IS READ BACK RATHER THAN SENT BY THE FORM, which is
     * `stateBand`'s rule: what a person SAW is theirs to send, because a
     * decision has to record what was read, but what a rule is ENFORCED against
     * is ours to look up. A browser supplying the start could widen the window
     * it is being measured against and `announcements_window` would agree.
     */
    const { data: existing, error: readError } = await db
      .from("announcements")
      .select("starts_at")
      .eq("id", input.id)
      .maybeSingle();

    if (readError) {
      console.error(`[announcements] edit read — ${describeError(readError)}`);
      return { ok: false, reason: "refused" };
    }
    if (!existing) return { ok: false, reason: "notFound" };

    const startsAt = (existing as { starts_at: string }).starts_at;
    if (endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
      return { ok: false, reason: "badWindow" };
    }

    const { data, error } = await db
      .from("announcements")
      .update({
        body_en: bodyEn,
        body_ne: bodyNe,
        tone: input.tone as AnnouncementTone,
        ends_at: endsAt,
        updated_by: input.actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .select("id");

    if (error) {
      console.error(`[announcements] edit failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }
    if (!data || data.length === 0) return { ok: false, reason: "notFound" };

    await recordSecurityEvent({
      kind: "announcement.edited",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "announcement",
      subjectId: input.id,
      detail: { bodyEn, bodyNe, tone: input.tone, endsAt },
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[announcements] edit threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}

/**
 * Take a banner down, or put it back up.
 *
 * THE SWITCH, NOT THE WINDOW, which is why it is one write and not an edit of
 * `ends_at`. Moving the end date to now would record that the banner was always
 * meant to stop at this minute; this records that somebody stopped it. A banner
 * switched off inside its window is a real state and the two must stay
 * distinguishable — the `categories` pair had to be tied by a constraint
 * because there they were one fact in two columns, and here they are genuinely
 * two.
 *
 * PUTTING ONE BACK IS THE SAME CALL, with its own audit kind rather than an
 * absence. The history has to read as what happened: `reopenArea`'s reasoning,
 * and the reason there is no `reason` field on the way down — this is the undo
 * path for a sentence somebody got wrong, and friction on the recovery path
 * from a mistake is friction in the one place it should not be.
 */
export async function setAnnouncementEnabled(input: {
  id: string;
  enabled: boolean;
  actorId: string;
}): Promise<AnnouncementWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unreadable" };

  try {
    const { data, error } = await createAdminClient()
      .from("announcements")
      .update({
        enabled: input.enabled,
        updated_by: input.actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      /* Guarded on the state actually changing, so a double submit is one
         decision with one date rather than a second that re-stamps the first. */
      .eq("enabled", !input.enabled)
      .select("id");

    if (error) {
      console.error(`[announcements] switch failed — ${describeError(error)}`);
      return { ok: false, reason: "refused" };
    }
    if (!data || data.length === 0) return { ok: false, reason: "notFound" };

    await recordSecurityEvent({
      kind: input.enabled
        ? "announcement.restored"
        : "announcement.withdrawn",
      actorId: input.actorId,
      actorRole: "admin",
      subjectType: "announcement",
      subjectId: input.id,
      detail: {},
    });

    return { ok: true };
  } catch (thrown) {
    console.error(`[announcements] switch threw — ${describeError(thrown)}`);
    return { ok: false, reason: "refused" };
  }
}
