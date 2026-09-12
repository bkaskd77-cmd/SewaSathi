import "server-only";

import { isClaimStatus, type ClaimStatus } from "@/lib/booking";
import {
  claimIsAllowed,
  claimOutcome,
  guaranteeFor,
  type ClaimEligibility,
  type ClaimVerdict,
} from "@/lib/config/guarantee";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Guarantee claims: raising one, withdrawing it, and recording what the person
 * who went round actually found.
 *
 * WRITES GO THROUGH THE SERVICE ROLE AND RE-READ THE SUBJECT, the same rule
 * `lib/data/payments.ts` follows and for the same reason: the eligibility
 * question is `claimIsAllowed`, which needs the booking's status, its
 * settlement, its category's window and a count of prior claims. No RLS policy
 * can express that without embedding `lib/config/guarantee.ts` in SQL, so
 * `guarantee_claims` grants nobody an insert or an update and this file is the
 * only way in.
 *
 * The database still refuses the things that have no legitimate exception —
 * a claim on somebody else's booking, on an unfinished job, a third claim, a
 * resolution nobody attended, a refund nobody signed. Those triggers have no
 * service-role bypass, so this file cannot get them wrong either.
 *
 * WHAT IS NOT HERE YET. `visit_booking_id` exists and nothing writes it: the
 * return visit is currently the claim itself rather than a second row in
 * `bookings`. The column is there because that is where it goes when the visit
 * needs its own tracking, slot and payment — not as a claim that it already
 * does.
 */

export type ClaimRow = {
  id: string;
  bookingId: string;
  bookingReference: string;
  status: ClaimStatus;
  description: string;
  categorySlug: string;
  providerId: string | null;
  attendingProviderId: string | null;
  attendingName: string | null;
  verdict: ClaimVerdict | null;
  verdictNote: string | null;
  payer: "provider" | "customer" | null;
  refundRupees: number;
  openedAt: string;
  closedAt: string | null;
};

export type ClaimWriteResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: string };

function toStatus(value: unknown): ClaimStatus {
  return typeof value === "string" && isClaimStatus(value) ? value : "open";
}

function toRow(raw: Record<string, unknown>, reference = ""): ClaimRow {
  return {
    id: raw.id as string,
    bookingId: raw.booking_id as string,
    bookingReference: reference,
    status: toStatus(raw.status),
    description: (raw.description as string) ?? "",
    categorySlug: (raw.category_slug as string) ?? "",
    providerId: (raw.provider_id as string | null) ?? null,
    attendingProviderId: (raw.attending_provider_id as string | null) ?? null,
    attendingName: null,
    verdict: (raw.verdict as ClaimVerdict | null) ?? null,
    verdictNote: (raw.verdict_note as string | null) ?? null,
    payer: (raw.payer as "provider" | "customer" | null) ?? null,
    refundRupees: Number(raw.refund_rupees ?? 0),
    openedAt: raw.opened_at as string,
    closedAt: (raw.closed_at as string | null) ?? null,
  };
}

/**
 * May this customer claim on this booking, and what does the promise say?
 *
 * Answered before the button is drawn, so the screen can say *why* not — "the
 * 30 days are up", "there is already one open" — rather than hiding a button
 * and leaving somebody to wonder whether the guarantee was real.
 */
export async function claimEligibility(input: {
  bookingId: string;
  actorId: string;
}): Promise<ClaimEligibility> {
  if (!hasSupabaseConfig()) {
    return { allowed: false, reason: "notCompleted" };
  }

  try {
    const admin = createAdminClient();

    const { data: booking } = await admin
      .from("bookings")
      .select(
        "id, customer_id, category_slug, status, payment_status, final_amount, completed_at",
      )
      .eq("id", input.bookingId)
      .maybeSingle();

    // Not theirs is indistinguishable from not there, on purpose: a stranger
    // probing booking ids learns nothing either way.
    if (!booking || booking.customer_id !== input.actorId) {
      return { allowed: false, reason: "notCompleted" };
    }

    const { data: claims } = await admin
      .from("guarantee_claims")
      .select("status")
      .eq("booking_id", input.bookingId);

    const rows = (claims ?? []) as { status: string }[];

    return claimIsAllowed({
      categorySlug: booking.category_slug as string,
      status: booking.status as string,
      // "Settled" is the recorded amount, not a gateway's opinion: for cash
      // the customer's own confirmation is what put a figure on the job, and
      // that figure is exactly what the guarantee is capped at.
      settled:
        booking.payment_status === "paid" || booking.final_amount != null,
      completedAt: (booking.completed_at as string | null) ?? null,
      openClaims: rows.filter((r) =>
        ["open", "dispatched", "attended"].includes(r.status),
      ).length,
      totalClaims: rows.filter((r) => r.status !== "withdrawn").length,
    });
  } catch (thrown) {
    console.error(`[claims] eligibility threw — ${describeError(thrown)}`);
    return { allowed: false, reason: "notCompleted" };
  }
}

/**
 * Raise one.
 *
 * The original professional is named on the claim and told immediately. THE
 * COMMON PATH IS THAT THEY GO BACK THEMSELVES — it costs the platform nothing
 * and costs them a morning, which is the whole reason the policy is shaped
 * around a re-do rather than a refund.
 */
export async function openClaim(input: {
  bookingId: string;
  actorId: string;
  description: string;
}): Promise<ClaimWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const description = input.description.trim();
  if (description.length < 4) return { ok: false, reason: "tooShort" };

  const eligibility = await claimEligibility({
    bookingId: input.bookingId,
    actorId: input.actorId,
  });
  if (!eligibility.allowed) return { ok: false, reason: eligibility.reason };

  try {
    const admin = createAdminClient();

    const { data: booking } = await admin
      .from("bookings")
      .select("id, customer_id, provider_id, category_slug, reference")
      .eq("id", input.bookingId)
      .maybeSingle();

    if (!booking || booking.customer_id !== input.actorId) {
      return { ok: false, reason: "notYours" };
    }

    const { data, error } = await admin
      .from("guarantee_claims")
      .insert({
        booking_id: input.bookingId,
        customer_id: input.actorId,
        provider_id: (booking.provider_id as string | null) ?? null,
        category_slug: booking.category_slug as string,
        description: description.slice(0, 1000),
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error(`[claims] open failed — ${describeError(error)}`);
      // The live-claim index is the race the eligibility read cannot settle.
      return {
        ok: false,
        reason: error?.code === "23505" ? "claimOpen" : "generic",
      };
    }

    await notifyProvider(booking.provider_id as string | null, {
      kind: "claim.opened",
      reference: booking.reference as string,
      bookingId: input.bookingId,
    });

    return { ok: true, claimId: data.id as string };
  } catch (thrown) {
    console.error(`[claims] open threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/**
 * The customer ends it themselves.
 *
 * One tap, no reason required, and it does NOT count against their two —
 * `countsAgainstLimit` and the eligibility trigger agree on that. Somebody who
 * raised a claim and then found the real cause has done us a favour.
 */
export async function withdrawClaim(input: {
  claimId: string;
  actorId: string;
  reason?: string;
}): Promise<ClaimWriteResult> {
  return moveClaim({
    claimId: input.claimId,
    to: "withdrawn",
    guard: (claim) => claim.customer_id === input.actorId,
    patch: { closed_reason: input.reason?.slice(0, 400) ?? null },
  });
}

/**
 * The professional takes the visit.
 *
 * Their own acceptance, not an assignment: somebody made to go back on a job
 * they believe they did correctly is the kind of instruction that loses
 * professionals, and the verdict they then record would be worth nothing.
 */
export async function acceptClaim(input: {
  claimId: string;
  providerId: string;
}): Promise<ClaimWriteResult> {
  return moveClaim({
    claimId: input.claimId,
    to: "dispatched",
    guard: (claim) =>
      claim.provider_id === input.providerId ||
      claim.attending_provider_id === input.providerId,
    patch: { attending_provider_id: input.providerId },
  });
}

/** They cannot go. Back to open, and the claim says so rather than stalling. */
export async function releaseClaim(input: {
  claimId: string;
  providerId: string;
}): Promise<ClaimWriteResult> {
  return moveClaim({
    claimId: input.claimId,
    to: "open",
    guard: (claim) => claim.attending_provider_id === input.providerId,
    patch: {},
  });
}

/**
 * What they found, standing in the room. The verdict decides who pays.
 *
 * Two moves in one call, because `attended` and `resolved` are one action from
 * the professional's side and the machine insists on the order: a claim
 * reaches `resolved` only through `attended`, which is what makes the visit the
 * verification rather than a formality.
 *
 * The ledger entry is written ONLY when somebody other than the original
 * professional went and the verdict was `sameFault`. Those are the two
 * conditions under which the platform actually paid for a redo; the common
 * case — the original professional going back themselves — costs them a
 * morning and owes nothing to anybody.
 */
export async function recordVerdict(input: {
  claimId: string;
  providerId: string;
  verdict: ClaimVerdict;
  note?: string;
}): Promise<ClaimWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  try {
    const admin = createAdminClient();

    const { data: claim } = await admin
      .from("guarantee_claims")
      .select(
        "id, status, booking_id, customer_id, provider_id, attending_provider_id",
      )
      .eq("id", input.claimId)
      .maybeSingle();

    if (!claim) return { ok: false, reason: "notFound" };
    if (claim.attending_provider_id !== input.providerId) {
      return { ok: false, reason: "notYours" };
    }
    if (claim.status !== "dispatched" && claim.status !== "attended") {
      return { ok: false, reason: "wrongStatus" };
    }

    if (claim.status === "dispatched") {
      const { error } = await admin
        .from("guarantee_claims")
        .update({
          status: "attended",
          verdict: input.verdict,
          verdict_note: input.note?.slice(0, 1000) ?? null,
        })
        .eq("id", input.claimId)
        .eq("status", "dispatched");

      if (error) {
        console.error(`[claims] attend failed — ${describeError(error)}`);
        return { ok: false, reason: "generic" };
      }
    }

    const outcome = claimOutcome(input.verdict);

    const { error: resolveError } = await admin
      .from("guarantee_claims")
      .update({
        status: "resolved",
        verdict: input.verdict,
        payer: outcome.payer,
      })
      .eq("id", input.claimId)
      .eq("status", "attended");

    if (resolveError) {
      console.error(`[claims] resolve failed — ${describeError(resolveError)}`);
      return { ok: false, reason: "generic" };
    }

    await recordRedoDebt({
      claimId: input.claimId,
      bookingId: claim.booking_id as string,
      originalProviderId: (claim.provider_id as string | null) ?? null,
      attendingProviderId: input.providerId,
      verdict: input.verdict,
    });

    await notify({
      recipientId: claim.customer_id as string,
      kind: "claim.resolved",
      params: { verdict: input.verdict },
      bookingId: claim.booking_id as string,
    });

    return { ok: true, claimId: input.claimId };
  } catch (thrown) {
    console.error(`[claims] verdict threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

/**
 * The one case where a claim moves money, written as a ledger entry.
 *
 * NETTED FORWARD, NEVER CHASED. The entry is a debt against future earnings
 * that `applyRedoRecovery` takes at most a quarter of any one payout to
 * settle. Nobody is rung up for cash; if they never work for us again it is
 * written off, and that write-off is the real, bounded cost of offering a
 * guarantee.
 *
 * The amount is the original job's own quoted floor. The second professional's
 * visit has no invoice of its own yet, and the floor is what a call-out in
 * that band is worth — deliberately the low end, because a debt somebody did
 * not agree to should never be the generous reading.
 */
async function recordRedoDebt(input: {
  claimId: string;
  bookingId: string;
  originalProviderId: string | null;
  attendingProviderId: string;
  verdict: ClaimVerdict;
}): Promise<void> {
  if (input.verdict !== "sameFault") return;
  if (!input.originalProviderId) return;
  if (input.originalProviderId === input.attendingProviderId) return;

  try {
    const admin = createAdminClient();

    const { data: booking } = await admin
      .from("bookings")
      .select("quoted_min, reference")
      .eq("id", input.bookingId)
      .maybeSingle();

    const amount = Number(booking?.quoted_min ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return;

    await admin.from("provider_ledger").insert({
      provider_id: input.originalProviderId,
      claim_id: input.claimId,
      booking_id: input.bookingId,
      kind: "redo_debt",
      amount_rupees: Math.round(amount),
      note: `Return visit on ${booking?.reference ?? "a job"} — same fault`,
    });

    await notify({
      recipientId: input.originalProviderId,
      kind: "claim.ledger",
      params: { amount: String(Math.round(amount)) },
      bookingId: input.bookingId,
    });
  } catch (thrown) {
    // The claim is resolved either way. A ledger write that fails is money we
    // do not recover, which is the cheap half of this policy going wrong —
    // never a reason to leave a customer's claim open.
    console.error(`[claims] ledger threw — ${describeError(thrown)}`);
  }
}

/** One guarded move, re-read and re-judged here rather than trusted. */
async function moveClaim(input: {
  claimId: string;
  to: ClaimStatus;
  guard: (claim: Record<string, unknown>) => boolean;
  patch: Record<string, unknown>;
}): Promise<ClaimWriteResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  try {
    const admin = createAdminClient();

    const { data: claim } = await admin
      .from("guarantee_claims")
      .select("id, status, customer_id, provider_id, attending_provider_id")
      .eq("id", input.claimId)
      .maybeSingle();

    if (!claim) return { ok: false, reason: "notFound" };
    if (!input.guard(claim as Record<string, unknown>)) {
      return { ok: false, reason: "notYours" };
    }

    const { error } = await admin
      .from("guarantee_claims")
      .update({ status: input.to, ...input.patch })
      .eq("id", input.claimId)
      // The status this move was judged against. Two taps a second apart:
      // the second updates nothing rather than replaying the first.
      .eq("status", toStatus(claim.status));

    if (error) {
      console.error(`[claims] move failed — ${describeError(error)}`);
      return { ok: false, reason: "generic" };
    }

    return { ok: true, claimId: input.claimId };
  } catch (thrown) {
    console.error(`[claims] move threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}

async function notifyProvider(
  providerId: string | null,
  input: { kind: "claim.opened"; reference: string; bookingId: string },
): Promise<void> {
  if (!providerId) return;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("providers")
      .select("profile_id")
      .eq("id", providerId)
      .maybeSingle();

    const profileId = (data?.profile_id as string | null) ?? null;
    if (!profileId) return;

    await notify({
      recipientId: profileId,
      kind: input.kind,
      params: { reference: input.reference },
      bookingId: input.bookingId,
    });
  } catch (thrown) {
    console.error(`[claims] notify threw — ${describeError(thrown)}`);
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

/** Claims on one booking, for the customer looking at it. Through RLS. */
export async function claimsForBooking(bookingId: string): Promise<ClaimRow[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const { data, error } = await createClient()
      .from("guarantee_claims")
      .select(
        "id, booking_id, status, description, category_slug, provider_id, attending_provider_id, verdict, verdict_note, payer, refund_rupees, opened_at, closed_at",
      )
      .eq("booking_id", bookingId)
      .order("opened_at", { ascending: false });

    if (error) {
      console.error(`[claims] booking read failed — ${describeError(error)}`);
      return [];
    }
    return ((data ?? []) as Record<string, unknown>[]).map((row) =>
      toRow(row),
    );
  } catch (thrown) {
    console.error(`[claims] booking read threw — ${describeError(thrown)}`);
    return [];
  }
}

/**
 * Claims that involve this professional, for their dashboard.
 *
 * Both halves: a claim against their work, and one they were sent to look at.
 * Hiding the first would mean a ledger entry arrives with no explanation, and
 * a deduction nobody can account for is worse than the deduction.
 */
export async function claimsForProvider(
  providerId: string,
): Promise<ClaimRow[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("guarantee_claims")
      .select(
        "id, booking_id, status, description, category_slug, provider_id, attending_provider_id, verdict, verdict_note, payer, refund_rupees, opened_at, closed_at",
      )
      .or(
        `provider_id.eq.${providerId},attending_provider_id.eq.${providerId}`,
      )
      .order("opened_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error(`[claims] provider read failed — ${describeError(error)}`);
      return [];
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return [];

    const { data: bookings } = await admin
      .from("bookings")
      .select("id, reference")
      .in("id", Array.from(new Set(rows.map((r) => r.booking_id as string))));

    const byId = new Map(
      ((bookings ?? []) as { id: string; reference: string }[]).map((b) => [
        b.id,
        b.reference,
      ]),
    );

    return rows.map((row) => toRow(row, byId.get(row.booking_id as string) ?? ""));
  } catch (thrown) {
    console.error(`[claims] provider read threw — ${describeError(thrown)}`);
    return [];
  }
}

/** The guarantee window for a category, for the sentence on the screen. */
export { guaranteeFor };
