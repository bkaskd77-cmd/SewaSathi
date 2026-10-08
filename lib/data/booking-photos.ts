import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { checkUploadedImage } from "@/lib/security/image";
import { createClient } from "@/lib/supabase/server";

/**
 * Photos attached to a booking.
 *
 * Different from a triage photo, deliberately. A triage photo is looked at and
 * discarded — the privacy page promises that. A booking photo has to survive
 * until the professional arrives and can see it, so it is stored.
 *
 * The bucket is private and `bookings.photo_url` holds the object *path*, not
 * a URL. Reading is a short-lived signed URL minted on the server, so a photo
 * of the inside of somebody's kitchen never sits on a guessable public path.
 * The column keeps its spec name; this comment is the note that it is a path.
 */

const BUCKET = "booking-photos";

/** Long enough to load the page and look at it, short enough not to leak. */
const SIGNED_URL_SECONDS = 60 * 10;

export type UploadResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

export async function uploadBookingPhoto(
  base64: string,
  profileId: string,
): Promise<UploadResult> {
  if (!hasSupabaseConfig()) {
    // A fresh clone with no keys should still be able to walk the flow. The
    // booking is made without a photo rather than failing at the last step.
    console.warn("[photos] no Supabase config — photo not stored");
    return { ok: false, reason: "notConfigured" };
  }

  /*
   * IS THIS A PHOTOGRAPH?
   *
   * It used to be enough to be under two megabytes, and it was then stored
   * labelled `image/jpeg` — a label we made up on the caller's behalf. The
   * bucket believes that label, the browser compressor is code the caller
   * controls, and none of it is a check. `checkUploadedImage` reads the first
   * bytes of the file instead, reads the dimensions out of the file's own
   * header, and hands back a copy with the metadata removed.
   *
   * The EXIF removal is the half that matters most here and is easiest to
   * forget: a photograph of a leaking pipe taken in somebody's kitchen carries
   * the GPS coordinates of that kitchen, and this product then hands it to a
   * stranger who is about to visit. Nothing we do needs it.
   */
  const checked = checkUploadedImage(base64);
  if (!checked.ok) return { ok: false, reason: checked.reason };
  const bytes = checked.bytes;

  // The first path segment is the owner, which is what every storage policy
  // compares against.
  const path = `${profileId}/${crypto.randomUUID()}.jpg`;

  try {
    const { error } = await createClient()
      .storage.from(BUCKET)
      .upload(path, bytes, { contentType: "image/jpeg", upsert: false });

    if (error) {
      console.error(`[photos] upload failed — ${describeError(error)}`);
      return { ok: false, reason: "uploadFailed" };
    }
    return { ok: true, path };
  } catch (thrown) {
    console.error(`[photos] upload threw — ${describeError(thrown)}`);
    return { ok: false, reason: "uploadFailed" };
  }
}

/**
 * A signed URL for a stored photo, or null.
 *
 * Null rather than throwing: a booking whose photo has gone missing should
 * still render, with the photo simply absent. The job is the important part.
 */
export async function signBookingPhoto(
  path: string | null,
): Promise<string | null> {
  if (!path || !hasSupabaseConfig()) return null;

  try {
    const { data, error } = await createClient()
      .storage.from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS);

    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The set — up to three photographs on one booking
 * ------------------------------------------------------------------ */

/**
 * Record a photograph against a booking, with what the checks made of it.
 *
 * THREE IS THE DATABASE'S ANSWER, NOT THIS FUNCTION'S. `position` is checked to 0-2 and
 * unique per booking, so a fourth has nowhere to go and a race between two uploads is
 * refused by the key rather than remembered against by the application — the idiom
 * `provider_ledger_recovery_once_idx` already uses one table over. This reads the next free
 * slot and lets the insert fail if somebody took it meanwhile.
 *
 * NOTHING HERE REFUSES AN UPLOAD. The verdicts are recorded and shown; what they are allowed
 * to DO belongs to the claim gates, where money is involved. A customer attaching a
 * photograph to a booking is not making a claim, and the professional's on-site correction
 * already fixes a misleading one — which is why booking photographs stay flag-only.
 */
export async function recordBookingPhoto(input: {
  bookingId: string;
  customerId: string;
  /** The already-checked bytes, so this never re-decodes what the caller validated. */
  bytes: Uint8Array;
  storagePath: string;
  takenAt: Date | null;
}): Promise<{ ok: boolean; position?: number; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const { checkAndRemember } = await import("@/lib/photos/store");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const db = createAdminClient();

  const { duplicate, hash } = await checkAndRemember({
    bytes: input.bytes,
    kind: "booking",
    bookingId: input.bookingId,
    accountId: input.customerId,
  });

  try {
    const { data: taken } = await db
      .from("booking_photos")
      .select("position")
      .eq("booking_id", input.bookingId);

    const used = new Set((taken ?? []).map((row) => row.position as number));
    const position = [0, 1, 2].find((slot) => !used.has(slot));

    /* Full is an answer, not an error: the request already carries its three. */
    if (position === undefined) return { ok: false, reason: "full" };

    const { error } = await db.from("booking_photos").insert({
      booking_id: input.bookingId,
      storage_path: input.storagePath,
      position,
      taken_at: input.takenAt?.toISOString() ?? null,
      hash,
      duplicate_verdict: duplicate.kind,
      duplicate_distance: "distance" in duplicate ? duplicate.distance : null,
    });

    if (error) {
      console.error(`[booking-photo] not recorded — ${describeError(error)}`);
      return { ok: false, reason: "failed" };
    }

    return { ok: true, position };
  } catch (thrown) {
    console.error(`[booking-photo] threw — ${describeError(thrown)}`);
    return { ok: false, reason: "failed" };
  }
}

export type BookingPhoto = {
  storagePath: string;
  position: number;
  takenAt: string | null;
  duplicate: "unseen" | "retry" | "flag" | "reject" | "not-compared" | null;
  duplicateDistance: number | null;
};

/**
 * Every photograph on a booking, in the order they were added.
 *
 * NULL IS "WE COULD NOT READ THEM", AND AN EMPTY ARRAY IS "THERE ARE NONE". The two are
 * different facts and only one of them means it is safe to say the customer sent nothing —
 * the `/services` rule, on a surface where a professional is deciding whether they have
 * seen everything before setting off.
 */
export async function bookingPhotos(
  bookingId: string,
): Promise<BookingPhoto[] | null> {
  if (!hasSupabaseConfig()) return null;

  const { createAdminClient } = await import("@/lib/supabase/admin");

  try {
    const { data, error } = await createAdminClient()
      .from("booking_photos")
      .select("storage_path, position, taken_at, duplicate_verdict, duplicate_distance")
      .eq("booking_id", bookingId)
      .order("position", { ascending: true });

    if (error) {
      console.error(`[booking-photo] unread — ${describeError(error)}`);
      return null;
    }

    return (data ?? []).map((row) => ({
      storagePath: row.storage_path as string,
      position: row.position as number,
      takenAt: (row.taken_at as string | null) ?? null,
      duplicate: (row.duplicate_verdict as BookingPhoto["duplicate"]) ?? null,
      duplicateDistance: (row.duplicate_distance as number | null) ?? null,
    }));
  } catch (thrown) {
    console.error(`[booking-photo] threw — ${describeError(thrown)}`);
    return null;
  }
}
