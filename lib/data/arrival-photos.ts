import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import type { DuplicateVerdict } from "@/lib/photos/duplicate";
import { judgeFreshness, type FreshnessVerdict } from "@/lib/photos/freshness";
import { checkAndRemember } from "@/lib/photos/store";
import { checkUploadedImage } from "@/lib/security/image";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A photograph taken at the door, and the one thing we keep from its clock.
 *
 * WHY THIS IS A SEPARATE MODULE FROM `booking-photos.ts`. They look alike and the
 * promises are not: a booking photo is the customer's, shown to the professional
 * while the job is live, and deleted by nothing. This one is the *professional's*
 * evidence in a claim against a customer, read by an admin deciding whether to pay
 * Rs 350, and every admin read is logged. One module doing both would end up with one
 * bucket and one policy, and the policy is the difference.
 *
 * THE UPLOAD IS SERVER-SIDE AND THERE IS NO INSERT POLICY ON THE BUCKET. The bytes
 * have to be validated before they are stored — magic bytes, dimensions, and the EXIF
 * block that carries the coordinates of wherever the shutter fired. A browser that
 * could write here directly could store an unstripped photograph, which is the one
 * thing this path exists to prevent.
 *
 * WHAT WE KEEP OF THE TIMESTAMP IS THE DIFFERENCE, NOT THE TIME. `checkUploadedImage`
 * reads the camera's clock on the way past and the block is dropped; the skew against
 * our own receipt stamp is what a reviewer needs, because a photograph taken three
 * hours earlier is a different claim. The reading alone says nothing without ours
 * beside it, and keeping it would mean keeping a field off a block we removed for
 * being too revealing.
 */

const BUCKET = "arrival-photos";

/** Long enough for a reviewer to look, short enough not to be a link they keep. */
const SIGNED_URL_SECONDS = 60 * 10;

export type ArrivalPhoto = {
  /** Object key, `<provider_profile_id>/<booking_id>.jpg`. */
  path: string;
  /** Whether this photograph had been sent before. Never "clean" by default. */
  duplicate: DuplicateVerdict;
  /** Whether the camera clock puts it near the tap. */
  freshness: FreshnessVerdict;
  /**
   * Camera clock minus our receipt time, in minutes, signed.
   *
   * NULL IS "THE FILE DID NOT SAY" and it is the common case, not an edge: our own
   * browser compressor re-encodes through a canvas and keeps no EXIF, as does
   * anything that has been through a messaging app. Reading null as zero would hand
   * every one of those a perfect alibi — rule 6.
   */
  skewMinutes: number | null;
};

/**
 * Store the photograph, stripped, and work out the skew.
 *
 * RETURNS NULL RATHER THAN THROWING, and the claim goes ahead without it. Somebody is
 * standing in a street in the rain; a storage hiccup must not be the reason their
 * wasted trip goes unrecorded. A claim with no photograph is an ordinary claim — it
 * was the only kind until this phase — and `judgeNoShowClaim` has never required one.
 */
export async function storeArrivalPhoto(input: {
  base64: string;
  providerProfileId: string;
  bookingId: string;
  /** When the server received it. Passed in so the caller's stamp is the one used. */
  receivedAt: Date;
}): Promise<ArrivalPhoto | null> {
  if (!hasSupabaseConfig()) return null;

  const checked = checkUploadedImage(input.base64);
  if (!checked.ok) {
    console.warn(`[arrival-photo] refused — ${checked.reason}`);
    return null;
  }

  /*
   * ONE PHOTOGRAPH PER BOOKING, by the key rather than by a check. `upsert` means a
   * retry from a queued claim replaces rather than accumulating, and the key is
   * derived from the booking so there is no id to collide.
   */
  const path = `${input.providerProfileId}/${input.bookingId}.jpg`;

  try {
    const { error } = await createAdminClient()
      .storage.from(BUCKET)
      .upload(path, checked.bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (error) {
      console.error(`[arrival-photo] upload failed — ${describeError(error)}`);
      return null;
    }
  } catch (thrown) {
    console.error(`[arrival-photo] upload threw — ${describeError(thrown)}`);
    return null;
  }

  /*
   * THE HASH AND THE CLOCK ARE READ FROM THE SAME BYTES WE JUST STORED, after the upload
   * rather than before it. A photograph that fails one of these checks is still kept: the
   * verdict routes a claim to a person, and throwing the evidence away would leave that
   * person nothing to look at. Neither check can refuse an arrival — somebody is standing
   * in a street.
   */
  const { duplicate } = await checkAndRemember({
    bytes: checked.bytes,
    kind: "arrival",
    bookingId: input.bookingId,
    accountId: input.providerProfileId,
  });

  const freshness = judgeFreshness({ takenAt: checked.takenAt, at: input.receivedAt });

  return {
    path,
    duplicate,
    freshness: freshness.verdict,
    /*
     * THE SKEW IS CORRECTED INTO ONE FRAME, and it was not until now. EXIF holds a local
     * wall clock that `parseExifDate` reads as UTC, so subtracting a server instant left
     * every Nepali photograph reading 345 minutes out — systematically, for everybody.
     * Nothing had seen it because no real arrival photograph exists yet.
     */
    skewMinutes: freshness.skewMinutes,
  };
}

/**
 * A signed URL for a reviewer, and the log row that says they looked.
 *
 * ITS OWN FUNCTION SO THE LOG CANNOT BE SKIPPED — `recordDocumentAccess`'s rule, and
 * the reason is the same one level across: this is a photograph a stranger took
 * outside somebody's house, held because it supports a claim against that person. The
 * subject of the log is the booking, because the photograph is evidence about a visit
 * rather than about a document somebody owns.
 *
 * Null rather than throwing: a claim whose photograph has gone missing still has to be
 * decidable, with the photograph simply absent.
 */
export async function signArrivalPhotoForAdmin(input: {
  path: string | null;
  adminId: string;
  bookingId: string;
}): Promise<string | null> {
  if (!input.path || !hasSupabaseConfig()) return null;

  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET)
      .createSignedUrl(input.path, SIGNED_URL_SECONDS);

    if (error || !data) return null;

    await recordSecurityEvent({
      kind: "document.viewed",
      actorId: input.adminId,
      actorRole: "admin",
      subjectType: "booking",
      subjectId: input.bookingId,
      detail: {
        reason: "Opened the arrival photograph on a wasted-trip claim.",
        kind: "arrivalPhoto",
      },
    });

    return data.signedUrl;
  } catch {
    return null;
  }
}
