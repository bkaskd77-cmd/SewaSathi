import "server-only";

import {
  quoteExpiryFrom,
  quoteState,
  type QuoteFacts,
  type QuoteState,
} from "@/lib/booking";
import {
  QUEUE_CAP,
  unreadableQueue,
  type QueuePage,
} from "@/lib/data/queue";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { PAYOUT_RULES } from "@/lib/payments";
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
 * What we owe a surveyor when the move does not go ahead.
 *
 * WRITTEN PENDING, NEVER PAID. The row is the record that somebody travelled;
 * the money moves only when a person approves it. That is what stops the fee
 * being farmed — quote high, get declined, collect only becomes a living if
 * collecting is automatic, and here it never is. Same shape as
 * `commission_appeals` and the guarantee refund: money that turns on a
 * judgement does not move without somebody making it.
 *
 * NEVER THROWS. The customer's decline has already happened and the booking has
 * already moved; a fee row that cannot be written must not roll that back. The
 * database refuses it outright when no arrival was recorded — no trip, no fee —
 * and that refusal is a normal outcome here, not an error worth alarming
 * anybody about.
 */
async function recordVisitFee(input: {
  bookingId: string;
  providerId: string | null;
  outcome: "declined" | "expired";
}): Promise<void> {
  if (!input.providerId) return;

  try {
    const { error } = await createAdminClient()
      .from("survey_visit_fees")
      .insert({
        booking_id: input.bookingId,
        provider_id: input.providerId,
        outcome: input.outcome,
        amount: PAYOUT_RULES.surveyVisitFeeNpr,
      });

    // A duplicate is one booking surveyed once and answered once — the unique
    // constraint doing its job, not a failure.
    if (error && error.code !== "23505") {
      // warn rather than error: a refusal here is usually the trigger doing
      // its job (nobody recorded an arrival), which is a normal outcome and
      // not something that went wrong.
      console.warn(`[survey] no visit fee recorded — ${describeError(error)}`);
    }
  } catch (thrown) {
    console.warn(`[survey] visit fee write threw — ${describeError(thrown)}`);
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

  if (input.decision === "decline") {
    await recordVisitFee({
      bookingId: input.bookingId,
      providerId: booking.providerId,
      outcome: "declined",
    });
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

    await recordVisitFee({
      bookingId: row.id,
      providerId: row.provider_id,
      outcome: "expired",
    });

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

/* ------------------------------------------------------------------ *
 * The survey visit fee, waiting on a person
 * ------------------------------------------------------------------ */

export type PendingSurveyFee = {
  id: string;
  bookingId: string;
  reference: string;
  categorySlug: string;
  providerId: string;
  providerName: string | null;
  /** `declined` or `expired` — what the customer did, or did not do. */
  outcome: string;
  /** Rupees, frozen when the row was written. */
  amount: number;
  createdAt: string;
  /** Approved fees this professional already has this month. Cap is four. */
  approvedThisMonth: number;
  /**
   * How often this TRADE's surveys are declined, as a percentage.
   *
   * Never the person's own rate. A high decline rate has three readings and
   * only one is about somebody: quoting high, a ward where customers shop
   * around, or OUR WHOLE PROPOSITION FOR THAT TRADE BEING MISPRICED. Read the
   * wrong way round it is a list of people to punish for a price we set, which
   * is why `survey_decline_signals` is grouped by category and why this number
   * appears at the moment a human decides one fee and nowhere else.
   */
  tradeDeclineRate: number | null;
};

/**
 * Every survey fee nobody has decided yet.
 *
 * Service role, because the queue is an admin screen and the table grants
 * nobody insert or update by design — see the migration. The read is
 * admin-only at the page and again in the action; this function is not the
 * guard and does not pretend to be.
 */
export const SURVEY_FEE_QUEUE_CAP = QUEUE_CAP;

export async function pendingSurveyFees(): Promise<QueuePage<PendingSurveyFee>> {
  if (!hasSupabaseConfig()) return unreadableQueue(SURVEY_FEE_QUEUE_CAP);

  try {
    const admin = createAdminClient();

    const { data, error, count } = await admin
      .from("survey_visit_fees")
      .select(
        "id, booking_id, provider_id, outcome, amount, created_at, counts_for_month, bookings (reference, category_slug), providers (display_name)",
        { count: "exact" },
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(SURVEY_FEE_QUEUE_CAP);

    if (error) {
      console.error(`[survey] fee queue failed — ${describeError(error)}`);
      return unreadableQueue(SURVEY_FEE_QUEUE_CAP);
    }

    const total = count ?? null;
    if (!data || data.length === 0) {
      return { rows: [], total, cap: SURVEY_FEE_QUEUE_CAP };
    }

    const rows = data as Array<Record<string, unknown>>;

    /*
     * The two counts the reviewer needs, both in one wave rather than per row.
     * A queue that costs a query per entry is a queue somebody stops opening.
     */
    const [{ data: approved }, { data: signals }] = await Promise.all([
      admin
        .from("survey_visit_fees")
        .select("provider_id, counts_for_month")
        .eq("status", "approved"),
      admin
        .from("survey_decline_signals")
        .select("category_slug, decline_rate_pct"),
    ]);

    const approvedCount = new Map<string, number>();
    for (const row of (approved ?? []) as Record<string, unknown>[]) {
      const key = `${row.provider_id as string}:${row.counts_for_month as string}`;
      approvedCount.set(key, (approvedCount.get(key) ?? 0) + 1);
    }

    /*
     * Several months come back per trade. The most recent wins — a rate from
     * March is not evidence about a fee raised in September, and averaging
     * them would bury a trade that has just started going wrong.
     */
    const declineRate = new Map<string, number>();
    for (const row of (signals ?? []) as Record<string, unknown>[]) {
      const slug = row.category_slug as string;
      const pct = row.decline_rate_pct;
      if (pct == null || declineRate.has(slug)) continue;
      declineRate.set(slug, Number(pct));
    }

    const fees = rows.map((row) => {
      const booking = (row.bookings ?? null) as Record<string, unknown> | null;
      const provider = (row.providers ?? null) as Record<string, unknown> | null;
      const slug = (booking?.category_slug as string | null) ?? "";
      return {
        id: row.id as string,
        bookingId: row.booking_id as string,
        reference: (booking?.reference as string | null) ?? "—",
        categorySlug: slug,
        providerId: row.provider_id as string,
        providerName: (provider?.display_name as string | null) ?? null,
        outcome: row.outcome as string,
        amount: Number(row.amount ?? 0),
        createdAt: row.created_at as string,
        approvedThisMonth:
          approvedCount.get(
            `${row.provider_id as string}:${row.counts_for_month as string}`,
          ) ?? 0,
        // Null is "we have not measured this trade", never zero. A 0% decline
        // rate printed for a trade nobody has surveyed would read as evidence.
        tradeDeclineRate: declineRate.has(slug)
          ? (declineRate.get(slug) as number)
          : null,
      };
    });

    return { rows: fees, total, cap: SURVEY_FEE_QUEUE_CAP };
  } catch (thrown) {
    console.error(`[survey] fee queue threw — ${describeError(thrown)}`);
    return unreadableQueue(SURVEY_FEE_QUEUE_CAP);
  }
}

/** How many survey fees are waiting, without fetching any. */
export async function pendingSurveyFeesCount(): Promise<number | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { count, error } = await createAdminClient()
      .from("survey_visit_fees")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (error) {
      console.error(`[survey] fee count failed — ${describeError(error)}`);
      return null;
    }
    return count ?? null;
  } catch (thrown) {
    console.error(`[survey] fee count threw — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * Approve or refuse one survey visit fee.
 *
 * THE DEFAULT IS NOT PAID AND THIS IS THE ONLY THING THAT CHANGES IT. A fee
 * that paid itself would be farmable — quote absurdly high, get declined,
 * collect — so the row is born `pending` and a person decides, four times a
 * month at most. This function is that person's hand, not a rule of its own.
 *
 * NOTHING HERE RE-IMPLEMENTS THE CAP. `enforce_survey_visit_fee` counts
 * approved rows for the month and refuses the fifth, and it refuses any
 * non-pending row with no `decided_by` — an approved row with nobody's name on
 * it is the automatic payout the table exists to prevent, wearing a status. So
 * a refusal comes back as the database's own and is reported, rather than
 * being second-guessed by a number this file would have to keep in step.
 *
 * The write goes under the service role because the table grants nobody insert
 * or update; the admin check is re-read here from the actor's profile and
 * again in the action, because a server action is a public POST endpoint.
 */
export async function decideSurveyVisitFee(input: {
  feeId: string;
  approve: boolean;
  note: string;
  actorId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const note = input.note.trim();
  if (!note) return { ok: false, reason: "reasonRequired" };

  try {
    const admin = createAdminClient();

    const { data: actor } = await admin
      .from("profiles")
      .select("role")
      .eq("id", input.actorId)
      .maybeSingle();
    if ((actor?.role as string | null) !== "admin") {
      return { ok: false, reason: "notAdmin" };
    }

    const { data: fee } = await admin
      .from("survey_visit_fees")
      .select("id, status")
      .eq("id", input.feeId)
      .maybeSingle();

    if (!fee) return { ok: false, reason: "notFound" };
    if (fee.status !== "pending") {
      return { ok: false, reason: "alreadyDecided" };
    }

    const { error } = await admin
      .from("survey_visit_fees")
      .update({
        status: input.approve ? "approved" : "rejected",
        decided_by: input.actorId,
        decided_at: new Date().toISOString(),
        decision_note: note.slice(0, 600),
      })
      .eq("id", input.feeId)
      // Guarded, so two reviewers deciding the same row at the same second
      // produce one decision rather than the second overwriting the first.
      .eq("status", "pending");

    if (error) {
      /*
       * The monthly cap arrives here, as a check violation raised by the
       * trigger. It is a normal outcome — a fifth honest trip in one month —
       * and the reviewer is told which it was rather than "save failed".
       */
      const message = describeError(error);
      if (/more survey visits than we pay for/i.test(message)) {
        return { ok: false, reason: "monthlyCap" };
      }
      console.error(`[survey] fee decision failed — ${message}`);
      return { ok: false, reason: "saveFailed" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[survey] fee decision threw — ${describeError(thrown)}`);
    return { ok: false, reason: "saveFailed" };
  }
}

/**
 * This professional's own survey fees, for their dashboard.
 *
 * A FEE NOBODY CAN SEE IS A PROMISE NOBODY HAS BEEN MADE. The policy says we
 * pay for the trip when a survey comes to nothing; until this read existed,
 * the row was written, held pending, and never mentioned to the person it was
 * written for.
 *
 * IT TAKES THE PROFESSIONAL. "Providers read their own survey fees" exists,
 * and it is the floor rather than the filter — `"Admins read every survey
 * fee"` sits permissively beside it, so a read naming nobody hands every
 * professional's fees to an admin who also works here. Same shape as
 * `listBookings`; see the note at the top of `lib/data/bookings.ts`.
 */
export async function mySurveyFees(providerId: string): Promise<
  Array<{ id: string; outcome: string; amount: number; status: string; createdAt: string }>
> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { data, error } = await createClient()
      .from("survey_visit_fees")
      .select("id, outcome, amount, status, created_at")
      .eq("provider_id", providerId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      console.error(`[survey] own fees failed — ${describeError(error)}`);
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      outcome: row.outcome as string,
      amount: Number(row.amount ?? 0),
      status: row.status as string,
      createdAt: row.created_at as string,
    }));
  } catch (thrown) {
    console.error(`[survey] own fees threw — ${describeError(thrown)}`);
    return [];
  }
}
