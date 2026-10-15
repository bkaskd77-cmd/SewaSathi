import "server-only";

import {
  CUSTOMER_FLAGS,
  REPLY_MAX_CHARS,
  canReply,
  isCustomerFlag,
  isHomepageHideCode,
  reviewWindowFrom,
  sealed,
  showsOnHomepage,
  type CustomerFlag,
  type HomepageHideCode,
  type HomepageRefusal,
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

/* ------------------------------------------------------------------ *
 * The homepage, and who may be on it
 * ------------------------------------------------------------------ */

/**
 * One published review as the admin screen sees it — with the reason it is or
 * is not on the homepage.
 *
 * THE WHOLE POINT IS THE REASON. Four things keep a review off the front page
 * and only one of them is a decision anybody took; the other three are a
 * customer's opt-out, a phone number in the text, and the review not having
 * published yet. Without this view a review absent for any of those reads
 * exactly like one somebody hid, which is `proposalSuppressedBy`'s rule — a
 * hidden proposal and no proposal must not look alike — and it matters more
 * here, because the absence that has no row behind it is the one that would
 * otherwise be blamed on a person.
 *
 * It carries the rating so the screen can show what was hidden, and NOTHING
 * selects or sorts on it. A screen that is for watching a moderation power
 * being used has to show the stars, or nobody can see the pattern this design
 * is built to make visible.
 */
export type ReviewModeration = {
  id: string;
  providerId: string;
  providerName: string;
  authorName: string;
  rating: number;
  comment: string;
  publishedAt: string | null;
  /** `showsOnHomepage`'s verdict, computed here so one rule answers. */
  shows: boolean;
  why: HomepageRefusal | null;
  hiddenAt: string | null;
  hiddenCode: HomepageHideCode | null;
  hiddenReason: string | null;
};

/**
 * Every published review, newest first, with its homepage verdict.
 *
 * NULL IS A FAILED READ and the screen says so — never an empty list, which
 * would read as "there are no reviews" on the one screen built to watch a
 * moderation power being used. Rule 6 where the absence does real damage.
 */
export async function reviewsForModeration(
  limit = 100,
): Promise<ReviewModeration[] | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { data, error } = await createAdminClient()
      .from("provider_reviews")
      .select(
        "id, provider_id, rating, comment, published_at, homepage_hidden_at, homepage_hidden_code, homepage_hidden_reason, providers(display_name), profiles!provider_reviews_customer_id_fkey(full_name, hide_from_activity)",
      )
      .not("published_at", "is", null)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[reviews] moderation read failed — ${describeError(error)}`);
      return null;
    }

    return (((data ?? []) as unknown) as Record<string, unknown>[]).map((row) => {
      const provider = embedded(row.providers) as
        | { display_name?: string | null }
        | null;
      const profile = embedded(row.profiles) as
        | { full_name?: string | null; hide_from_activity?: boolean | null }
        | null;

      const comment = String(row.comment ?? "");
      const publishedAt = row.published_at ? String(row.published_at) : null;
      const hiddenAt = row.homepage_hidden_at
        ? String(row.homepage_hidden_at)
        : null;

      // THE SAME FUNCTION THE HOMEPAGE ASKS. Two implementations of "is this on
      // the front page" is a screen that can be wrong about what it is showing.
      const verdict = showsOnHomepage({
        publishedAt,
        comment,
        authorOptedOut: Boolean(profile?.hide_from_activity),
        hiddenAt,
      });

      const code = row.homepage_hidden_code
        ? String(row.homepage_hidden_code)
        : null;

      return {
        id: String(row.id),
        providerId: String(row.provider_id),
        providerName: String(provider?.display_name ?? ""),
        // First name only, as every other surface shows it.
        authorName: String(profile?.full_name ?? "").trim().split(/\s+/)[0] ?? "",
        rating: Number(row.rating),
        comment,
        publishedAt,
        shows: verdict.shows,
        why: verdict.shows ? null : verdict.why,
        hiddenAt,
        hiddenCode: code && isHomepageHideCode(code) ? code : null,
        hiddenReason: row.homepage_hidden_reason
          ? String(row.homepage_hidden_reason)
          : null,
      };
    });
  } catch (thrown) {
    console.error(`[reviews] moderation read threw — ${describeError(thrown)}`);
    return null;
  }
}

/** supabase-js gives an embedded row as an object or a one-element array. */
function embedded(value: unknown): unknown {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

export type HideResult =
  | { ok: true; hidden: boolean; providerId: string }
  | { ok: false; why: "notConfigured" | "notFound" | "badCode" | "noReason" | "failed" };

/**
 * Take a published review off the homepage, or put it back.
 *
 * WHAT IT DOES NOT TOUCH, which is most of the design: not `rating`, not
 * `published_at`, not `excluded_from_average_at`. The review stays on the
 * provider's listing and keeps counting toward every average, including the
 * recency-weighted one — `refresh_provider_stats` reads nothing this writes, so
 * no ranking position moves and `tests/db/review-homepage.test.ts` asserts it
 * rather than leaving it to be re-read off this comment.
 *
 * A REASON IS REQUIRED IN BOTH DIRECTIONS and the code only when hiding.
 * Un-hiding needs a sentence too, which is not symmetry for its own sake: a
 * review put back without one leaves a log entry saying somebody reversed a
 * decision for no stated reason, and that is the pattern worth being able to
 * read later.
 *
 * NOTHING HERE CAN EXPRESS "IT WAS NEGATIVE". The code set has two values and
 * the database refuses a third; the caller cannot pass a rating; and the
 * homepage selection does not read one. That is the structural half of the
 * promise, and a promise is all it would otherwise be.
 */
export async function setReviewHomepageVisibility(input: {
  reviewId: string;
  hidden: boolean;
  code: string;
  reason: string;
  actorId: string;
}): Promise<HideResult> {
  if (!hasSupabaseConfig()) return { ok: false, why: "notConfigured" };

  const reason = input.reason.trim();
  if (reason.length < 2 || reason.length > 600) {
    return { ok: false, why: "noReason" };
  }
  if (input.hidden && !isHomepageHideCode(input.code)) {
    return { ok: false, why: "badCode" };
  }

  try {
    const admin = createAdminClient();

    /*
     * RE-READ RATHER THAN BELIEVE THE FORM, the `lib/data/payments.ts` rule.
     * The only thing that crosses the wire is an id, and a review that is not
     * published yet may not be moderated at all — it is still sealed, and a
     * decision about words nobody has read is a decision taken too early.
     */
    const { data: review, error: readFailed } = await admin
      .from("provider_reviews")
      .select("id, provider_id, published_at")
      .eq("id", input.reviewId)
      .maybeSingle();

    if (readFailed || !review || !review.published_at) {
      return { ok: false, why: "notFound" };
    }

    const { error } = await admin
      .from("provider_reviews")
      .update(
        input.hidden
          ? {
              homepage_hidden_at: new Date().toISOString(),
              homepage_hidden_by: input.actorId,
              homepage_hidden_code: input.code,
              homepage_hidden_reason: reason,
            }
          : {
              // All four together, which the check constraint enforces anyway —
              // written out rather than relying on it, because a partial clear
              // refused by the database is an error nobody can act on.
              homepage_hidden_at: null,
              homepage_hidden_by: null,
              homepage_hidden_code: null,
              homepage_hidden_reason: null,
            },
      )
      .eq("id", input.reviewId);

    if (error) {
      console.error(`[reviews] homepage visibility failed — ${describeError(error)}`);
      return { ok: false, why: "failed" };
    }

    return {
      ok: true,
      hidden: input.hidden,
      providerId: String(review.provider_id),
    };
  } catch (thrown) {
    console.error(`[reviews] homepage visibility threw — ${describeError(thrown)}`);
    return { ok: false, why: "failed" };
  }
}
