import "server-only";

import { randomBytes } from "node:crypto";

import {
  canSettle,
  commissionBasis,
  commissionBpsFor,
  gatewayFor,
  judgeFinalAmount,
  payoutDueAt,
  settleSplit,
  COMMISSION_BPS,
  type PaymentMethod,
  type PaymentStatus,
} from "@/lib/payments";
import { recordSecurityEvent } from "@/lib/audit";
import { notifyAll } from "@/lib/notify";
import type { PaymentMixRow } from "@/lib/data/payment-mix";
import type { PricingSignal } from "@/lib/data/pricing-signals";
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
      "id, reference, customer_id, provider_id, status, quoted_min, quoted_max, final_amount, final_amount_approved_at, payment_method, commission_floor_waived, customer_reported_amount, amount_mismatch_at",
    )
    .eq("id", bookingId)
    .maybeSingle();
  return data as {
    id: string;
    reference: string;
    customer_id: string;
    provider_id: string | null;
    status: string;
    quoted_min: number;
    quoted_max: number;
    final_amount: number | null;
    final_amount_approved_at: string | null;
    payment_method: string;
    commission_floor_waived: boolean;
    customer_reported_amount: number | null;
    amount_mismatch_at: string | null;
  } | null;
}

/**
 * May this actor put a figure on this booking?
 *
 * The professional assigned to it, or an admin. Nobody else — and emphatically
 * not the customer, who would then be setting the price they pay, and not a
 * professional who happens to be logged in but was assigned a different job.
 *
 * Checked here rather than only at the route, because this file holds the
 * service role: a future caller that forgets the check would otherwise let
 * anyone bill anyone.
 */
async function canBill(
  actorId: string,
  booking: { provider_id: string | null },
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", actorId)
    .maybeSingle();
  if ((profile as { role?: string } | null)?.role === "admin") return true;

  if (!booking.provider_id) return false;
  const { data: provider } = await supabase
    .from("providers")
    .select("profile_id")
    .eq("id", booking.provider_id)
    .maybeSingle();
  return (
    (provider as { profile_id?: string | null } | null)?.profile_id === actorId
  );
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
  if (!(await canBill(input.actorId, booking))) {
    return { ok: false, reason: "notYours" };
  }
  // Billing for a job that has not started is not an overrun, it is a mistake
  // or a fraud. The band was quoted; the work is what justifies leaving it.
  if (booking.status !== "in_progress" && booking.status !== "completed") {
    return { ok: false, reason: "notStarted" };
  }

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

  /*
   * TWO RECORDS OF THE SAME MOMENT, and they are not redundant.
   *
   * `booking_status_history` is the booking's story and the customer's own
   * page can read parts of it. `security_events` is the evidence: append-only
   * in the database, unreadable by anybody but an admin, and it survives a
   * booking being edited or deleted. The figure a professional typed while
   * standing in somebody's kitchen is the single most disputed fact in this
   * product, so it goes in both.
   */
  await recordSecurityEvent({
    kind: "payment.amountRecorded",
    actorId: input.actorId,
    actorRole: "provider",
    subjectType: "booking",
    subjectId: input.bookingId,
    detail: {
      amount: input.amount,
      verdict: verdict.outcome,
      quotedMin: booking.quoted_min,
      quotedMax: booking.quoted_max,
      reasonGiven: Boolean(input.reason?.trim()),
    },
  });

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

  // The other half of the disputed moment: the professional typed a figure
  // over the band and the customer agreed to it. Both sides, both timestamped,
  // in a table neither of them can edit.
  await recordSecurityEvent({
    kind: "payment.amountApproved",
    actorId: input.actorId,
    actorRole: "customer",
    subjectType: "booking",
    subjectId: input.bookingId,
    detail: { amount: input.amount },
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
 * The handoff: what the browser has to do next to pay.
 *
 * Three shapes because the gateways genuinely differ. eSewa needs a signed
 * form POST, Khalti gives back a URL to redirect to, and cash needs nothing at
 * all — the customer pays the professional and comes back to confirm. Folding
 * cash into a fake "redirect" would have been tidier and wrong: it is the
 * common path here, not a degraded one.
 */
export type Handoff =
  | { ok: true; kind: "redirect"; url: string; reference: string }
  | {
      ok: true;
      kind: "form";
      url: string;
      fields: Record<string, string>;
      reference: string;
    }
  | { ok: true; kind: "cash"; reference: string }
  | { ok: false; reason: string };

/**
 * Where a gateway sends the customer back to.
 *
 * Our own reference rides on the query string as `ref` so a return that has
 * been stripped of the gateway's own payload still resolves to a row. It is an
 * identifier, not a capability: naming a reference gets you a verification
 * against the gateway and nothing else.
 */
function returnUrl(origin: string, method: PaymentMethod, reference: string) {
  return `${origin}/api/payments/${method}/return?ref=${encodeURIComponent(reference)}`;
}

/**
 * Open a payment and hand the customer to the gateway.
 *
 * The amount handed to the gateway is the one read out of the booking here —
 * never one that came in from a form. That is the whole reason this lives
 * behind the data layer rather than in the server action.
 */
export async function startPayment(input: {
  bookingId: string;
  method: PaymentMethod;
  actorId: string;
  /** Absolute site origin, e.g. https://sewasathi.vercel.app. */
  origin: string;
  description: string;
  customer: { name: string | null; phone: string | null };
}): Promise<Handoff> {
  const opened = await openPayment({
    bookingId: input.bookingId,
    method: input.method,
    actorId: input.actorId,
  });
  if (!opened.ok) return { ok: false, reason: opened.reason };

  const payment = opened.payment;

  // Already settled — the customer is looking at a stale page. Say so rather
  // than opening a second attempt against a paid booking.
  if (payment.status === "paid") return { ok: false, reason: "alreadyPaid" };

  if (input.method === "cash") {
    return { ok: true, kind: "cash", reference: payment.ourReference };
  }

  const url = returnUrl(input.origin, input.method, payment.ourReference);
  const result = await gatewayFor(input.method).initiate({
    reference: payment.ourReference,
    amount: payment.amount,
    successUrl: url,
    // The same route on failure: a gateway saying "cancelled" is still only a
    // claim, and the route verifies either way.
    failureUrl: `${url}&outcome=failed`,
    description: input.description,
    customer: input.customer,
  });

  if (!result.ok) {
    await createAdminClient()
      .from("payments")
      .update({ status: "failed", failure_reason: result.reason.slice(0, 500) })
      .eq("id", payment.id)
      .in("status", ["pending", "initiated"]);
    return { ok: false, reason: "gatewayUnavailable" };
  }

  // Marked initiated only once the gateway has accepted the attempt, so
  // `initiated_at` is a real handoff time and the reconciliation sweep is not
  // chasing payments that never left.
  await createAdminClient()
    .from("payments")
    .update({
      status: "initiated",
      initiated_at: new Date().toISOString(),
      provider_txn_id: result.providerTxnId ?? null,
      raw_response: result.raw as never,
    })
    .eq("id", payment.id)
    .in("status", ["pending", "initiated"]);

  return result.kind === "form"
    ? {
        ok: true,
        kind: "form",
        url: result.url,
        fields: result.fields ?? {},
        reference: payment.ourReference,
      }
    : { ok: true, kind: "redirect", url: result.url, reference: payment.ourReference };
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

  /*
   * Freeze the split, and freeze it against the FLOOR rather than the reported
   * amount. See lib/payments/commission.ts for why that is the whole answer to
   * under-reporting: the band is ours, so reporting less than it earns the
   * professional nothing, and the motive disappears instead of the number
   * having to be policed.
   *
   * The rate itself comes from `commissionBpsFor`, which is where a digital
   * discount or a cash surcharge would apply. Both are zero today, so this is
   * the base rate until somebody deliberately chooses otherwise — but every
   * settlement already stores the rate that was used, so turning an incentive
   * on never rewrites what anybody was already told they had earned.
   */
  const booking = await readBooking(settled.bookingId);
  const commissionBps = commissionBpsFor(settled.method, COMMISSION_BPS);
  const split = settleSplit({
    amount: settled.amount,
    quotedMin: booking?.quoted_min ?? 0,
    commissionBps,
    floorWaived: booking?.commission_floor_waived ?? false,
  });

  const settledAt = new Date(settled.settledAt ?? new Date().toISOString());

  await supabase
    .from("bookings")
    .update({
      payment_status: "paid",
      platform_fee: split.platformFee,
      provider_earning: split.providerEarning,
      commission_bps: split.commissionBps,
      commission_basis: split.basis,
      // Stored, never recomputed on read: a professional told Thursday is paid
      // on Thursday even if the hold times move on Wednesday.
      payout_due_at: payoutDueAt(settledAt, settled.method).toISOString(),
    })
    .eq("id", settled.bookingId);

  await sendReceipts(settled, booking);

  await recordSecurityEvent({
    kind: "payment.settled",
    actorRole: "system",
    subjectType: "payment",
    subjectId: settled.ourReference,
    detail: {
      bookingId: settled.bookingId,
      amount: settled.amount,
      method: settled.method,
      platformFee: split.platformFee,
      providerEarning: split.providerEarning,
      commissionBps: split.commissionBps,
      basis: split.basis,
      floorApplied: split.floorApplied,
    },
  });

  return { ok: true, payment: settled };
}

/**
 * A receipt, to both sides, on every settlement.
 *
 * The point is the number and who sees it. A customer who handed over Rs 2,000
 * and receives a receipt for Rs 1,000 notices — and notices *afterwards*, when
 * the professional has left and saying so costs them nothing. That is a
 * different thing from asking them to check a figure while somebody is
 * standing in their kitchen waiting for the tap.
 *
 * It goes to the professional too, and not as a courtesy: it is the same
 * figure, so a professional whose recorded amount was wrong finds out at the
 * same moment the customer does.
 *
 * A KEY, NOT A SENTENCE — so Phase 13 sends exactly this over SMS by adding a
 * channel and changing nothing here. Notifications never throw: the money has
 * already moved, and a dead gateway must not roll that back.
 */
async function sendReceipts(
  settled: Payment,
  booking: { reference: string; customer_id: string; provider_id: string | null } | null,
): Promise<void> {
  if (!booking) return;

  const params = {
    reference: booking.reference,
    amount: String(settled.amount),
    method: settled.method,
  };

  const recipients: string[] = [booking.customer_id];

  if (booking.provider_id) {
    const { data } = await createAdminClient()
      .from("providers")
      .select("profile_id")
      .eq("id", booking.provider_id)
      .maybeSingle();
    const profileId = (data?.profile_id as string | null) ?? null;
    if (profileId) recipients.push(profileId);
  }

  await notifyAll(
    recipients.map((recipientId) => ({
      recipientId,
      kind: "payment.receipt" as const,
      params,
      bookingId: settled.bookingId,
    })),
  );
}

/**
 * Cash: the customer says what they actually handed over.
 *
 * BLIND, AND THAT IS THE WHOLE MECHANISM. The screen does not show the
 * professional's figure before the customer types theirs — see
 * `blindCashEntry` for exactly when. The old version asked the customer to
 * *approve* a number somebody else had entered, which is a rubber stamp: a
 * professional who takes Rs 2,000 and records 1,000 needs only a tired
 * customer tapping the green button, and nothing in the product would ever
 * know. Asking them to state the figure independently turns the one witness a
 * cash handover has into an actual witness.
 *
 * A MISMATCH SETTLES NOTHING. Both numbers are kept, the booking is stamped,
 * both sides are told, and it becomes a support queue. Marking it paid on
 * either figure would be picking a side of a dispute with no evidence, and
 * quietly settling on the professional's figure is precisely the outcome the
 * mechanism exists to prevent.
 *
 * The customer is still the only oracle there is for cash — there is no server
 * to ask — so this also checks that the caller *is* the customer. That check
 * cannot live in the gateway adapter, which has no idea who is asking.
 */
export async function confirmCashPayment(input: {
  reference: string;
  actorId: string;
  /**
   * What the customer says they paid. Optional so an over-band settlement —
   * where they have already seen and approved the exact figure, so there is
   * nothing to be blind about — can confirm without retyping it.
   */
  amountPaid?: number;
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
  // Already flagged. A second tap must not settle it — the whole point of the
  // stamp is that a person looks before any money is called paid.
  if (booking.amount_mismatch_at) {
    return { ok: false, reason: "amountMismatch" };
  }

  const recorded = booking.final_amount ?? payment.amount;

  if (input.amountPaid !== undefined && input.amountPaid !== recorded) {
    await flagAmountMismatch({
      booking,
      recorded,
      reported: input.amountPaid,
      actorId: input.actorId,
    });
    return { ok: false, reason: "amountMismatch" };
  }

  // Kept even when it matches: agreement is evidence too, and a professional
  // whose figures are confirmed by hundreds of customers has a record worth
  // something when one of them does not.
  if (input.amountPaid !== undefined) {
    await supabase
      .from("bookings")
      .update({ customer_reported_amount: input.amountPaid })
      .eq("id", booking.id);
  }

  return settlePaid(payment, `cash:${payment.ourReference}`, {
    confirmedBy: input.actorId,
    at: new Date().toISOString(),
    reportedAmount: input.amountPaid ?? null,
  });
}

/**
 * The two figures disagree, so nothing is paid and a person is told.
 *
 * Deliberately does NOT decide who is right. The larger figure is not
 * automatically the truth — a customer can mistype as easily as anybody — and
 * a product that silently believed either side would be worse than one that
 * stops. What it does guarantee is that both numbers survive, in a place a
 * dispute can be read from later.
 */
async function flagAmountMismatch(input: {
  booking: { id: string; reference: string; customer_id: string; provider_id: string | null; status: string };
  recorded: number;
  reported: number;
  actorId: string;
}): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from("bookings")
    .update({
      customer_reported_amount: input.reported,
      amount_mismatch_at: new Date().toISOString(),
    })
    .eq("id", input.booking.id);

  await supabase.from("booking_status_history").insert({
    booking_id: input.booking.id,
    from_status: input.booking.status,
    to_status: input.booking.status,
    changed_by: input.actorId,
    changed_by_role: "customer",
    note: `amount mismatch — professional recorded ${input.recorded}, customer reported ${input.reported}`,
  });

  const params = {
    reference: input.booking.reference,
    recorded: String(input.recorded),
    reported: String(input.reported),
  };

  const recipients = [input.booking.customer_id];
  if (input.booking.provider_id) {
    const { data } = await supabase
      .from("providers")
      .select("profile_id")
      .eq("id", input.booking.provider_id)
      .maybeSingle();
    const profileId = (data?.profile_id as string | null) ?? null;
    if (profileId) recipients.push(profileId);
  }

  await notifyAll(
    recipients.map((recipientId) => ({
      recipientId,
      kind: "payment.mismatch" as const,
      params,
      bookingId: input.booking.id,
    })),
  );

  // The one a person will be asked to adjudicate. Both figures, kept where
  // neither party can reach them.
  await recordSecurityEvent({
    kind: "payment.mismatch",
    actorId: input.actorId,
    actorRole: "customer",
    subjectType: "booking",
    subjectId: input.booking.id,
    detail: { recorded: input.recorded, reported: input.reported },
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

/**
 * One payment by our reference, with the booking it belongs to.
 *
 * Used by the return route, which knows a reference and nothing else and has
 * to send the customer back to the right booking. Admin-scoped because the
 * route runs before any session is guaranteed — a customer can come back from
 * a gateway in a fresh browser tab — so the caller sends them to the booking
 * page and RLS decides there whether they may see it.
 */
export async function findPaymentByReference(
  reference: string,
): Promise<{ payment: Payment; bookingId: string } | null> {
  if (!hasSupabaseConfig()) return null;
  const { data } = await createAdminClient()
    .from("payments")
    .select(COLUMNS)
    .eq("our_reference", reference)
    .maybeSingle();
  if (!data) return null;
  const payment = rowToPayment(data as Record<string, unknown>);
  return { payment, bookingId: payment.bookingId };
}

/**
 * Give up on a gateway attempt and choose another way to pay.
 *
 * A customer who opens eSewa, changes their mind and closes the tab leaves an
 * attempt sitting at `initiated` for ever. The panel correctly says money may
 * be in flight — but with no way past it, the booking becomes unpayable by any
 * other method. Cash is the common path here, so that is not a corner case,
 * it is Tuesday.
 *
 * IT ASKS THE GATEWAY FIRST, AND THAT IS THE WHOLE SAFETY OF IT. Marking an
 * attempt failed when the customer actually paid would show them as owing
 * money they have already handed over. So this runs the same verification the
 * return route does: if the gateway says paid, it settles and the abandon
 * never happens. Only an explicit "not paid" from the gateway releases the
 * row. A gateway we cannot reach refuses — an unanswered question is not a no.
 */
export async function abandonPayment(input: {
  reference: string;
  actorId: string;
}): Promise<{ ok: true; settled: boolean } | { ok: false; reason: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("payments")
    .select(COLUMNS)
    .eq("our_reference", input.reference)
    .maybeSingle();

  if (!data) return { ok: false, reason: "unknownReference" };
  const payment = rowToPayment(data as Record<string, unknown>);

  const booking = await readBooking(payment.bookingId);
  if (!booking || booking.customer_id !== input.actorId) {
    return { ok: false, reason: "notYours" };
  }
  if (payment.status === "paid") return { ok: true, settled: true };

  // The gateway's answer decides, not the customer's intent.
  const verified = await verifyAndSettle(input.reference, {});
  if (verified.ok) return { ok: true, settled: true };
  if (verified.reason === "verificationUnavailable") {
    return { ok: false, reason: "gatewayUnavailable" };
  }

  const { error } = await supabase
    .from("payments")
    .update({ status: "failed", failure_reason: "abandonedByCustomer" })
    .eq("id", payment.id)
    .in("status", ["pending", "initiated"]);

  if (error) {
    console.error(`[payments] abandon failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  return { ok: true, settled: false };
}


/* -------------------------------------------------------------------------
 * The appeal, and the pricing signal.
 *
 * The commission floor is deliberately blunt, and a blunt rule with no appeal
 * is how a platform loses the honest half of its supply. Two answers, at two
 * different scales, and keeping them separate is the point:
 *
 *   per job      -> the professional appeals and a person decides
 *   per category -> if jobs bunch under the floor, OUR band is wrong
 *
 * The second must never be read as a list of people to punish. A category
 * where a third of jobs land under the published minimum is a category we have
 * mispriced, and every one of those jobs was overcharged in fee by us.
 * ------------------------------------------------------------------------- */

export type Appeal = {
  id: string;
  status: string;
  reason: string;
  resolutionNote: string | null;
  createdAt: string;
};

/** The appeal on one booking, if the professional has raised one. */
export async function getCommissionAppeal(
  bookingId: string,
): Promise<Appeal | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data } = await createAdminClient()
      .from("commission_appeals")
      .select("id, status, reason, resolution_note, created_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (!data) return null;
    return {
      id: data.id as string,
      status: data.status as string,
      reason: data.reason as string,
      resolutionNote: (data.resolution_note as string | null) ?? null,
      createdAt: data.created_at as string,
    };
  } catch {
    return null;
  }
}

/**
 * "This job really was smaller than the band."
 *
 * Only the professional who did the job may raise it, only once, and only when
 * the floor actually cost them something — an appeal against a fee that was
 * never charged is noise in a queue a person has to read. RLS grants nobody
 * insert on this table, so the write is here under the service role after the
 * ownership check, exactly like every other write that decides money.
 */
export async function openCommissionAppeal(input: {
  bookingId: string;
  actorId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const reason = input.reason.trim();
  if (reason.length < 4) return { ok: false, reason: "reasonRequired" };

  const booking = await readBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "bookingNotFound" };
  if (!(await canBill(input.actorId, booking))) {
    return { ok: false, reason: "notYours" };
  }
  if (booking.final_amount === null) return { ok: false, reason: "notStarted" };
  if (booking.commission_floor_waived) return { ok: false, reason: "alreadyWaived" };

  // Was the floor actually applied? Asked from the booking's own frozen band,
  // not from the category's current price.
  const basis = commissionBasis(booking.final_amount, booking.quoted_min);
  if (basis <= booking.final_amount) {
    return { ok: false, reason: "floorNotApplied" };
  }

  const { error } = await createAdminClient()
    .from("commission_appeals")
    .insert({
      booking_id: booking.id,
      provider_id: booking.provider_id!,
      reason: reason.slice(0, 600),
    });

  if (error) {
    // 23505 is the one-appeal-per-booking constraint doing its job.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "alreadyAppealed" };
    }
    console.error(`[payments] appeal failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }

  return { ok: true };
}

/**
 * Support decides. Upholding waives the floor and RECOMPUTES the split.
 *
 * Recomputed rather than adjusted by hand: the fee, the earning and the basis
 * have to stay consistent with each other and with the amount charged, and a
 * payout report that does not reconcile is a payout report nobody trusts. The
 * rate that was frozen at settlement is reused, so a rate change since then
 * never rewrites what somebody was already told they had earned.
 *
 * Phase 12 gives this a screen. It exists now because the appeal it resolves
 * exists now, and an appeal nobody can answer is worse than no appeal.
 */
export async function resolveCommissionAppeal(input: {
  appealId: string;
  adminId: string;
  uphold: boolean;
  note?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const supabase = createAdminClient();
  const { data: appeal } = await supabase
    .from("commission_appeals")
    .select("id, booking_id, status")
    .eq("id", input.appealId)
    .maybeSingle();

  if (!appeal) return { ok: false, reason: "notFound" };
  if (appeal.status !== "open") return { ok: false, reason: "alreadyResolved" };

  const { data: admin } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", input.adminId)
    .maybeSingle();
  if ((admin?.role as string | null) !== "admin") {
    return { ok: false, reason: "notAdmin" };
  }

  await supabase
    .from("commission_appeals")
    .update({
      status: input.uphold ? "upheld" : "rejected",
      resolved_by: input.adminId,
      resolved_at: new Date().toISOString(),
      resolution_note: input.note?.trim().slice(0, 600) ?? null,
    })
    .eq("id", appeal.id);

  await recordSecurityEvent({
    kind: "commission.appealResolved",
    actorId: input.adminId,
    actorRole: "admin",
    subjectType: "booking",
    subjectId: appeal.booking_id as string,
    detail: { appealId: appeal.id, upheld: input.uphold },
  });

  if (!input.uphold) return { ok: true };

  const booking = await readBooking(appeal.booking_id as string);
  if (!booking || booking.final_amount === null) return { ok: true };

  const { data: frozen } = await supabase
    .from("bookings")
    .select("commission_bps")
    .eq("id", booking.id)
    .maybeSingle();

  const split = settleSplit({
    amount: booking.final_amount,
    quotedMin: booking.quoted_min,
    commissionBps: (frozen?.commission_bps as number | null) ?? COMMISSION_BPS,
    floorWaived: true,
  });

  await supabase
    .from("bookings")
    .update({
      commission_floor_waived: true,
      platform_fee: split.platformFee,
      provider_earning: split.providerEarning,
      commission_basis: split.basis,
    })
    .eq("id", booking.id);

  return { ok: true };
}

/**
 * Per-category pricing signals, read under the service role deliberately.
 *
 * The view aggregates `bookings`, and a view runs with the caller's own
 * policies — so a customer reading it would see their own two rows and get a
 * meaningless average. This is support's number, and it is meaningless unless
 * it is everybody's.
 */
export async function listPricingSignals(): Promise<PricingSignal[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { data, error } = await createAdminClient()
      .from("category_pricing_signals")
      .select("*");

    if (error || !data) {
      if (error) {
        console.error(`[pricing] signals failed — ${describeError(error)}`);
      }
      return [];
    }

    return (data as Array<Record<string, unknown>>)
      .map((row) => ({
        categorySlug: row.category_slug as string,
        settledJobs: Number(row.settled_jobs ?? 0),
        belowFloorJobs: Number(row.below_floor_jobs ?? 0),
        belowFloorPct: Number(row.below_floor_pct ?? 0),
        aboveBandJobs: Number(row.above_band_jobs ?? 0),
        quotedMin: Number(row.quoted_min ?? 0),
        quotedMax: Number(row.quoted_max ?? 0),
        medianFinal: Number(row.median_final ?? 0),
        p25Final: Number(row.p25_final ?? 0),
        p75Final: Number(row.p75_final ?? 0),
      }))
      .sort((a, b) => b.belowFloorPct - a.belowFloorPct);
  } catch (thrown) {
    console.error(`[pricing] signals threw — ${describeError(thrown)}`);
    return [];
  }
}


/**
 * Cash versus digital, by category, ward and month.
 *
 * The baseline the customer-side payment incentive will be measured against —
 * see `lib/data/payment-mix.ts` for why it has to exist before that money is
 * spent. Service role for the same reason as the pricing signals: a view runs
 * with the caller's own policies, so anybody else reading it would get an
 * average of their own two rows.
 */
export async function listPaymentMix(): Promise<PaymentMixRow[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { data, error } = await createAdminClient()
      .from("payment_mix_signals")
      .select("*");

    if (error || !data) {
      if (error) {
        console.error(`[payments] mix failed — ${describeError(error)}`);
      }
      return [];
    }

    return (data as Array<Record<string, unknown>>).map((row) => ({
      categorySlug: row.category_slug as string,
      areaKey: row.area_key as string,
      month: String(row.month ?? ""),
      settledJobs: Number(row.settled_jobs ?? 0),
      cashJobs: Number(row.cash_jobs ?? 0),
      cashPct: Number(row.cash_pct ?? 0),
      gross: Number(row.gross ?? 0),
      cashGross: Number(row.cash_gross ?? 0),
    }));
  } catch (thrown) {
    console.error(`[payments] mix threw — ${describeError(thrown)}`);
    return [];
  }
}
