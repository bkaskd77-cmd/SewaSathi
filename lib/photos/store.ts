import "server-only";

import { judgeDuplicate, type DuplicateVerdict } from "@/lib/photos/duplicate";
import { perceptualHash } from "@/lib/photos/hash";
import { describeError } from "@/lib/data/source";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Compare a photograph against the ones we already hold, then remember it.
 *
 * ONE IMPLEMENTATION, BECAUSE THE RULE IS ONE RULE. This was written inside
 * `arrival-photos.ts` and the booking photographs needed exactly the same three steps —
 * hash, compare, keep. Copying it would have been two places deciding what counts as a
 * reuse, which is the shape of almost every bug this repository has written down.
 *
 * THE KIND SCOPES THE COMPARISON. An arrival photograph is compared against arrival
 * photographs and a booking photograph against booking photographs, because the question
 * differs: the same picture of a door on two bookings is a reused wasted-trip claim, while
 * a customer sending the same picture of their boiler to the job and to a later claim is
 * ordinary. Cross-kind comparison is a decision for the claim gates, where it means
 * something, rather than a default here.
 */

export type PhotoKind = "arrival" | "booking" | "claim";

/** Bounded rather than unbounded — see the note on `judgeAgainstPriors`. */
const HASH_COMPARISON_LIMIT = 5000;

export type PhotoCheck = {
  /** Null when the bytes could not be decoded. Never compared, never a reject. */
  hash: string | null;
  duplicate: DuplicateVerdict;
};

/**
 * Hash the bytes, judge them against what we hold, and keep the hash.
 *
 * THE HASH IS KEPT EVEN WHEN NOTHING MATCHED, which is the whole mechanism: a photograph is
 * recognisable later only because something comparable was kept today. A retry on the same
 * booking writes nothing new — the row is already there.
 *
 * NOTHING HERE REFUSES ANYTHING. It returns a verdict; what that verdict is allowed to do
 * belongs to the caller, and today no caller refuses an upload on it.
 */
export async function checkAndRemember(input: {
  bytes: Uint8Array;
  kind: PhotoKind;
  bookingId: string;
  accountId: string | null;
}): Promise<PhotoCheck> {
  const hash = perceptualHash(input.bytes);
  const duplicate = await judgeAgainstPriors({ ...input, hash });

  if (hash && duplicate.kind !== "retry") {
    await rememberHash({ ...input, hash });
  }

  return { hash, duplicate };
}

/**
 * Every hash of this kind, compared in memory.
 *
 * IN MEMORY BECAUSE HAMMING DISTANCE IS NOT A SQL OPERATION — not without an extension this
 * project does not have — and because the table is small. It is bounded rather than
 * unbounded, so the day it is not small this degrades to "compared against the most recent
 * few thousand" rather than a query that gets slower every month. That is a real limit and
 * it is written down rather than discovered: a photograph older than the bound goes
 * unrecognised, which is a missed duplicate and never a false one.
 */
async function judgeAgainstPriors(input: {
  hash: string | null;
  kind: PhotoKind;
  bookingId: string;
  accountId: string | null;
}): Promise<DuplicateVerdict> {
  if (!input.hash) return { kind: "not-compared" };

  try {
    const { data, error } = await createAdminClient()
      .from("photo_hashes")
      .select("hash, booking_id, account_id")
      .eq("kind", input.kind)
      .order("created_at", { ascending: false })
      .limit(HASH_COMPARISON_LIMIT);

    /*
     * A FAILED READ IS "NOT COMPARED", NEVER "UNSEEN". Rule 6 on a check that will gate a
     * payment: if the table did not answer, we have not established that this photograph is
     * new, and a verdict saying we did would be manufactured.
     */
    if (error) {
      console.error(`[photos] hashes unread — ${describeError(error)}`);
      return { kind: "not-compared" };
    }

    return judgeDuplicate({
      hash: input.hash,
      bookingId: input.bookingId,
      accountId: input.accountId,
      priors: (data ?? []).map((row) => ({
        hash: row.hash as string,
        bookingId: (row.booking_id as string | null) ?? "",
        accountId: (row.account_id as string | null) ?? null,
      })),
    });
  } catch (thrown) {
    console.error(`[photos] hash compare threw — ${describeError(thrown)}`);
    return { kind: "not-compared" };
  }
}

/** Keep the hash so a reuse can be recognised later. Never blocks anything. */
async function rememberHash(input: {
  hash: string;
  kind: PhotoKind;
  bookingId: string;
  accountId: string | null;
}): Promise<void> {
  try {
    const { error } = await createAdminClient().from("photo_hashes").insert({
      hash: input.hash,
      kind: input.kind,
      booking_id: input.bookingId,
      account_id: input.accountId,
    });
    if (error) console.error(`[photos] hash not kept — ${describeError(error)}`);
  } catch (thrown) {
    console.error(`[photos] hash insert threw — ${describeError(thrown)}`);
  }
}
