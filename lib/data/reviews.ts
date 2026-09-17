import "server-only";

import {
  CUSTOMER_FLAGS,
  REPLY_MAX_CHARS,
  canReply,
  isCustomerFlag,
  reviewWindowFrom,
  sealed,
  type CustomerFlag,
  type ReviewPair,
} from "@/lib/reviews";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Writing a review, answering one, and letting the pair out of its envelope.
 *
 * SERVICE-ROLE WRITES AFTER AN RLS READ, the shape `lib/data/survey.ts` uses.
 * The reads prove who is asking; the writes cannot go through a policy because
 * a review's publication state is not the author's to set — somebody who could
 * stamp `published_at` on their own row could read the other side's first,
 * which is the one thing double-blind exists to stop.
 */

export type ReviewResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "notConfigured"
        | "notFound"
        | "notYours"
        | "notFinished"
        | "alreadyReviewed"
        | "windowClosed"
        | "badRating"
        | "alreadyReplied"
        | "disputeOpen"
        | "notPublished"
        | "windowPassed"
        | "failed";
    };

type BookingRow = {
  id: string;
  reference: string;
  customerId: string;
  providerId: string | null;
  status: string;
  completedAt: string | null;
  amountMismatchAt: string | null;
};

const BOOKING_SELECT =
  "id, reference, customer_id, provider_id, status, completed_at, amount_mismatch_at";

function toBooking(row: Record<string, unknown>): BookingRow {
  return {
    id: row.id as string,
    reference: row.reference as string,
    customerId: row.customer_id as string,
    providerId: (row.provider_id as string | null) ?? null,
    status: row.status as string,
    completedAt: (row.completed_at as string | null) ?? null,
    amountMismatchAt: (row.amount_mismatch_at as string | null) ?? null,
  };
}

/** Through RLS, so reading it at all is the ownership check. */
async function readBooking(bookingId: string): Promise<BookingRow | null> {
  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(BOOKING_SELECT)
      .eq("id", bookingId)
      .maybeSingle();
    if (error) {
      console.error(`[reviews] booking read failed — ${describeError(error)}`);
      return null;
    }
    return data ? toBooking(data as Record<string, unknown>) : null;
  } catch (thrown) {
    console.error(`[reviews] booking read threw — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * Is something open that a reply would be arguing with?
 *
 * A guarantee claim, a payment the two sides disagree about, or a no-show
 * claim. Each already has a process, and a public reply would outlive whatever
 * that process found.
 */
async function disputeOpen(booking: BookingRow): Promise<boolean> {
  if (booking.amountMismatchAt) return true;

  const db = createAdminClient();
  const [claims, noShows] = await Promise.all([
    db
      .from("guarantee_claims")
      .select("id")
      .eq("booking_id", booking.id)
      .not("status", "in", "(resolved,rejected)")
      .limit(1),
    db
      .from("no_show_claims")
      .select("id")
      .eq("booking_id", booking.id)
      .eq("status", "open")
      .limit(1),
  ]);

  return (claims.data?.length ?? 0) > 0 || (noShows.data?.length ?? 0) > 0;
}

/** Both sides of one booking, for the sealed/published question. */
async function pairFor(bookingId: string): Promise<ReviewPair> {
  const db = createAdminClient();
  const [review, booking] = await Promise.all([
    db
      .from("provider_reviews")
      .select("submitted_at, window_closes_at")
      .eq("booking_id", bookingId)
      .maybeSingle(),
    db
      .from("bookings")
      .select("provider_visit_reviewed_at, completed_at")
      .eq("id", bookingId)
      .maybeSingle(),
  ]);

  /*
   * THE PROFESSIONAL'S SIDE IS "THEY ANSWERED", NOT "THEY FLAGGED SOMETHING".
   * Most visits are straightforward and produce no flags at all, so keying the
   * seal on a flag row would mean the common case never counts as answering —
   * and every ordinary job would sit sealed until the fortnight ran out.
   */
  const providerAnswered =
    (booking.data?.provider_visit_reviewed_at as string | null) ?? null;

  return {
    customer: review.data?.submitted_at
      ? { submittedAt: review.data.submitted_at as string }
      : null,
    provider: providerAnswered ? { submittedAt: providerAnswered } : null,
    windowClosesAt:
      (review.data?.window_closes_at as string | null) ??
      (booking.data?.completed_at
        ? reviewWindowFrom(
            new Date(booking.data.completed_at as string),
          ).toISOString()
        : null),
  };
}

/** The customer rates the job. */
export async function submitReview(input: {
  bookingId: string;
  customerId: string;
  rating: number;
  comment: string;
  now?: Date;
}): Promise<ReviewResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, reason: "badRating" };
  }

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.customerId !== input.customerId) {
    return { ok: false, reason: "notYours" };
  }
  if (booking.status !== "completed") return { ok: false, reason: "notFinished" };

  const now = input.now ?? new Date();
  const closes = reviewWindowFrom(
    booking.completedAt ? new Date(booking.completedAt) : now,
  );
  if (now.getTime() >= closes.getTime()) {
    return { ok: false, reason: "windowClosed" };
  }

  const { error } = await createAdminClient()
    .from("provider_reviews")
    .insert({
      // A review with no professional on it is a review of nobody. The status
      // check above means the job finished, which means somebody did it.
      provider_id: booking.providerId!,
      booking_id: input.bookingId,
      customer_id: input.customerId,
      // First name only. A review is public and the professional has been to
      // this person's house.
      author_name: "",
      rating: input.rating,
      comment: input.comment.trim(),
      submitted_at: now.toISOString(),
      window_closes_at: closes.toISOString(),
    });

  if (error) {
    if (error.code === "23505") return { ok: false, reason: "alreadyReviewed" };
    console.error(`[reviews] submit failed — ${describeError(error)}`);
    return { ok: false, reason: "failed" };
  }

  await publishIfReady(input.bookingId, now);
  return { ok: true };
}

/**
 * The professional answers for the visit.
 *
 * ONE QUESTION AND SOME TICK BOXES. There is no free-text field to write into,
 * which is the design rather than a validation rule — see `CUSTOMER_FLAGS`.
 */
export async function submitVisitReview(input: {
  bookingId: string;
  providerId: string;
  flags: string[];
  now?: Date;
}): Promise<ReviewResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.providerId !== input.providerId) {
    return { ok: false, reason: "notYours" };
  }
  if (booking.status !== "completed") return { ok: false, reason: "notFinished" };

  const now = input.now ?? new Date();
  const db = createAdminClient();

  // Unknown values are dropped rather than refused: a stale client sending a
  // flag we have retired should not cost the professional their answer.
  const flags = input.flags.filter(isCustomerFlag) as CustomerFlag[];

  if (flags.length > 0) {
    const { error } = await db.from("customer_visit_flags").insert(
      flags.map((flag) => ({
        booking_id: input.bookingId,
        provider_id: input.providerId,
        customer_id: booking.customerId,
        flag,
        submitted_at: now.toISOString(),
      })),
    );
    if (error && error.code !== "23505") {
      console.error(`[reviews] flags failed — ${describeError(error)}`);
      return { ok: false, reason: "failed" };
    }
  }

  const { error: markError } = await db
    .from("bookings")
    .update({ provider_visit_reviewed_at: now.toISOString() })
    .eq("id", input.bookingId)
    .is("provider_visit_reviewed_at", null);

  if (markError) {
    console.error(`[reviews] visit mark failed — ${describeError(markError)}`);
    return { ok: false, reason: "failed" };
  }

  await publishIfReady(input.bookingId, now);
  return { ok: true };
}

/** The professional answers the review, once. */
export async function replyToReview(input: {
  bookingId: string;
  providerId: string;
  text: string;
  now?: Date;
}): Promise<ReviewResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.providerId !== input.providerId) {
    return { ok: false, reason: "notYours" };
  }

  const db = createAdminClient();
  const { data: review } = await db
    .from("provider_reviews")
    .select("id, reply_text")
    .eq("booking_id", input.bookingId)
    .maybeSingle();

  if (!review) return { ok: false, reason: "notFound" };

  const now = input.now ?? new Date();
  const verdict = canReply({
    pair: await pairFor(input.bookingId),
    alreadyReplied: Boolean(review.reply_text),
    disputeOpen: await disputeOpen(booking),
    now,
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const text = input.text.trim().slice(0, REPLY_MAX_CHARS);
  const { error } = await db
    .from("provider_reviews")
    .update({ reply_text: text, replied_at: now.toISOString() })
    .eq("id", review.id as string)
    // Guarded rather than trusted from the read: two taps must not become two
    // replies, and the rule is one.
    .is("reply_text", null);

  if (error) {
    console.error(`[reviews] reply failed — ${describeError(error)}`);
    return { ok: false, reason: "failed" };
  }
  return { ok: true };
}

/** Let one pair out of its envelope, if it is time. */
async function publishIfReady(bookingId: string, now: Date): Promise<void> {
  const pair = await pairFor(bookingId);
  if (sealed(pair, now)) return;

  const db = createAdminClient();
  const { data } = await db
    .from("provider_reviews")
    .update({ published_at: now.toISOString() })
    .eq("booking_id", bookingId)
    .is("published_at", null)
    .not("submitted_at", "is", null)
    .select("provider_id");

  if ((data?.length ?? 0) > 0) {
    const providerId = data![0].provider_id as string | null;
    if (providerId) {
      await notify({
        recipientId: providerId,
        kind: "review.published",
        params: { reference: bookingId.slice(0, 8) },
        bookingId,
      });
    }
  }
}

/**
 * Release every pair whose fortnight has run out.
 *
 * Rides the dispatch cron beside the quote sweep — both answer "is this
 * waiting on something that has already run out?", both are idempotent, and a
 * second scheduled endpoint is a second thing that can silently stop running.
 */
export async function publishDueReviews(
  now: Date = new Date(),
): Promise<{ published: number }> {
  if (!hasSupabaseConfig()) return { published: 0 };

  const { data, error } = await createAdminClient()
    .from("provider_reviews")
    .select("booking_id")
    .is("published_at", null)
    .not("submitted_at", "is", null)
    .lt("window_closes_at", now.toISOString());

  if (error || !data) {
    console.error(`[reviews] publish sweep failed — ${describeError(error)}`);
    return { published: 0 };
  }

  let published = 0;
  for (const row of data as Array<{ booking_id: string }>) {
    await publishIfReady(row.booking_id, now);
    published += 1;
  }
  return { published };
}

/** Exported so the form can render exactly what the rules allow. */
export const VISIT_FLAGS = CUSTOMER_FLAGS;

/**
 * Has this customer already reviewed, and is it out?
 *
 * Read through RLS: the "customers read their own review" policy is what makes
 * a sealed review visible to its author and nobody else, so this is the
 * ownership check as well as the read.
 */
export async function myReviewState(
  bookingId: string,
): Promise<{ submitted: boolean; published: boolean }> {
  if (!hasSupabaseConfig()) return { submitted: false, published: false };

  try {
    const { data } = await createClient()
      .from("provider_reviews")
      .select("submitted_at, published_at")
      .eq("booking_id", bookingId)
      .maybeSingle();

    return {
      submitted: Boolean(data?.submitted_at),
      published: Boolean(data?.published_at),
    };
  } catch (thrown) {
    // A failed read must not hide the form: offering it twice is recoverable
    // (the unique constraint refuses the second), hiding it loses the review.
    console.error(`[reviews] own review read threw — ${describeError(thrown)}`);
    return { submitted: false, published: false };
  }
}
