import "server-only";

import {
  CLAIM_FIRST_REFUSAL_MINUTES,
  claimOpenToAll,
  isClaimStatus,
  type ClaimStatus,
} from "@/lib/booking";
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
 * THE RETURN VISIT IS A REAL BOOKING NOW. `visit_booking_id` went unwritten
 * from the day this table was created until `createGuaranteeVisit` below — the
 * visit WAS the claim row, so a redo took no capacity seat, recorded no
 * arrival, and could not be charged for when the fault turned out to be
 * somebody else's. It is created at ACCEPTANCE, because the claim machine
 * already decides who goes and a second dispatcher would be the
 * duplicate-definition problem this project has paid for three times.
 *
 * Two things follow that are easy to get wrong and are handled here:
 * `enforce_claim_transition` clears the link on a release, so the booking it
 * pointed at must be cancelled or it holds a capacity seat nobody can reach;
 * and the same trigger refuses a claim being repointed at a DIFFERENT visit,
 * which the unique column alone did not stop.
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
  /*
   * The trades are re-read here rather than taken as a parameter. An eligibility
   * list that arrives from the caller is an eligibility list the caller can
   * assert — the same shape as the three `actorId` holes, all of which were an
   * id arriving from outside with nothing asking whose it was.
   */
  const trades = await tradesFor(input.providerId);

  const moved = await moveClaim({
    claimId: input.claimId,
    to: "dispatched",
    /*
     * THE THIRD CLAUSE IS THE FIX. Before it, only the original professional
     * or the one already attending could accept — so when the original handed
     * it back, the claim went to `open` and nobody alive was permitted to take
     * it. `/legal/refunds` promises a visit without conditions, and the code
     * quietly did not keep that promise.
     *
     * `claimOpenToAll` is the same clock-driven rule the policy in SQL applies,
     * so a screen and the database cannot disagree about whether a claim is
     * still being held for its first refusal.
     */
    guard: (claim) => {
      if (claim.provider_id === input.providerId) return true;
      if (claim.attending_provider_id === input.providerId) return true;

      const openToAll = claimOpenToAll({
        status: toStatus(claim.status),
        attendingProviderId:
          (claim.attending_provider_id as string | null) ?? null,
        openedAt: claim.opened_at as string,
        releasedAt: (claim.released_at as string | null) ?? null,
      });

      return (
        openToAll &&
        trades.includes(claim.category_slug as string)
      );
    },
    patch: { attending_provider_id: input.providerId },
  });

  if (!moved.ok) return moved;

  /*
   * NOW THE VISIT EXISTS AS A JOB. After the claim move rather than before,
   * because the move is what proves this professional is allowed to go — a
   * booking created first and then refused by the guard would be an orphan
   * holding one of their capacity seats.
   *
   * A failure here does NOT roll the acceptance back. The professional has
   * said they are going and the customer has been told; losing that over a
   * booking insert would be the worse outcome by a long way. It is logged,
   * and `visit_booking_id` staying null is the signal that this claim needs
   * looking at.
   */
  await createGuaranteeVisit({
    claimId: input.claimId,
    providerId: input.providerId,
  });

  return moved;
}

/* ------------------------------------------------------------------ *
 * The return visit
 * ------------------------------------------------------------------ */

/** The reference alphabet the booking table uses. Unambiguous on a phone. */
const VISIT_REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function visitReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += VISIT_REFERENCE_ALPHABET[bytes[i] % VISIT_REFERENCE_ALPHABET.length];
  }
  return `SK-${out}`;
}

/**
 * The visit the guarantee actually promises, as a real booking.
 *
 * `visit_booking_id` has existed since the claim table was written and nothing
 * ever wrote it — the return visit WAS the claim row. So a redo took no seat
 * from `enforce_slot_capacity`, counted against no `crew_count`, appeared in no
 * `providerCapacity`, recorded no arrival, and could not be charged for when
 * the fault turned out to be somebody else's. This is where it starts existing.
 *
 * CREATED AT ACCEPTANCE, NOT AT FILING, and that is a deliberate choice about
 * who dispatches. The claim machine already decides who goes — `openClaim`
 * tells the original professional, `openClaimsForTrade` offers it to the rest
 * of the trade once `claimOpenToAll` says the first refusal has lapsed, and
 * `acceptClaim` settles it. A booking created at filing would go into the
 * ordinary dispatch sweep as well, and two dispatchers for one visit is the
 * duplicate-definition problem that has cost this project three rebuilds.
 *
 * IT CARRIES THE PARENT'S FROZEN BAND AND IS NOT BILLABLE. Not priced at zero:
 * `quoted_min > 0` forbids that and a zero band would make the professional's
 * time worth nothing to capacity, duration and the commission floor alike. The
 * price is real and it is the CAP — a callback can never cost more than the job
 * that prompted it — while `billable` says nobody is charged unless the visit
 * finds a different problem and the customer agrees to it BEFORE work starts.
 *
 * IDEMPOTENT. `guarantee_claims.visit_booking_id` is unique, and two
 * professionals tapping accept a second apart is a normal event: the second
 * finds a visit already there and returns it rather than orphaning a booking.
 */
async function createGuaranteeVisit(input: {
  claimId: string;
  providerId: string;
}): Promise<string | null> {
  try {
    const admin = createAdminClient();

    const { data: claim } = await admin
      .from("guarantee_claims")
      .select("id, booking_id, customer_id, category_slug, description, visit_booking_id")
      .eq("id", input.claimId)
      .maybeSingle();

    if (!claim) return null;
    // Already has one. The claim, not this function, is the source of truth.
    if (claim.visit_booking_id) return claim.visit_booking_id as string;

    const { data: parent } = await admin
      .from("bookings")
      .select(
        "id, customer_id, address_id, category_slug, urgency, payment_method, quote_model, quoted_min, quoted_max, band_min, band_slug, reference",
      )
      .eq("id", claim.booking_id as string)
      .maybeSingle();

    if (!parent) return null;

    const { data: visit, error } = await admin
      .from("bookings")
      .insert({
        reference: visitReference(),
        customer_id: parent.customer_id as string,
        // Set at insert, which is legal: a customer picking a professional
        // creates exactly this shape. `enforce_booking_immutability` only
        // refuses a REASSIGNMENT, and there is none here.
        provider_id: input.providerId,
        // A booking must start pending — `enforce_booking_transition` says so
        // on INSERT, and going through the machine rather than around it is
        // the whole reason the machine is trustworthy.
        status: "pending",
        address_id: parent.address_id as string,
        category_slug: parent.category_slug as string,
        description: claim.description as string,
        /*
         * The parent's urgency, copied rather than decided here. A tap that
         * was fixed and leaks again is at least as urgent as it was the first
         * time, and inventing a different answer would be this file having an
         * opinion about somebody's household that the original booking already
         * settled.
         */
        urgency: parent.urgency as string,
        payment_method: parent.payment_method as string,
        /*
         * The band and the model travel together, because
         * `bookings_band_only_null_for_survey` ties them: a movers callback
         * has no band for the same reason the original had none, and copying
         * one without the other would be refused outright.
         */
        quote_model: parent.quote_model as string,
        quoted_min: parent.quoted_min as number | null,
        quoted_max: parent.quoted_max as number | null,
        band_min: parent.band_min as number | null,
        band_slug: parent.band_slug as string | null,
        guarantee_claim_id: claim.id as string,
        // The one place in the product that writes this false, and the check
        // constraint refuses it on anything that is not a guarantee visit.
        billable: false,
      })
      .select("id")
      .single();

    if (error || !visit) {
      console.error(`[claims] visit insert failed — ${describeError(error)}`);
      return null;
    }

    const visitId = visit.id as string;

    /*
     * Guarded on the column still being null, so the loser of a race updates
     * nothing rather than overwriting the winner's visit — the same shape
     * every other write in this file uses to settle a double tap.
     */
    const { error: linkError } = await admin
      .from("guarantee_claims")
      .update({ visit_booking_id: visitId })
      .eq("id", input.claimId)
      .is("visit_booking_id", null);

    if (linkError) {
      console.error(`[claims] visit link failed — ${describeError(linkError)}`);
      return null;
    }

    /*
     * The professional has already said they are going — that is what
     * accepting the claim meant — so the visit follows them to `accepted`
     * rather than sitting pending and waiting to be accepted a second time.
     * Through the status machine, which stamps `accepted_at`.
     */
    await admin
      .from("bookings")
      .update({ status: "accepted" })
      .eq("id", visitId)
      .eq("status", "pending");

    return visitId;
  } catch (thrown) {
    console.error(`[claims] visit threw — ${describeError(thrown)}`);
    return null;
  }
}

/** They cannot go. Back to open, and the claim says so rather than stalling. */
export async function releaseClaim(input: {
  claimId: string;
  providerId: string;
}): Promise<ClaimWriteResult> {
  /*
   * Read BEFORE the move. `enforce_claim_transition` clears the link on the
   * way to `open`, so afterwards there is nothing left to say which booking
   * needs cancelling — the orphan would be unreachable by the code that
   * created it.
   */
  const visitId = await visitBookingFor(input.claimId);

  const released = await moveClaim({
    claimId: input.claimId,
    to: "open",
    guard: (claim) => claim.attending_provider_id === input.providerId,
    /*
     * CLEARING THE ATTENDING ID IS THE RELEASE. `patch: {}` left the claim
     * pointing at the person who had just said they could not go, which is how
     * "back to open" managed to be open to nobody. `released_at` opens it to
     * the trade at once — a hand-back is an answer, not silence, so there is no
     * first-refusal window left to serve.
     */
    patch: { attending_provider_id: null, released_at: new Date().toISOString() },
  });

  if (released.ok) await cancelOrphanedVisit(visitId);
  return released;
}

/** The visit on a claim, read before a move that would clear it. */
async function visitBookingFor(claimId: string): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data } = await createAdminClient()
      .from("guarantee_claims")
      .select("visit_booking_id")
      .eq("id", claimId)
      .maybeSingle();
    return (data?.visit_booking_id as string | null) ?? null;
  } catch {
    return null;
  }
}

/**
 * The visit the released claim left behind.
 *
 * `enforce_claim_transition` nulls `visit_booking_id` on the way back to
 * `open`, which is right — the next professional gets a new visit. But the old
 * booking is still `accepted` and still holds one of the first professional's
 * capacity seats, on a claim that no longer points at it. Nobody can reach it
 * and nothing will ever close it.
 *
 * SO IT IS CANCELLED, IN TYPESCRIPT RATHER THAN IN THE TRIGGER. A trigger on
 * `guarantee_claims` writing `bookings` re-enters that table's own triggers,
 * which is the recursion `is_admin()` exists to break and has caught this
 * project twice. The same shape `declineJob` uses: prove it with a read, write
 * under the service role.
 *
 * NEVER THROWS. The release has already happened and the customer has been
 * told; losing that because a tidy-up failed would be the worse outcome by a
 * long way.
 */
async function cancelOrphanedVisit(visitId: string | null): Promise<void> {
  if (!visitId) return;
  try {
    await createAdminClient()
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        // `system`, not `support`: nobody decided this. The release is the
        // decision and this is the tidy-up that follows it. The column's
        // check constraint allows customer/provider/admin/system and
        // refused "support" outright, which is the constraint doing its job.
        cancelled_by_role: "system",
      })
      .eq("id", visitId)
      // Only a visit that has not started. If work began the booking is a
      // record of something that happened and cancelling it would be a lie.
      .in("status", ["pending", "accepted", "en_route"]);
  } catch (thrown) {
    console.error(`[claims] orphan visit threw — ${describeError(thrown)}`);
  }
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

/** Which categories this listing actually covers. */
async function tradesFor(providerId: string): Promise<string[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const { data } = await createAdminClient()
      .from("provider_categories")
      .select("category_slug")
      .eq("provider_id", providerId);

    return ((data ?? []) as { category_slug: string }[]).map(
      (row) => row.category_slug,
    );
  } catch (thrown) {
    // An unreadable trade list is not permission. Failing closed here costs
    // somebody one tap; failing open sends a plumber to an electrical claim.
    console.error(`[claims] trades threw — ${describeError(thrown)}`);
    return [];
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
      .select(
        "id, status, customer_id, provider_id, attending_provider_id, category_slug, opened_at, released_at",
      )
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

/**
 * Which of these bookings has a claim in flight.
 *
 * ONE QUERY FOR THE WHOLE LIST. `/bookings` is the screen somebody opens to
 * find out whether anything is happening, and it ships no client JavaScript
 * precisely so it is correct on a connection that never finishes loading a
 * bundle — a read per row would undo that on the slowest connection it exists
 * to serve.
 *
 * THE STATUS, NOT A BOOLEAN. "We are arranging a visit" and "Somebody is
 * coming to look" are different facts to somebody waiting, and collapsing them
 * into "claim open" would be the list answering a question nobody asked.
 *
 * Through RLS, so this is the customer's own claims and nobody else's.
 */
export async function liveClaimsByBooking(
  bookingIds: string[],
): Promise<Map<string, ClaimStatus>> {
  const live = new Map<string, ClaimStatus>();
  if (!hasSupabaseConfig() || bookingIds.length === 0) return live;

  try {
    const { data, error } = await createClient()
      .from("guarantee_claims")
      .select("booking_id, status, opened_at")
      .in("booking_id", bookingIds)
      .in("status", ["open", "dispatched", "attended"])
      .order("opened_at", { ascending: false });

    if (error) {
      console.error(`[claims] live read failed — ${describeError(error)}`);
      return live;
    }

    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const id = row.booking_id as string;
      // Newest first, and the database refuses a second live claim on one
      // booking anyway — so the first seen is the only one there is.
      if (!live.has(id)) live.set(id, row.status as ClaimStatus);
    }
    return live;
  } catch (thrown) {
    console.error(`[claims] live read threw — ${describeError(thrown)}`);
    return live;
  }
}

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
/**
 * Claims nobody is holding that this professional could take.
 *
 * THE OTHER HALF OF THE PROMISE. `/legal/refunds` says a visit happens; making
 * one possible in `acceptClaim` is not the same as anybody knowing it is there.
 * Without this read the reassignment path exists and is never walked, which
 * from the customer's side is indistinguishable from the bug it replaced.
 *
 * The window is `claimOpenToAll`'s, applied in SQL so the list and the accept
 * cannot disagree: the original professional holds it alone for twenty minutes,
 * or until they hand it back.
 */
export async function openClaimsForTrade(input: {
  providerId: string;
  /** Excluded, since they are the one who could not go. */
  excludeProviderId?: string | null;
}): Promise<ClaimRow[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const admin = createAdminClient();
    const trades = await tradesFor(input.providerId);
    if (trades.length === 0) return [];

    const cutoff = new Date(
      Date.now() - CLAIM_FIRST_REFUSAL_MINUTES * 60_000,
    ).toISOString();

    const { data, error } = await admin
      .from("guarantee_claims")
      .select(
        "id, booking_id, status, description, category_slug, provider_id, attending_provider_id, verdict, verdict_note, payer, refund_rupees, opened_at, closed_at",
      )
      .eq("status", "open")
      .is("attending_provider_id", null)
      .in("category_slug", trades)
      .or(`released_at.not.is.null,opened_at.lte.${cutoff}`)
      .order("opened_at", { ascending: true })
      .limit(20);

    if (error) {
      console.error(`[claims] open read failed — ${describeError(error)}`);
      return [];
    }

    const rows = ((data ?? []) as Record<string, unknown>[]).filter(
      // Their own work coming back is already on their dashboard as a claim
      // against them; it does not belong in the open list twice.
      (row) => row.provider_id !== input.providerId,
    );
    if (rows.length === 0) return [];

    const { data: bookings } = await admin
      .from("bookings")
      .select("id, reference")
      .in("id", Array.from(new Set(rows.map((r) => r.booking_id as string))));

    const references = new Map(
      ((bookings ?? []) as { id: string; reference: string }[]).map((b) => [
        b.id,
        b.reference,
      ]),
    );

    return rows.map((row) =>
      toRow(row, references.get(row.booking_id as string) ?? ""),
    );
  } catch (thrown) {
    console.error(`[claims] open read threw — ${describeError(thrown)}`);
    return [];
  }
}

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

/* ------------------------------------------------------------------ *
 * The last rung: money back
 * ------------------------------------------------------------------ */

export type RefundResult =
  | { ok: true; refundId: string; verdict: "partial-labour" | "full-labour" }
  | { ok: false; reason: string };

/**
 * Pay a customer back, partially or in full, on a claim a re-do could not fix.
 *
 * WHY THIS IS THE LAST RUNG. The guarantee is a re-do: we send somebody back
 * and the labour belongs to the professional whose defect it was, so it costs
 * the platform almost nothing and can be generous. A refund costs real money,
 * which is why nothing reaches this function automatically — no verdict, and
 * no combination of verdicts, produces one. A person decides every single one,
 * and `enforce_claim_transition` refuses a refund with nobody's name on it.
 *
 * LABOUR ONLY. Consequential damage is excluded in plain words on a page
 * anybody can read; a guarantee that paid for the leak's water would be
 * unbounded liability on a 15% commission.
 *
 * WHO FUNDS IT. The customer receives the whole amount. The platform returns
 * its commission on that job in proportion — we do not keep a fee out of work
 * that failed. The professional's share becomes a debt netted forward against
 * future earnings by `applyRedoRecovery`, never chased backward: there is no
 * card on file, no direct debit and no wage to garnish, and backward recovery
 * selects against the honest ones.
 *
 * THE DEBT IS AN ORDINARY `redo_debt` AND NOT A NEW LEDGER KIND.
 * `provider_outstanding` sums `redo_debt` positive and every other kind
 * NEGATIVE, so a `commission_returned` row would have quietly reduced what
 * somebody owed — wrong, and in the direction that costs us money.
 *
 * THE FOUR REFUSALS ARE THE DATABASE'S. `enforce_claim_refund` has no
 * service-role bypass: no double payout, nothing above what was collected,
 * nothing on an unsettled or disputed booking, nothing past the window. This
 * function judges the same things first so the caller gets a sentence instead
 * of an exception — the guards are what make it true.
 */
export async function issueRefund(input: {
  claimId: string;
  amount: number;
  actorId: string;
  note: string;
}): Promise<RefundResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const note = input.note.trim();
  if (!note) return { ok: false, reason: "reasonRequired" };

  try {
    const admin = createAdminClient();

    // The actor's role is re-read here as well as in the action, because a
    // server action is a public POST endpoint and this one moves money.
    const { data: actor } = await admin
      .from("profiles")
      .select("role")
      .eq("id", input.actorId)
      .maybeSingle();
    if ((actor?.role as string | null) !== "admin") {
      return { ok: false, reason: "notAdmin" };
    }

    const { data: claim } = await admin
      .from("guarantee_claims")
      .select("id, booking_id, provider_id, status, refund_rupees")
      .eq("id", input.claimId)
      .maybeSingle();
    if (!claim) return { ok: false, reason: "notFound" };

    const { data: booking } = await admin
      .from("bookings")
      .select(
        "id, reference, payment_status, final_amount, customer_reported_amount, amount_mismatch_at, platform_fee, provider_earning",
      )
      .eq("id", claim.booking_id as string)
      .maybeSingle();
    if (!booking) return { ok: false, reason: "notFound" };

    const { judgeRefund, refundFunding } = await import("@/lib/payments/refund");
    const verdict = judgeRefund({
      amount: input.amount,
      subject: {
        finalAmount: (booking.final_amount as number | null) ?? null,
        customerReportedAmount:
          (booking.customer_reported_amount as number | null) ?? null,
        amountMismatchAt: (booking.amount_mismatch_at as string | null) ?? null,
        paymentStatus: booking.payment_status as string,
      },
      alreadyRefunded: Number(claim.refund_rupees ?? 0),
    });

    if (verdict.outcome !== "partial-labour" && verdict.outcome !== "full-labour") {
      return { ok: false, reason: verdict.outcome };
    }

    /*
     * The payment this refund comes out of. `refunds.payment_id` is not null
     * and cash settles through a payments row like everything else, so there
     * is always one on a settled booking — but a missing one is reported
     * rather than assumed, because the alternative is an exception on the
     * money path.
     */
    const { data: payment } = await admin
      .from("payments")
      .select("id, status")
      .eq("booking_id", booking.id as string)
      .eq("status", "paid")
      .maybeSingle();
    if (!payment) return { ok: false, reason: "noPayment" };

    const funding = refundFunding({
      refund: verdict.amount,
      platformFee: Number(booking.platform_fee ?? 0),
      providerEarning: Number(booking.provider_earning ?? 0),
    });

    /*
     * THE CLAIM FIRST, because it carries every guard. If any of the four
     * refusals fires, nothing else has been written — a refunds row beside a
     * claim that refused it would be money owed with no record of the
     * decision.
     */
    const { error: claimError } = await admin
      .from("guarantee_claims")
      .update({
        refund_rupees: verdict.amount,
        refund_decided_by: input.actorId,
      })
      .eq("id", input.claimId)
      // Guarded, so two reviewers a second apart produce one refund.
      .eq("refund_rupees", 0);

    if (claimError) {
      const message = describeError(claimError);
      for (const [pattern, reason] of [
        [/already been refunded/i, "alreadyRefunded"],
        [/more than the amount recorded/i, "aboveCeiling"],
        [/has not been settled/i, "notSettled"],
        [/still in dispute/i, "amountDisputed"],
        [/window has closed/i, "outsideWindow"],
      ] as const) {
        if (pattern.test(message)) return { ok: false, reason };
      }
      console.error(`[claims] refund failed — ${message}`);
      return { ok: false, reason: "saveFailed" };
    }

    const { data: refund, error: refundError } = await admin
      .from("refunds")
      .insert({
        payment_id: payment.id as string,
        amount: verdict.amount,
        reason: note.slice(0, 500),
        requested_by: input.actorId,
        requested_by_role: "admin",
      })
      .select("id")
      .single();

    if (refundError || !refund) {
      console.error(`[claims] refund row failed — ${describeError(refundError)}`);
      return { ok: false, reason: "saveFailed" };
    }

    /*
     * The professional's share, netted forward. Never their whole payout: the
     * platform's returned commission comes off first, so somebody is only
     * ever charged for the part they were actually paid.
     */
    if (claim.provider_id && funding.providerOwes > 0) {
      await admin.from("provider_ledger").insert({
        provider_id: claim.provider_id as string,
        claim_id: input.claimId,
        booking_id: booking.id as string,
        kind: "redo_debt",
        amount_rupees: funding.providerOwes,
        note: `Refund on ${booking.reference as string} — netted off future earnings`,
      });
    }

    /*
     * `partially_refunded` or `refunded`, so the payment's own machine records
     * what happened to it rather than the claim being the only place that
     * knows.
     */
    await admin
      .from("payments")
      .update({
        status:
          verdict.outcome === "full-labour" ? "refunded" : "partially_refunded",
      })
      .eq("id", payment.id as string)
      .eq("status", "paid");

    if (claim.provider_id) {
      await notify({
        recipientId: claim.provider_id as string,
        kind: "claim.ledger",
        params: { amount: String(funding.providerOwes) },
        bookingId: booking.id as string,
      });
    }

    return { ok: true, refundId: refund.id as string, verdict: verdict.outcome };
  } catch (thrown) {
    console.error(`[claims] refund threw — ${describeError(thrown)}`);
    return { ok: false, reason: "saveFailed" };
  }
}
