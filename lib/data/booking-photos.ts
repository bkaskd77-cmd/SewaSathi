import "server-only";

import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
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

/** Base64 (no data: prefix) to bytes, without pulling in a dependency. */
function decodeBase64(data: string): Uint8Array {
  const binary = Buffer.from(data, "base64");
  return new Uint8Array(binary);
}

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

  const bytes = decodeBase64(base64);
  // The bucket enforces this too. Checking here turns a storage error into a
  // sentence the person can act on.
  if (bytes.byteLength > 2 * 1024 * 1024) {
    return { ok: false, reason: "tooLarge" };
  }

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
