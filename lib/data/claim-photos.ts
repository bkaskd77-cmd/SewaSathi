import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import {
  CLAIM_FRESHNESS_WINDOW_MINUTES,
  MAX_CLAIM_PHOTOS,
  doubtsOnRow,
  judgeClaimEvidence,
  type BookingPhotoMatch,
  type EvidenceDoubt,
  type EvidenceRefusal,
} from "@/lib/photos/evidence";
import type { DuplicateVerdict } from "@/lib/photos/duplicate";
import { judgeFreshness, takenBeforeCompletion } from "@/lib/photos/freshness";
import {
  comparePhoto,
  matchBookingPhotos,
  rememberIfNew,
} from "@/lib/photos/store";
import { checkUploadedImage } from "@/lib/security/image";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Photographs sent with a guarantee claim.
 *
 * THE ORIGINAL BYTES, NEVER `prepareImage`. The browser compressor re-encodes through a
 * canvas and that destroys EXIF — measured, not assumed — and the camera clock is two of
 * the three checks here. So the file goes up as the phone wrote it and the server strips
 * the metadata after reading the one field it wants, exactly as the arrival panel does.
 *
 * REFUSED BEFORE ANYTHING IS STORED, which is the opposite of the arrival path and the
 * difference is worth stating. An arrival photograph is kept whatever its verdict,
 * because somebody is standing in a street and the verdict only routes their claim to a
 * person. A claim photograph that trips a hard reject is not evidence of anything, so
 * nothing is written: no object, no row, and no hash in the comparison table — a hash we
 * refused would later read as a near match against an honest photograph.
 *
 * ONE ADMIN READ IS ONE LOG ROW. `signClaimPhotoForAdmin` is its own function so the log
 * cannot be skipped, the same rule as `recordDocumentAccess` and the arrival photograph.
 */

const BUCKET = "claim-photos";

/** Long enough for a reviewer to look, short enough not to be a link they keep. */
const SIGNED_URL_SECONDS = 60 * 10;

/** What a stored claim photograph tells the person deciding. */
export type ClaimPhoto = {
  id: string;
  path: string;
  position: number;
  takenAt: string;
  /** Whether we had been sent this picture before, and how close it was. */
  duplicateVerdict: string | null;
  duplicateDistance: number | null;
  freshnessVerdict: string | null;
  bookingPhotoMatch: string | null;
  /** Read back from the columns through one function, never re-derived. */
  doubts: EvidenceDoubt[];
};

/** One photograph that passed every refusal, carrying what the row needs. */
export type JudgedClaimPhoto = {
  bytes: Uint8Array;
  takenAt: Date;
  position: number;
  hash: string | null;
  duplicate: DuplicateVerdict;
  row: {
    duplicateVerdict: "unseen" | "retry" | "flag" | "not-compared";
    duplicateDistance: number | null;
    freshnessVerdict: "fresh" | "stale";
    bookingPhotoMatch: BookingPhotoMatch;
  };
};

export type ClaimPhotoJudgement =
  | { ok: true; judged: JudgedClaimPhoto[] }
  /** A hard reject. The customer is told which photograph and why. */
  | { ok: false; refused: EvidenceRefusal; slot: number }
  /** Ours rather than theirs. */
  | { ok: false; failed: "notConfigured" | "notAnImage"; slot: number };

/**
 * Judge every photograph offered with a claim, writing nothing at all.
 *
 * TWO PHASES, AND THE SPLIT IS WHAT MAKES THE REFUSAL USEFUL. A refusal has to be
 * answerable — remove the photograph, or take another — and it is only answerable while
 * the claim has not been made yet. Judging after the insert would leave somebody with an
 * open claim, a rejected photograph and no screen on which to attach a replacement, which
 * is how evidence gets lost. So nothing is written until every photograph has passed:
 * no object, no row, and no hash in the comparison table, because a hash we refused would
 * later read as a near match against an honest photograph.
 *
 * AND A CLAIM IS NEVER BLOCKED BY A PHOTOGRAPH, which is the other half of that choice.
 * Attaching none was always allowed and still is; the dialog offers "remove" beside the
 * refusal, so the way forward is one tap. The refusal costs a file, never the claim.
 *
 * THE CHECKS RUN IN THE ORDER EACH ONE NEEDS THE LAST: the file has to decode before it
 * has a hash or a clock, and the clock has to exist before it can be compared with the
 * job's completion.
 */
export async function judgeClaimPhotos(input: {
  photos: string[];
  bookingId: string;
  customerProfileId: string;
  /** The job's completion, which is what "before the job" is measured against. */
  completedAt: string | null;
  /** When the claim is being made. Passed in so the caller's stamp is the one used. */
  at: Date;
}): Promise<ClaimPhotoJudgement> {
  const offered = input.photos.slice(0, MAX_CLAIM_PHOTOS);
  if (offered.length === 0) return { ok: true, judged: [] };
  if (!hasSupabaseConfig()) return { ok: false, failed: "notConfigured", slot: 0 };

  const judged: JudgedClaimPhoto[] = [];

  for (const [slot, base64] of offered.entries()) {
    const checked = checkUploadedImage(base64);
    if (!checked.ok) {
      console.warn(`[claim-photo] not an image — ${checked.reason}`);
      return { ok: false, failed: "notAnImage", slot };
    }

    const compared = await comparePhoto({
      bytes: checked.bytes,
      kind: "claim",
      bookingId: input.bookingId,
      accountId: input.customerProfileId,
    });

    const bookingPhotoMatch = await matchBookingPhotos({
      hash: compared.hash,
      bookingId: input.bookingId,
    });

    const freshness = judgeFreshness({
      takenAt: checked.takenAt,
      at: input.at,
      windowMinutes: CLAIM_FRESHNESS_WINDOW_MINUTES,
    });

    const judgement = judgeClaimEvidence({
      duplicate: compared.duplicate,
      freshness: freshness.verdict,
      takenBeforeCompletion: takenBeforeCompletion({
        takenAt: checked.takenAt,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
      }),
      bookingPhotoMatch,
    });

    if (judgement.kind === "refused") {
      return { ok: false, refused: judgement.reason, slot };
    }

    /*
     * THE INVARIANT STATED RATHER THAN IMPLIED. An accepted judgement already means the
     * freshness verdict was `fresh` or `stale`, which `judgeFreshness` only returns when
     * it was handed a capture time — so this cannot fire today. It is written as a
     * refusal rather than a non-null assertion because `taken_at` is `not null` in SQL:
     * if the two modules ever disagree, the failure should be a sentence the customer can
     * act on rather than an exception on a money path.
     */
    if (!checked.takenAt) {
      return { ok: false, refused: "noCameraTime", slot };
    }

    judged.push({
      bytes: checked.bytes,
      takenAt: checked.takenAt,
      position: slot,
      hash: compared.hash,
      duplicate: compared.duplicate,
      row: judgement.row,
    });
  }

  return { ok: true, judged };
}

/**
 * Store what was judged, once the claim it belongs to exists.
 *
 * NEVER THROWS AND NEVER UNDOES THE CLAIM. The claim is the thing that matters — it is
 * somebody reporting that work failed — and a storage hiccup must not be the reason their
 * report goes unmade. A photograph that fails to store is simply absent, which is the
 * state every claim before this phase was in. The count that did store is returned so the
 * caller can say so rather than implying all three landed.
 */
export async function storeClaimPhotos(input: {
  claimId: string;
  bookingId: string;
  customerProfileId: string;
  judged: JudgedClaimPhoto[];
}): Promise<ClaimPhoto[]> {
  if (input.judged.length === 0 || !hasSupabaseConfig()) return [];

  const stored: ClaimPhoto[] = [];

  for (const photo of input.judged) {
    const path = `${input.customerProfileId}/${input.claimId}-${photo.position}.jpg`;

    try {
      const admin = createAdminClient();

      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(path, photo.bytes, { contentType: "image/jpeg", upsert: true });

      if (uploadError) {
        console.error(`[claim-photo] upload failed — ${describeError(uploadError)}`);
        continue;
      }

      /*
       * `taken_at` IS WRITTEN AS THE FILE REPORTED IT — the wall clock parsed as UTC, the
       * same convention `booking_photos.taken_at` uses. The 345-minute correction belongs
       * to the comparisons, which have already run; storing a corrected instant would be
       * storing a guess about which timezone the phone was set to.
       */
      const { data, error } = await admin
        .from("guarantee_claim_photos")
        .insert({
          claim_id: input.claimId,
          storage_path: path,
          position: photo.position,
          taken_at: photo.takenAt.toISOString(),
          taken_before_completion: false,
          hash: photo.hash,
          duplicate_verdict: photo.row.duplicateVerdict,
          duplicate_distance: photo.row.duplicateDistance,
          freshness_verdict: photo.row.freshnessVerdict,
          booking_photo_match: photo.row.bookingPhotoMatch,
        })
        .select(
          "id, storage_path, position, taken_at, duplicate_verdict, duplicate_distance, freshness_verdict, booking_photo_match",
        )
        .single();

      if (error || !data) {
        // The slot key is the race two uploads a second apart cannot settle by reading.
        console.error(`[claim-photo] row not written — ${describeError(error)}`);
        continue;
      }

      /* Remembered last, so only a photograph really on record is comparable. */
      await rememberIfNew({
        kind: "claim",
        bookingId: input.bookingId,
        accountId: input.customerProfileId,
        check: { hash: photo.hash, duplicate: photo.duplicate },
      });

      stored.push(toClaimPhoto(data as Record<string, unknown>));
    } catch (thrown) {
      console.error(`[claim-photo] store threw — ${describeError(thrown)}`);
    }
  }

  return stored;
}

function toClaimPhoto(raw: Record<string, unknown>): ClaimPhoto {
  const row = {
    duplicateVerdict: (raw.duplicate_verdict as string | null) ?? null,
    freshnessVerdict: (raw.freshness_verdict as string | null) ?? null,
    bookingPhotoMatch: (raw.booking_photo_match as string | null) ?? null,
  };
  return {
    id: raw.id as string,
    path: raw.storage_path as string,
    position: Number(raw.position ?? 0),
    takenAt: raw.taken_at as string,
    ...row,
    duplicateDistance: (raw.duplicate_distance as number | null) ?? null,
    doubts: doubtsOnRow(row),
  };
}

/**
 * Every photograph on these claims, keyed by claim.
 *
 * ONE READ FOR A WHOLE QUEUE, because `/admin/guarantee-claims` shows up to fifty claims
 * and a read per row would be fifty waves. An empty map on a failed read, which the
 * screen reports as unread rather than as "no photographs" — rule 6 on the surface where
 * a refund is decided.
 */
export async function claimPhotosFor(
  claimIds: string[],
): Promise<{ byClaim: Map<string, ClaimPhoto[]>; read: boolean }> {
  if (claimIds.length === 0 || !hasSupabaseConfig()) {
    return { byClaim: new Map(), read: claimIds.length === 0 };
  }

  try {
    const { data, error } = await createAdminClient()
      .from("guarantee_claim_photos")
      .select(
        "id, claim_id, storage_path, position, taken_at, duplicate_verdict, duplicate_distance, freshness_verdict, booking_photo_match",
      )
      .in("claim_id", claimIds)
      .order("position", { ascending: true });

    if (error) {
      console.error(`[claim-photo] queue read failed — ${describeError(error)}`);
      return { byClaim: new Map(), read: false };
    }

    const byClaim = new Map<string, ClaimPhoto[]>();
    for (const raw of (data ?? []) as Record<string, unknown>[]) {
      const claimId = raw.claim_id as string;
      const list = byClaim.get(claimId) ?? [];
      list.push(toClaimPhoto(raw));
      byClaim.set(claimId, list);
    }
    return { byClaim, read: true };
  } catch (thrown) {
    console.error(`[claim-photo] queue read threw — ${describeError(thrown)}`);
    return { byClaim: new Map(), read: false };
  }
}

/**
 * How many photographs this account has had refused, and out of how many sent.
 *
 * COUNTED, PRINTED, AND ACTED ON BY NOTHING. `maxFailedChecksPerPeriod` is null, so this
 * is the number somebody would set it from rather than a rule being applied. It carries
 * its denominator for the same reason `claimRateWorthReading` does: one refusal out of
 * one and one out of forty are different facts, and a bare count invites a conclusion
 * neither supports.
 *
 * THE REFUSALS ARE NOT IN A TABLE AND THAT IS WHY THIS IS A FLOOR. A refused photograph
 * is never stored, deliberately — so what can be counted is what was ACCEPTED and what
 * carried a doubt. The honest reading is "doubts on record", and the field is named for
 * that rather than for the refusals it cannot see.
 */
export async function claimPhotoDoubtRate(input: {
  customerId: string | null;
}): Promise<{ withDoubt: number; total: number } | null> {
  if (!input.customerId || !hasSupabaseConfig()) return null;

  try {
    const admin = createAdminClient();
    const { data: claims, error: claimError } = await admin
      .from("guarantee_claims")
      .select("id")
      .eq("customer_id", input.customerId);

    if (claimError) return null;
    const ids = ((claims ?? []) as { id: string }[]).map((c) => c.id);
    if (ids.length === 0) return { withDoubt: 0, total: 0 };

    const { byClaim, read } = await claimPhotosFor(ids);
    if (!read) return null;

    let withDoubt = 0;
    let total = 0;
    for (const photos of byClaim.values()) {
      for (const photo of photos) {
        total += 1;
        if (photo.doubts.length > 0) withDoubt += 1;
      }
    }
    return { withDoubt, total };
  } catch {
    return null;
  }
}

/**
 * Signed URLs for a reviewer, and the log row that says they looked.
 *
 * ITS OWN FUNCTION SO THE SIGNING AND THE LOGGING CANNOT COME APART —
 * `recordDocumentAccess`'s arrangement, and the reason is the same one table over: these
 * are photographs taken inside somebody's home, held because they support a claim about
 * money. There is no path that renders one without a row saying who looked.
 *
 * ONE CALL AND ONE LOG ROW PER CLAIM, WHICH IS A DEPARTURE FROM THE ARRIVAL PHOTOGRAPH
 * AND IS DELIBERATE. That screen signs one photograph per claim, so per-read was both.
 * The guarantee queue is capped at fifty claims carrying up to three photographs each:
 * signing them one at a time would be a hundred and fifty sequential round trips on a
 * page render — the shape `/bookings/[id]` was rebuilt for — and a hundred and fifty
 * append-only log rows for one glance at a queue. `createSignedUrls` takes the whole set
 * in one request, and the row records what it can honestly record: this admin opened the
 * evidence on this claim.
 *
 * A MISSING PHOTOGRAPH IS NOT AN ERROR. The claim still has to be decidable, so a failed
 * sign leaves that photograph without a URL and the screen says so.
 */
export async function signClaimPhotosForAdmin(input: {
  paths: string[];
  adminId: string;
  claimId: string;
}): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (input.paths.length === 0 || !hasSupabaseConfig()) return signed;

  try {
    const { data, error } = await createAdminClient()
      .storage.from(BUCKET)
      .createSignedUrls(input.paths, SIGNED_URL_SECONDS);

    if (error || !data) return signed;

    for (const entry of data) {
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
    }

    if (signed.size > 0) {
      await recordSecurityEvent({
        kind: "document.viewed",
        actorId: input.adminId,
        actorRole: "admin",
        subjectType: "booking",
        subjectId: input.claimId,
        detail: {
          reason: "Opened the photographs sent with a guarantee claim.",
          kind: "claimPhoto",
          count: signed.size,
        },
      });
    }

    return signed;
  } catch {
    return signed;
  }
}
