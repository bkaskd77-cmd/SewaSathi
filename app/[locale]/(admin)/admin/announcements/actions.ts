"use server";

import { revalidatePath, updateTag } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { ANNOUNCEMENTS_TAG } from "@/lib/data/announcements";
import {
  editAnnouncement,
  publishAnnouncement,
  setAnnouncementEnabled,
  type AnnouncementWriteResult,
} from "@/lib/data/announcements-admin";

/**
 * Publishing a sentence that sits above every page, and taking it down.
 *
 * `adminActor()` AND NOT `freshAdminActor()`, which is the one decision in this
 * file. The eight-hour window is the WORDS gate — it is what the string editor
 * and `setCategoryContent` take — where the fifteen-minute one guards money and
 * the acts that stop a trade or a ward being sold. A banner moves no rupee,
 * reveals nobody's data and is reversible in one tap by the switch `enabled`
 * exists to be. It is also the one surface whose whole value is being able to
 * say something TODAY: an authenticator code demanded before "we are closed for
 * Dashain" can go up at seven in the morning is how a product comes to have
 * nothing to say on the day it matters. Nothing here is declared in
 * `lib/config/admin-money.ts` because this is not a money path, and the AST
 * test's coverage half is what would say so if it became one.
 *
 * THE REFUSAL IS ONE WORD AND THAT IS `adminActor`'S OWN RULE, not a shortcut.
 * Where `freshAdminActor()` hands back `reauthNeeded` — safely, because only
 * somebody who already passed the role check and the eight-hour step-up can see
 * it — this gate collapses both halves on purpose: an action must not tell a
 * caller which half of it they failed. So there is no `ReauthNotice` on this
 * screen and there should not be one; `notAdmin` is the whole answer.
 *
 * BOTH THE TAG AND THE PATH. `liveAnnouncements` is `unstable_cache`d across
 * visitors, so the path alone would leave the old banner up for as long as a
 * minute — `setStringAction`'s arrangement, and `updateTag` rather than
 * `revalidateTag` for the Next 16 distinction that one already records: the
 * latter marks the entry stale and serves it once more, which on a banner being
 * taken down is one more visitor reading the wrong sentence.
 */
type ActionResult = AnnouncementWriteResult | { ok: false; reason: string };

/* "layout", not "page": the banner renders in both frames and on the landing
   page, so revalidating this one screen would leave it up everywhere else. */
const PATH = "/[locale]";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

function settle(result: ActionResult): ActionResult {
  if (result.ok) {
    updateTag(ANNOUNCEMENTS_TAG);
    revalidatePath(PATH, "layout");
  }
  return result;
}

export async function publishAnnouncementAction(
  data: FormData,
): Promise<ActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, reason: "notAdmin" };

  return settle(
    await publishAnnouncement({
      bodyEn: field(data, "bodyEn"),
      bodyNe: field(data, "bodyNe"),
      audience: field(data, "audience"),
      tone: field(data, "tone"),
      startsAt: field(data, "startsAt"),
      endsAt: field(data, "endsAt"),
      actorId: actor.id,
    }),
  );
}

export async function editAnnouncementAction(
  data: FormData,
): Promise<ActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, reason: "notAdmin" };

  return settle(
    await editAnnouncement({
      id: field(data, "id"),
      bodyEn: field(data, "bodyEn"),
      bodyNe: field(data, "bodyNe"),
      tone: field(data, "tone"),
      endsAt: field(data, "endsAt"),
      actorId: actor.id,
    }),
  );
}

export async function setAnnouncementEnabledAction(
  data: FormData,
): Promise<ActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, reason: "notAdmin" };

  /*
   * THE DIRECTION IS A STRING FROM THE FORM AND IS COMPARED, never coerced.
   * `Boolean("false")` is true, which would turn every Put-back-up button into
   * a second take-down — and `setAnnouncementEnabled` guards on the state
   * actually changing, so the symptom would be a silent `notFound` rather than
   * anything that reads like a bug.
   */
  return settle(
    await setAnnouncementEnabled({
      id: field(data, "id"),
      enabled: field(data, "enabled") === "true",
      actorId: actor.id,
    }),
  );
}
