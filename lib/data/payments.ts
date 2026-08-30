import "server-only";

import { randomBytes } from "node:crypto";

import {
  canSettle,
  gatewayFor,
  judgeFinalAmount,
  splitAmount,
  COMMISSION_BPS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payments";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Payments, from the server's side of the boundary.
 *
 * Writes use the admin client on purpose. RLS on `payments` grants no insert
 * or update to anybody, so every write comes through here, after this file has
 * verified the amount against the booking's own frozen quote and — for a
 * gateway — against the gateway's own servers.
 *
 * That means this file carries a duty the rest of the data layer does not: it
 * is holding the service role, so it must never take an amount, a status or a
 * booking id on trust from a caller that got them from a browser. Every
 * function below re-reads the booking and recomputes rather than believing
 * what it was handed.
 *
 * Reads use the RLS-scoped client, so a customer still only sees their own.
 */

export type Payment = {
  id: string;
  bookingId: string;
  method: PaymentMethod;
  amount: number;
  status: PaymentStatus;
  ourReference: string;
  providerTxnId: string | null;
  failureReason: string | null;
  initiatedAt: string | null;
  settledAt: string | null;
  createdAt: string;
};

const COLUMNS =
  "id, booking_id, method, amount, status, our_reference, provider_txn_id, failure_reason, initiated_at, settled_at, created_at";

function rowToPayment(row: Record<string, unknown>): Payment {
  return {
    id: row.id as string,
    bookingId: row.booking_id as string,
    method: row.method as PaymentMethod,
    amount: row.amount as number,
    status: row.status as PaymentStatus,
    ourReference: row.our_reference as string,
    providerTxnId: (row.provider_txn_id as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    initiatedAt: (row.initiated_at as string | null) ?? null,
    settledAt: (row.settled_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

/**
 * Our idempotency key, and the gateway's order id.
 *
 * Random rather than derived from the booking: a retry after a failure must
 * get a *new* reference, or the second attempt is indistinguishable from a
 * duplicate callback for the first.
 */
function makeReference(): string {
  return `SKP-${randomBytes(9).toString("base64url")}`;
}

export type SettleOutcome =
  | { ok: true; payment: Payment }
  | { ok: false; reason: string };

/** The booking fields payment decisions are made from, read fresh. */
async function readBooking(bookingId: string) {
  const { data } = await createAdminClient()
    .from("bookings")
    .select(
      "id, customer_id, status, quoted_min, quoted_max, final_amount, final_amount_approved_at, payment_method",
    )
    .eq("id", bookingId)
    .maybeSingle();
  return data as {
    id: string;
    customer_id: string;
    status: string;
    quoted_min: number;
    quoted_max: number;
    final_amount: number | null;
    final_amount_approved_at: string | null;
    payment_method: string;
  } | null;
}

/**
 * Record the final amount the professional entered on site.
 *
 * The judgement is made here, from the booking's own frozen band — never from
 * the category's current price and never from anything the client sent. The
 * three outcomes and the reasoning behind each boundary are in
 * lib/payments/pricing.ts.
 */
export async function recordFinalAmount(input: {
  bookingId: string;
  amount: number;
  reason: string | null;
  actorId: string;
}): Promise<{ ok: true; verdict: string } | { ok: false; reason: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "bookingNotFound" };

  const verdict = judgeFinalAmount(input.amount, {
    min: booking.quoted_min,
    max: booking.quoted_max,
  });

  if (verdict.outcome === "invalid") {
    return { ok: false, reason: "invalidAmount" };
  }
  if (verdict.outcome === "blocked") {
    // No in-app approval exists above the ceiling. A human has to look.
    return { ok: false, reason: "aboveCeiling" };
  }
  if (verdict.outcome === "needs-approval" && !input.reason?.trim()) {
    // Over the band without a stated reason is not a quote, it is a demand.
    return { ok: false, reason: "reasonRequired" };
  }

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("bookings")
    .update({
      final_amount: input.amount,
      final_amount_reason: input.reason?.trim().slice(0, 300) || null,
      // Within the band is already agreed; over it waits for the customer.
      final_amount_approved_at:
        verdict.outcome === "within-band" ? new Date().toISOString() : null,
    })
    .eq("id", input.bookingId);

  if (error) {
    console.error(`[payments] final amount failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }

  // Written to the history so a dispute has the figure, the reason and who
  // entered it — the whole point of an append-only trail.
  await supabase.from("booking_status_history").insert({
    booking_id: input.bookingId,
    from_status: booking.status,
    to_status: booking.status,
    changed_by: input.actorId,
    changed_by_role: "provider",
    note: `final amount ${input.amount}${input.reason ? ` — ${input.reason}` : ""}`,
  });

  return { ok: true, verdict: verdict.outcome };
}

/** The customer agreeing to a figure above the band. */
export async function approveFinalAmount(input: {
  bookingId: string;
  amount: number;
  actorId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "bookingNotFound" };
  if (booking.customer_id !== input.actorId) return { ok: false, reason: "notYours" };

  // The approval is for a specific figure. If the professional changed it
  // after the customer agreed, the old approval must not carry over.
  if (booking.final_amount !== input.amount) {
    return { ok: false, reason: "amountChanged" };
  }

  const verdict = judgeFinalAmount(input.amount, {
    min: booking.quoted_min,
    max: booking.quoted_max,
  });
  if (verdict.outcome === "blocked" || verdict.outcome === "invalid") {
    return { ok: false, reason: "aboveCeiling" };
  }

  const supabase = createAdminClient();
  await supabase
    .from("bookings")
    .update({ final_amount_approved_at: new Date().toISOString() })
    .eq("id", input.bookingId);

  await supabase.from("booking_status_history").insert({
    booking_id: input.bookingId,
    from_status: booking.status,
    to_status: booking.status,
    changed_by: input.actorId,
    changed_by_role: "customer",
    note: `customer approved ${input.amount}`,
  });

  return { ok: true };
}

/**
 * Create a payment row for a booking, or return the one already in flight.
 *
 * Idempotent by design: a customer who double-taps, or who comes back to the
 * page after a dropped connection, gets the existing attempt rather than a
 * second one. Only a genuinely failed attempt produces a new reference.
 */
export async function openPayment(input: {
  bookingId: string;
  method: PaymentMethod;
  actorId: string;
}): Promise<SettleOutcome> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "bookingNotFound" };
  if (booking.customer_id !== input.actorId) return { ok: false, reason: "notYours" };
  if (booking.final_amount === null) return { ok: false, reason: "noFinalAmount" };

  const verdict = judgeFinalAmount(booking.final_amount, {
    min: booking.quoted_min,
    max: booking.quoted_max,
  });
  const gate = canSettle(verdict, Boolean(booking.final_amount_approved_at));
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const supabase = createAdminClient();

  // An attempt that is still live is reused rather than duplicated.
  const { data: existing } = await supabase
    .from("payments")
    .select(COLUMNS)
    .eq("booking_id", input.bookingId)
    .in("status", ["pending", "initiated", "paid"])
    .order("created_at", { ascending: false })
    .limit(1);

  const live = existing?.[0] as Record<string, unknown> | undefined;
  if (live) {
    const payment = rowToPayment(live);
    // A live attempt for a different method is abandoned in favour of the one
    // the customer just chose — but a paid one is never touched.
    if (payment.status === "paid" || payment.method === input.method) {
      return { ok: true, payment };
    }
    await supabase
      .from("payments")
      .update({ status: "failed", failure_reason: "methodChanged" })
      .eq("id", payment.id);
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({
      booking_id: input.bookingId,
      method: input.method,
      amount: booking.final_amount,
      our_reference: makeReference(),
    })
    .select(COLUMNS)
    .single();

  if (error || !data) {
    console.error(`[payments] open failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  return { ok: true, payment: rowToPayment(data as Record<string, unknown>) };
}

/**
 * Settle a payment from a gateway's own answer.
 *
 * THE SECURITY BOUNDARY OF THIS PHASE. Three things have to hold, and each has
 * a test that forces the failure:
 *
 *   1. The gateway is asked directly. `callback` is passed to the adapter only
 *      so it knows which transaction to look up. A callback claiming success
 *      is a claim made through a browser we do not control.
 *   2. The amount the gateway reports must equal the amount we recorded.
 *      A mismatch fails loudly rather than settling for whichever figure
 *      happens to be larger.
 *   3. Running twice is a no-op. A duplicate callback, a refresh, or a
 *      reconciliation sweep racing the return page all land here, and only the
 *      first may move money.
 */
export async function verifyAndSettle(
  reference: string,
  callback: Record<string, string>,
): Promise<SettleOutcome> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("payments")
    .select(COLUMNS)
    .eq("our_reference", reference)
    .maybeSingle();

  if (!data) return { ok: false, reason: "unknownReference" };
  const payment = rowToPayment(data as Record<string, unknown>);

  // (3) Already settled. Return the same answer rather than a second one.
  if (payment.status === "paid") return { ok: true, payment };
  if (payment.status === "refunded" || payment.status === "partially_refunded") {
    return { ok: true, payment };
  }

  // (1) Ask the gateway, not the browser.
  const result = await gatewayFor(payment.method).verify({
    reference,
    expectedAmount: payment.amount,
    callback,
  });

  if (!result.ok) {
    // We could not get an answer. Deliberately NOT marked failed — the money
    // may well have left the customer's account, and a payment we cannot
    // reach is exactly what the reconciliation sweep is for.
    await supabase
      .from("payments")
      .update({ failure_reason: result.reason.slice(0, 500) })
      .eq("id", payment.id);
    return { ok: false, reason: "verificationUnavailable" };
  }

  if (result.status !== "paid") {
    const next: PaymentStatus = result.status === "pending" ? "initiated" : "failed";
    await supabase
      .from("payments")
      .update({
        status: next,
        failure_reason: result.reason.slice(0, 500),
        raw_response: result.raw as never,
      })
      .eq("id", payment.id)
      // Guard the write: if something else settled it since we read, do not
      // move it backwards.
      .in("status", ["pending", "initiated"]);
    return { ok: false, reason: result.status === "pending" ? "stillPending" : "failed" };
  }

  // (2) Reconcile the amount. Loudly.
  if (result.amount !== payment.amount) {
    console.error(
      `[payments] amount mismatch on ${reference}: gateway ${result.amount}, ours ${payment.amount}`,
    );
    await supabase
      .from("payments")
      .update({
        status: "failed",
        failure_reason: `amountMismatch: gateway ${result.amount} vs ours ${payment.amount}`,
        raw_response: result.raw as never,
        provider_txn_id: result.providerTxnId,
      })
      .eq("id", payment.id)
      .in("status", ["pending", "initiated"]);
    return { ok: false, reason: "amountMismatch" };
  }

  return settlePaid(payment, result.providerTxnId, result.raw);
}

/**
 * Mark a payment paid and freeze the commission split.
 *
 * The `.in("status", ...)` on the update is the idempotency guard: two
 * concurrent callbacks both reach here, and only the one that finds the row
 * still unsettled writes. The loser gets zero rows back and returns the
 * settled row unchanged.
 */
async function settlePaid(
  payment: Payment,
  providerTxnId: string,
  raw: unknown,
): Promise<SettleOutcome> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("payments")
    .update({
      status: "paid",
      provider_txn_id: providerTxnId,
      raw_response: raw as never,
      failure_reason: null,
    })
    .eq("id", payment.id)
    .in("status", ["pending", "initiated"])
    .select(COLUMNS);

  if (error) {
    console.error(`[payments] settle failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }

  if (!data || data.length === 0) {
    // Somebody else settled it between our read and our write. Not an error —
    // the customer's money arrived exactly once, which is the whole point.
    const { data: current } = await supabase
      .from("payments")
      .select(COLUMNS)
      .eq("id", payment.id)
      .maybeSingle();
    return current
      ? { ok: true, payment: rowToPayment(current as Record<string, unknown>) }
      : { ok: false, reason: "vanished" };
  }

  const settled = rowToPayment(data[0] as Record<string, unknown>);

  // Freeze what the platform took and what the professional earned, at the
  // rate in force today. See lib/payments/commission.ts.
  const split = splitAmount(settled.amount, COMMISSION_BPS);
  await supabase
    .from("bookings")
    .update({
      payment_status: "paid",
      platform_fee: split.platformFee,
      provider_earning: split.providerEarning,
      commission_bps: split.commissionBps,
    })
    .eq("id", settled.bookingId);

  return { ok: true, payment: settled };
}

/**
 * Cash: the customer confirms they handed the money over.
 *
 * The customer is the oracle here — there is no server to ask — so this
 * checks that the caller *is* the customer before settling. That check cannot
 * live in the gateway adapter, which has no idea who is asking.
 */
export async function confirmCashPayment(input: {
  reference: string;
  actorId: string;
}): Promise<SettleOutcome> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("payments")
    .select(COLUMNS)
    .eq("our_reference", input.reference)
    .maybeSingle();

  if (!data) return { ok: false, reason: "unknownReference" };
  const payment = rowToPayment(data as Record<string, unknown>);
  if (payment.method !== "cash") return { ok: false, reason: "notCash" };
  if (payment.status === "paid") return { ok: true, payment };

  const booking = await readBooking(payment.bookingId);
  if (!booking || booking.customer_id !== input.actorId) {
    return { ok: false, reason: "notYours" };
  }

  return settlePaid(payment, `cash:${payment.ourReference}`, {
    confirmedBy: input.actorId,
    at: new Date().toISOString(),
  });
}

/**
 * The customer says the amount is wrong, or will not confirm.
 *
 * Flagged, never silently settled. A booking sitting unpaid with a dispute on
 * it is a support queue; a booking quietly marked paid is a customer who was
 * charged for something they disagreed with.
 */
export async function disputeAmount(input: {
  bookingId: string;
  actorId: string;
  note: string;
}): Promise<{ ok: boolean }> {
  if (!hasSupabaseConfig()) return { ok: false };

  const supabase = createAdminClient();
  const booking = await readBooking(input.bookingId);
  if (!booking || booking.customer_id !== input.actorId) return { ok: false };

  await supabase.from("booking_status_history").insert({
    booking_id: input.bookingId,
    from_status: booking.status,
    to_status: booking.status,
    changed_by: input.actorId,
    changed_by_role: "customer",
    note: `amount disputed: ${input.note.slice(0, 250)}`,
  });

  await supabase
    .from("bookings")
    .update({ final_amount_approved_at: null })
    .eq("id", input.bookingId);

  return { ok: true };
}

/**
 * Re-verify anything that started and never finished.
 *
 * A dropped connection mid-payment is routine on mobile data here, and a user
 * who paid must never be shown as unpaid. Run from a cron or on demand; safe
 * to run as often as you like, because `verifyAndSettle` is idempotent.
 */
export async function reconcileStuckPayments(
  olderThanMinutes = 10,
): Promise<{ checked: number; settled: number }> {
  if (!hasSupabaseConfig()) return { checked: 0, settled: 0 };

  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { data } = await createAdminClient()
    .from("payments")
    .select("our_reference")
    .eq("status", "initiated")
    .lt("initiated_at", cutoff)
    .limit(50);

  let settled = 0;
  for (const row of data ?? []) {
    const result = await verifyAndSettle(row.our_reference as string, {});
    if (result.ok) settled += 1;
  }
  return { checked: data?.length ?? 0, settled };
}

/** The payments on a booking, through RLS — a customer sees only their own. */
export async function listPaymentsForBooking(
  bookingId: string,
): Promise<Payment[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const { data } = await createClient()
      .from("payments")
      .select(COLUMNS)
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false });
    return (data ?? []).map((row) =>
      rowToPayment(row as Record<string, unknown>),
    );
  } catch {
    return [];
  }
}
