"use server";

import { revalidatePath } from "next/cache";
import { updateTag } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { recordSecurityEvent } from "@/lib/audit";
import {
  setReviewHomepageVisibility,
  type HideResult,
} from "@/lib/data/reviews";

/**
 * Take a published review off the homepage, or put it back.
 *
 * ONLY AN ID, A DIRECTION, A CODE AND A SENTENCE CROSS THE WIRE — never the
 * actor, never the rating, and never anything that could become a filter.
 * `adminActor()` is where the identity comes from, which is the standing rule:
 * three holes have been found in this product and all three were an id arriving
 * from a browser with nothing asking whose it was.
 *
 * NO FIFTEEN-MINUTE RE-CHALLENGE, the `revertDurationAction` reasoning: this
 * moves no money and the eight-hour step-up `adminActor()` already requires is
 * the gate. The thing that makes it safe is not a second code — it is that the
 * action cannot reach a rating, an average or a ranking position, and that
 * every use of it is in an append-only log.
 */

const PATH = "/[locale]/(admin)/admin/reviews";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function setReviewVisibilityAction(
  data: FormData,
): Promise<HideResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, why: "notConfigured" };

  const hidden = field(data, "hidden") === "true";

  const result = await setReviewHomepageVisibility({
    reviewId: field(data, "reviewId"),
    hidden,
    code: field(data, "code"),
    reason: field(data, "reason"),
    actorId: profile.id,
  });

  if (result.ok) {
    /*
     * AUDITED BECAUSE THE STATE CAN BE CLEARED. `homepage_hidden_at` and its
     * three companions are what the homepage reads, and putting a review back
     * sets all four to null — so without this, a hide followed by a restore
     * would leave the row looking as though nothing had ever happened. This is
     * the copy no caller can tidy, which is the whole reason `security_events`
     * refuses UPDATE and DELETE for the service role too.
     *
     * It never throws: the review is already hidden by the time we get here,
     * and a dead log must not roll that back into a half-state.
     */
    await recordSecurityEvent({
      kind: "review.homepageHidden",
      actorId: profile.id,
      actorRole: "admin",
      subjectType: "review",
      subjectId: field(data, "reviewId"),
      detail: {
        hidden,
        code: hidden ? field(data, "code") : null,
        reason: field(data, "reason"),
        providerId: result.providerId,
      },
    });

    /*
     * THE TAG, NOT JUST THE PATH. The wall is `unstable_cache`d across visitors
     * for fifteen minutes, so revalidating this admin route would leave the
     * homepage serving the hidden review for up to a quarter of an hour. A
     * moderation action that takes effect at some point soon is not one
     * somebody can report having taken.
     *
     * `updateTag` RATHER THAN `revalidateTag`, the distinction
     * `setStringAction` already records: in Next 16 `revalidateTag` marks the
     * entry stale and the next render may still be served the old copy, where
     * this expires it immediately. Somebody hiding an abusive review has to be
     * able to load the homepage and see it gone.
     */
    updateTag("reviews");
    revalidatePath(PATH, "page");
  }

  return result;
}
