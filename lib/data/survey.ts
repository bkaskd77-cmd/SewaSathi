import "server-only";

import {
  quoteExpiryFrom,
  quoteState,
  type QuoteFacts,
  type QuoteState,
} from "@/lib/booking";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Recording a surveyed price, and the customer answering it.
 *
 * THE SHAPE IS THE ONE `declineJob` USES, and for the same reason: prove
 * ownership with an RLS **read**, then write under the service role. The write
 * itself cannot go through a policy, because `enforce_booking_immutability`
 * refuses these columns to every browser caller — the approval timestamp is
 * what the whole 2x price ceiling hangs from, and RLS is row-level, so a policy
 * that lets a customer cancel their own booking would otherwise let them stamp
 * an approval on a price nobody surveyed.
 *
 * Nothing here decides whether the numbers are allowed. `enforce_survey_quote`
 * in Postgres does that and cannot be bypassed; this returns a sentence instead
 * of an exception.
 */

export type SurveyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "notConfigured"
        | "notFound"
        | "notYours"
        | "notASurvey"
        | "alreadyAnswered"
        | "expired"
        | "badRange"
        | "failed";
    };

type QuoteRow = QuoteFacts & {
  id: string;
  reference: string;
  customerId: string;
  providerId: string | null;
  status: string;
};

function toFacts(row: Record<string, unknown>): QuoteRow {
  return {
    id: row.id as string,
    reference: row.reference as string,
    customerId: row.customer_id as string,
    providerId: (row.provider_id as string | null) ?? null,
    status: row.status as string,
    quoteModel: ((row.quote_model as string | null) ?? "band") as "band" | "survey",
    quotedMin: (row.quoted_min as number | null) ?? null,
    quotedMax: (row.quoted_max as number | null) ?? null,
    surveyedAt: (row.surveyed_at as string | null) ?? null,
    quoteExpiresAt: (row.quote_expires_at as string | null) ?? null,
    quoteApprovedAt: (row.quote_approved_at as string | null) ?? null,
    quoteDeclinedAt: (row.quote_declined_at as string | null) ?? null,
  };
}

const SELECT =
  "id, reference, customer_id, provider_id, status, quote_model, quoted_min, quoted_max, surveyed_at, quote_expires_at, quote_approved_at, quote_declined_at";

/** Through RLS, so reading it at all is the ownership check. */
async function readQuote(bookingId: string): Promise<QuoteRow | null> {
  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(SELECT)
      .eq("id", bookingId)
      .maybeSingle();
    if (error) {
      console.error(`[survey] read failed — ${describeError(error)}`);
      return null;
    }
    return data ? toFacts(data as Record<string, unknown>) : null;
  } catch (thrown) {
    console.error(`[survey] read threw — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * The professional records what they found.
 *
 * A RANGE, NOT A FIGURE, because that is what every other trade publishes and
 * what `judgeFinalAmount` measures against. Quoting a single number here would
 * mean the 2x ceiling sat at exactly twice the quote with no room for the
 * ordinary overrun the approval flow exists to allow.
 */
export async function recordSurveyQuote(input: {
  bookingId: string;
  /** The listing the caller owns — proved by `getMyProvider` upstream. */
  providerId: string;
  min: number;
  max: number;
  now?: Date;
}): Promise<SurveyResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  if (
    !Number.isInteger(input.min) ||
    !Number.isInteger(input.max) ||
    input.min <= 0 ||
    input.max < input.min
  ) {
    return { ok: false, reason: "badRange" };
  }

  const booking = await readQuote(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.providerId !== input.providerId) {
    return { ok: false, reason: "notYours" };
  }
  if (booking.quoteModel !== "survey") return { ok: false, reason: "notASurvey" };

  /*
   * A PRICE THE CUSTOMER HAS ANSWERED IS FINISHED. The trigger refuses to let
   * an approved band be rewritten — the ceiling would move out from under an
   * approval given for something else — and this says so in words first.
   */
  if (booking.quoteApprovedAt || booking.quoteDeclinedAt) {
    return { ok: false, reason: "alreadyAnswered" };
  }

  const now = input.now ?? new Date();
  const expires = quoteExpiryFrom(now);

  const { error } = await createAdminClient()
    .from("bookings")
    .update({
      quoted_min: input.min,
      quoted_max: input.max,
      surveyed_at: now.toISOString(),
      quote_expires_at: expires.toISOString(),
    })
    .eq("id", input.bookingId)
    // Re-quoting is allowed until the customer answers, never after. Guarded in
    // the update rather than trusted from the read above, so two surveys racing
    // cannot both land on either side of an approval.
    .is("quote_approved_at", null)
    .is("quote_declined_at", null);

  if (error) {
    console.error(`[survey] quote write failed — ${describeError(error)}`);
    return { ok: false, reason: "failed" };
  }

  /*
   * ONE TAP FROM HERE TO THE ANSWER. The approval is the drop-off point on the
   * highest-value trade we sell: somebody who meant to answer and somebody who
   * decided not to look identical in the data, and the difference is usually
   * whether anybody asked.
   */
  await notify({
    recipientId: booking.customerId,
    kind: "booking.quoteReady",
    params: { reference: booking.reference },
    bookingId: input.bookingId,
  });

  return { ok: true };
}

/**
 * The customer says yes or no.
 *
 * `actorId` comes from the session upstream and the booking is read through
 * RLS, so a customer can only ever answer their own. The stamp itself is a
 * service-role write for the reason at the top of this file.
 */
export async function respondToQuote(input: {
  bookingId: string;
  customerId: string;
  decision: "approve" | "decline";
  now?: Date;
}): Promise<SurveyResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const booking = await readQuote(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.customerId !== input.customerId) {
    return { ok: false, reason: "notYours" };
  }
  if (booking.quoteModel !== "survey") return { ok: false, reason: "notASurvey" };

  const now = input.now ?? new Date();
  const state = quoteState(booking, now);

  if (state === "approved" || state === "declined") {
    return { ok: false, reason: "alreadyAnswered" };
  }
  if (state === "awaiting-survey") return { ok: false, reason: "notFound" };
  /*
   * AN EXPIRED PRICE CANNOT BE ACCEPTED LATE, and that is a protection for the
   * professional rather than a rule against the customer: a figure built from
   * last week's van and last week's labour is one somebody would have to
   * absorb the difference on. The screen offers a fresh survey instead.
   */
  if (state === "expired") return { ok: false, reason: "expired" };

  const stamp = now.toISOString();
  const { error } = await createAdminClient()
    .from("bookings")
    .update(
      input.decision === "approve"
        ? { quote_approved_at: stamp }
        : { quote_declined_at: stamp },
    )
    .eq("id", input.bookingId)
    .is("quote_approved_at", null)
    .is("quote_declined_at", null);

  if (error) {
    console.error(`[survey] response write failed — ${describeError(error)}`);
    return { ok: false, reason: "failed" };
  }

  if (booking.providerId) {
    await notify({
      recipientId: booking.providerId,
      kind:
        input.decision === "approve"
          ? "booking.quoteApproved"
          : "booking.quoteDeclined",
      params: { reference: booking.reference },
      bookingId: input.bookingId,
    });
  }

  return { ok: true };
}

/** What the customer's page needs to draw, in one read. */
export function surveyStateOf(
  booking: QuoteFacts,
  now: Date = new Date(),
): QuoteState {
  return quoteState(booking, now);
}

/**
 * Close out prices nobody answered.
 *
 * WHY A SWEEP AND NOT A READ-TIME RULE. `quoteState` already reports `expired`
 * the moment the deadline passes, so every screen is honest without this. What
 * a screen cannot do is tell the customer — somebody who left the tab is
 * exactly the person who needs to hear that their move is not going ahead, and
 * the professional needs to stop holding the slot.
 *
 * IDEMPOTENT BY CONSTRUCTION, like the dispatch sweep: the work is decided
 * entirely by the row's own timestamps, so running it late, twice, or
 * overlapping changes nothing that was not already due.
 *
 * A lapsed quote ends the booking rather than leaving it open. The alternative
 * is a row that can never progress and never closes — the thing
 * `no_provider_found` exists to prevent on the other side of the same problem.
 * It is `cancelled` by `system`, with the reason stored, so the page can say
 * the PRICE expired rather than implying the customer walked away.
 */
export async function expireStaleQuotes(
  now: Date = new Date(),
): Promise<{ expired: number }> {
  if (!hasSupabaseConfig()) return { expired: 0 };

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, reference, customer_id, provider_id")
    .eq("quote_model", "survey")
    .is("quote_approved_at", null)
    .is("quote_declined_at", null)
    .not("quote_expires_at", "is", null)
    .lt("quote_expires_at", now.toISOString())
    .in("status", ["pending", "accepted", "en_route"]);

  if (error || !data) {
    console.error(`[survey] expiry sweep read failed — ${describeError(error)}`);
    return { expired: 0 };
  }

  let expired = 0;
  for (const row of data as Array<{
    id: string;
    reference: string;
    customer_id: string;
    provider_id: string | null;
  }>) {
    const { error: writeError } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: now.toISOString(),
        cancelled_by_role: "system",
        cancellation_reason: "quote_expired",
        quote_declined_at: now.toISOString(),
      })
      .eq("id", row.id)
      // Guarded rather than trusted from the read: a customer approving in the
      // same second must win, and does.
      .is("quote_approved_at", null)
      .is("quote_declined_at", null);

    if (writeError) {
      console.error(`[survey] expiry write failed — ${describeError(writeError)}`);
      continue;
    }
    expired += 1;

    await notify({
      recipientId: row.customer_id,
      kind: "booking.quoteExpired",
      params: { reference: row.reference },
      bookingId: row.id,
    });
    /*
     * The professional is told too, and the visit fee falls due — see
     * `surveyOutcome`. They travelled and looked; a customer not answering is
     * not something they can be asked to absorb, and it is recorded against
     * them nowhere.
     */
    if (row.provider_id) {
      await notify({
        recipientId: row.provider_id,
        kind: "booking.quoteExpired",
        params: { reference: row.reference },
        bookingId: row.id,
      });
    }
  }

  return { expired };
}
