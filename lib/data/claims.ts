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
import {
  QUEUE_CAP,
  unreadableQueue,
  type QueuePage,
} from "@/lib/data/queue";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
// Type-only, and through the module's public entry rather than into its
// internals — `no-restricted-imports` caught the first attempt at the latter.
// The runtime halves stay behind the dynamic imports the functions below
// already use, because the registry reaches node:crypto through eSewa.
import type { MaterialsRead } from "@/lib/payments";
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
  /**
   * Did the original job carry a parts figure at all?
   *
   * The attending professional is only asked whether the parts failed when
   * there were parts. Asking it on a job that was pure labour is a question
   * with no true answer, and a screen that asks one teaches people to pick
   * whichever box makes the form submit.
   */
  hadMaterials: boolean;
  /** Their answer, once given. Null until asked and answered. */
  partsFailed: boolean | null;
};

export type ClaimWriteResult =
  | { ok: true; claimId: string }
  | { ok: false; reason: string };

function toStatus(value: unknown): ClaimStatus {
  return typeof value === "string" && isClaimStatus(value) ? value : "open";
}

function toRow(
  raw: Record<string, unknown>,
  reference = "",
  hadMaterials = false,
): ClaimRow {
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
    hadMaterials,
    partsFailed: (raw.parts_failed as boolean | null) ?? null,
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
      params: { reference: booking.reference as string },
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
  /**
   * Did the parts themselves fail, rather than the workmanship?
   *
   * ASKED OF THIS PERSON BECAUSE THEY WERE THERE. A compressor that died and a
   * compressor fitted badly are different claims and only somebody standing in
   * the room can tell them apart; the adjudicator deciding the refund weeks
   * later cannot, which is why this is not a box on their screen.
   *
   * `undefined` when the job carried no parts figure and the question was
   * never put — it lands as null, and null deducts nothing. See
   * `materialsRead` in lib/payments/refund.ts for why an unanswered question
   * must not behave like a "no".
   */
  partsFailed?: boolean | null;
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
          parts_failed: input.partsFailed ?? null,
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
        /*
         * WRITTEN ON BOTH MOVES, because a claim can arrive here already
         * `attended` — the update above is skipped then, and the answer would
         * be lost on exactly the path where somebody answered it second.
         */
        parts_failed: input.partsFailed ?? null,
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

    await notifyProvider(input.originalProviderId, {
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

/**
 * Tell a professional something, addressed the one way that works.
 *
 * A PROVIDER ID IS NOT A PROFILE ID, and passing one where the other belongs
 * fails silently. `notifications.profile_id` references `profiles`, so an id
 * from `providers` is refused by the foreign key — and `notify` never throws
 * on purpose, because the event it reports has already happened. The result is
 * a message nobody is ever sent and no error anybody ever sees.
 *
 * `recordRedoDebt` and `issueRefund` both did exactly that with
 * `claim.ledger`: the one notification whose whole job is to stop a deduction
 * arriving with no explanation. Nothing had reached production — no ledger row
 * exists yet — but every future one would have been silent. So there is one
 * way to address a professional and this is it.
 */
async function notifyProvider(
  providerId: string | null,
  input: {
    kind: "claim.opened" | "claim.ledger";
    params: Record<string, string>;
    bookingId: string;
  },
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
      params: input.params,
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
 * THE IDS COME FROM `listBookings(customerId)`, which is what makes them the
 * reader's own. RLS is the floor: the admin policy on `guarantee_claims` is
 * permissive, so a list of ids gathered any other way would be answered in
 * full. See the note at the top of `lib/data/bookings.ts`.
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

/**
 * Claims on one booking, for the customer looking at it.
 *
 * THE CALLER PASSES A BOOKING ID ALREADY PROVEN TO BE THE ACTOR'S, and
 * `getBooking({ customerId })` is what proves it. RLS is the floor here, not
 * the filter: the admin policy on this table is permissive and carries no
 * owner clause, so "through RLS" alone would answer for everybody. See the
 * note at the top of `lib/data/bookings.ts`.
 */
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
        "id, booking_id, status, description, category_slug, provider_id, attending_provider_id, verdict, verdict_note, payer, refund_rupees, parts_failed, opened_at, closed_at",
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

    /*
     * The parts figure comes along for the ride on a read that was already
     * happening. It decides ONE thing on the screen — whether the attending
     * professional is asked if the parts failed — and asking that on a job
     * that was pure labour is a question with no true answer.
     */
    const { data: bookings } = await admin
      .from("bookings")
      .select("id, reference, materials_rupees")
      .in("id", Array.from(new Set(rows.map((r) => r.booking_id as string))));

    const byId = new Map(
      ((bookings ?? []) as Record<string, unknown>[]).map((b) => [
        b.id as string,
        b,
      ]),
    );

    return rows.map((row) => {
      const booking = byId.get(row.booking_id as string);
      return toRow(
        row,
        (booking?.reference as string | undefined) ?? "",
        // Zero is a figure somebody entered and still means no parts, so the
        // question is worth asking only above it. Null never reaches here as
        // anything but false.
        Number(booking?.materials_rupees ?? 0) > 0,
      );
    });
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
      .select("id, booking_id, provider_id, status, refund_rupees, parts_failed")
      .eq("id", input.claimId)
      .maybeSingle();
    if (!claim) return { ok: false, reason: "notFound" };

    const { data: booking } = await admin
      .from("bookings")
      .select(
        "id, reference, payment_status, final_amount, customer_reported_amount, amount_mismatch_at, amount_mismatch_resolved_at, materials_rupees, platform_fee, provider_earning",
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
        amountMismatchResolvedAt:
          (booking.amount_mismatch_resolved_at as string | null) ?? null,
        paymentStatus: booking.payment_status as string,
        /*
         * BOTH COLUMNS, OR THE RULE IS INERT HERE AND ENFORCED IN POSTGRES.
         *
         * `refundCeiling` deducts materials only when handed both, so a call
         * site that forgets one silently gets the old ceiling with every unit
         * test still green — which is exactly how the ceiling and the trigger
         * came apart the first time. `enforce_claim_refund` reads the same two
         * columns, so a miss here surfaces as a save that fails rather than as
         * money leaving; that is the safe direction, and still a bug.
         */
        materialsRupees: (booking.materials_rupees as number | null) ?? null,
        partsFailed: (claim.parts_failed as boolean | null) ?? null,
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

    if (claim.provider_id && funding.providerOwes > 0) {
      await notifyProvider(claim.provider_id as string, {
        kind: "claim.ledger",
        params: { amount: String(funding.providerOwes) },
        bookingId: booking.id as string,
      });
    }

    /*
     * AND THE CUSTOMER IS TOLD IT WAS AGREED — never that it was sent. Two of
     * three rails cannot move money from here, so `claim.refundSent` is a
     * second, later event with somebody's name and a reference on it.
     */
    await notifyCustomer(booking.id as string, {
      kind: "claim.refundApproved",
      params: { amount: String(verdict.amount) },
    });

    return { ok: true, refundId: refund.id as string, verdict: verdict.outcome };
  } catch (thrown) {
    console.error(`[claims] refund threw — ${describeError(thrown)}`);
    return { ok: false, reason: "saveFailed" };
  }
}

/* ------------------------------------------------------------------ *
 * Approved is not sent
 * ------------------------------------------------------------------ */

/**
 * A refund that has been agreed and is waiting to actually go.
 *
 * WHY THIS IS A ROW SOMEBODY LOOKS AT RATHER THAN A FLAG NOBODY DOES. Two of
 * our three rails cannot move money from inside this product: eSewa has no
 * merchant-initiated refund on ePay v2, and cash comes back the way it went
 * out. So for most refunds the approval is one person saying yes and a second
 * person still has to go and send it — and if nothing on any screen says so,
 * "approved" is where the money stops. An unpaid approved refund is the worst
 * thing this product can leave quiet: the customer has been told yes, and from
 * their side a refund that never arrives is indistinguishable from one that
 * was refused without being said.
 */
export type PendingRefund = {
  refundId: string;
  paymentId: string;
  bookingId: string;
  bookingReference: string;
  claimId: string | null;
  amount: number;
  reason: string;
  method: "cash" | "esewa" | "khalti";
  /** Theirs, from the original payment. Needed to refund through a gateway. */
  providerTxnId: string | null;
  requestedAt: string;
  /** Past `REFUND_PAYMENT_DAYS`. Sorted to the top and said out loud. */
  stale: boolean;
  /** Whether this product can move it, and why not when it cannot. */
  automatic: boolean;
  railReason: string | null;
};

/** A resolved claim on which a person could still decide money back. */
export type RefundableClaim = {
  claimId: string;
  bookingId: string;
  bookingReference: string;
  categorySlug: string;
  description: string;
  verdictNote: string | null;
  providerName: string | null;
  completedAt: string | null;
  /** The most this booking could ever pay back, or why it can pay nothing. */
  ceiling: number | null;
  blocked: string | null;
  /**
   * What the job settled at, before any parts came off.
   *
   * Carried BESIDE the ceiling rather than instead of it, because a reviewer
   * deciding a refund needs to see the subtraction and not only its answer —
   * "Rs 4,000" alone on a Rs 6,000 job is a number with no story, and the
   * story is the whole reason the figure is not 6,000.
   */
  settled: number | null;
  /** The parts line and what it did, or null when nobody recorded one. */
  materials: MaterialsRead | null;
  /** Days left in the trade's window. Negative is past it. */
  daysLeft: number | null;
};

/**
 * Two queues on one screen, each capped and counted on its own.
 *
 * They are different work — one is money we owe and have not sent, the other
 * is a verdict nobody has turned into a refund yet — so a single count across
 * both would answer neither question.
 */
export type RefundQueue = {
  awaitingPayment: QueuePage<PendingRefund>;
  decidable: QueuePage<RefundableClaim>;
};

export const REFUND_QUEUE_CAP = QUEUE_CAP;

/**
 * Lower than its sibling on purpose. A decidable claim is a verdict already
 * reached and waiting to be turned into money, so the queue is fed by the
 * no-show and guarantee screens rather than by traffic, and it should never
 * approach even this.
 */
export const REFUND_DECIDABLE_CAP = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Everything a person has to act on about guarantee money, in one read.
 *
 * THE UNPAID ONES COME FIRST AND THAT IS THE WHOLE ORDERING. A queue that put
 * the interesting decisions at the top and the owed money underneath would be
 * optimised for the reviewer rather than for the customer waiting on it.
 *
 * ADMIN ONLY, through the service role, because it crosses every customer.
 * The caller proves the role; this function is not reachable from a page that
 * has not.
 */
export async function refundQueue(): Promise<RefundQueue> {
  const empty: RefundQueue = {
    awaitingPayment: unreadableQueue(REFUND_QUEUE_CAP),
    decidable: unreadableQueue(REFUND_DECIDABLE_CAP),
  };
  if (!hasSupabaseConfig()) return empty;

  try {
    const admin = createAdminClient();
    const { isRefundStale, refundCeiling, refundRail } = await import(
      "@/lib/payments/refund"
    );
    const { gatewayFor } = await import("@/lib/payments");

    const [
      { data: refundRows, count: refundTotal },
      { data: claimRows, count: claimTotal },
    ] = await Promise.all([
      admin
        .from("refunds")
        .select("id, payment_id, amount, reason, created_at", {
          count: "exact",
        })
        .eq("status", "requested")
        .order("created_at", { ascending: true })
        .limit(REFUND_QUEUE_CAP),
      admin
        .from("guarantee_claims")
        .select(
          "id, booking_id, category_slug, description, verdict_note, provider_id, attending_provider_id, refund_rupees, parts_failed, closed_at",
          { count: "exact" },
        )
        .eq("status", "resolved")
        .eq("verdict", "sameFault")
        .eq("refund_rupees", 0)
        .order("closed_at", { ascending: false })
        .limit(REFUND_DECIDABLE_CAP),
    ]);

    const refunds = (refundRows ?? []) as Record<string, unknown>[];
    const claims = (claimRows ?? []) as Record<string, unknown>[];

    /*
     * The bookings behind both halves, in one read each. `refunds` points at a
     * payment and the payment points at the booking, so the refund half needs
     * the payments first — there is no column that would let it skip a hop,
     * and inventing one would be a second place that knows which booking a
     * refund belongs to.
     */
    const { data: paymentRows } = refunds.length
      ? await admin
          .from("payments")
          .select("id, booking_id, method, provider_txn_id")
          .in("id", refunds.map((r) => r.payment_id as string))
      : { data: [] as Record<string, unknown>[] };

    const payments = new Map(
      ((paymentRows ?? []) as Record<string, unknown>[]).map((p) => [
        p.id as string,
        p,
      ]),
    );

    const bookingIds = Array.from(
      new Set([
        ...((paymentRows ?? []) as Record<string, unknown>[]).map(
          (p) => p.booking_id as string,
        ),
        ...claims.map((c) => c.booking_id as string),
      ]),
    );

    const { data: bookingRows } = bookingIds.length
      ? await admin
          .from("bookings")
          .select(
            "id, reference, payment_status, final_amount, customer_reported_amount, amount_mismatch_at, amount_mismatch_resolved_at, materials_rupees, completed_at",
          )
          .in("id", bookingIds)
      : { data: [] as Record<string, unknown>[] };

    const bookings = new Map(
      ((bookingRows ?? []) as Record<string, unknown>[]).map((b) => [
        b.id as string,
        b,
      ]),
    );

    // Which claim, if any, each refunded booking belongs to — so the screen
    // can show what it was for rather than an amount with no story.
    const { data: claimByBooking } = bookingIds.length
      ? await admin
          .from("guarantee_claims")
          .select("id, booking_id")
          .in("booking_id", bookingIds)
          .gt("refund_rupees", 0)
      : { data: [] as Record<string, unknown>[] };

    const claimFor = new Map(
      ((claimByBooking ?? []) as Record<string, unknown>[]).map((c) => [
        c.booking_id as string,
        c.id as string,
      ]),
    );

    const awaitingPayment: PendingRefund[] = [];
    for (const row of refunds) {
      const payment = payments.get(row.payment_id as string);
      if (!payment) continue;
      const booking = bookings.get(payment.booking_id as string);
      const method = payment.method as "cash" | "esewa" | "khalti";
      /*
       * `isConfigured()` is part of the rail, not a detail. With no Khalti
       * secret the refund call returns `notConfigured`, and a screen that had
       * already promised "we will send this automatically" would be promising
       * on a setting nobody checked.
       */
      const rail = refundRail({
        method,
        configured: gatewayFor(method).isConfigured(),
      });
      awaitingPayment.push({
        refundId: row.id as string,
        paymentId: payment.id as string,
        bookingId: payment.booking_id as string,
        bookingReference: (booking?.reference as string | undefined) ?? "",
        claimId: claimFor.get(payment.booking_id as string) ?? null,
        amount: Number(row.amount ?? 0),
        reason: (row.reason as string) ?? "",
        method,
        providerTxnId: (payment.provider_txn_id as string | null) ?? null,
        requestedAt: row.created_at as string,
        stale: isRefundStale({ requestedAt: row.created_at as string }),
        automatic: rail.automatic,
        railReason: rail.reason,
      });
    }

    // Stale first, then oldest first. Both orderings say the same thing — the
    // one that has been waiting longest is the one to deal with.
    awaitingPayment.sort((a, b) =>
      a.stale === b.stale
        ? a.requestedAt.localeCompare(b.requestedAt)
        : a.stale
          ? -1
          : 1,
    );

    const names = await providerNames(
      claims
        .map((c) => (c.provider_id ?? c.attending_provider_id) as string | null)
        .filter((id): id is string => Boolean(id)),
    );

    const now = Date.now();
    const decidable: RefundableClaim[] = claims.map((claim) => {
      const booking = bookings.get(claim.booking_id as string);
      const ceiling = refundCeiling({
        finalAmount: (booking?.final_amount as number | null) ?? null,
        customerReportedAmount:
          (booking?.customer_reported_amount as number | null) ?? null,
        amountMismatchAt: (booking?.amount_mismatch_at as string | null) ?? null,
        amountMismatchResolvedAt:
          (booking?.amount_mismatch_resolved_at as string | null) ?? null,
        paymentStatus: (booking?.payment_status as string) ?? "unpaid",
        materialsRupees: (booking?.materials_rupees as number | null) ?? null,
        partsFailed: (claim.parts_failed as boolean | null) ?? null,
      });

      const completedAt = (booking?.completed_at as string | null) ?? null;
      const window = guaranteeFor(claim.category_slug as string);
      const daysLeft = completedAt
        ? Math.floor(
            (Date.parse(completedAt) + window.days * DAY_MS - now) / DAY_MS,
          )
        : null;

      const providerId = (claim.provider_id ??
        claim.attending_provider_id) as string | null;

      return {
        claimId: claim.id as string,
        bookingId: claim.booking_id as string,
        bookingReference: (booking?.reference as string | undefined) ?? "",
        categorySlug: claim.category_slug as string,
        description: (claim.description as string) ?? "",
        verdictNote: (claim.verdict_note as string | null) ?? null,
        providerName: providerId ? (names.get(providerId) ?? null) : null,
        completedAt,
        ceiling: ceiling.ok ? ceiling.ceiling : null,
        blocked: ceiling.ok ? null : ceiling.reason,
        settled: ceiling.ok ? ceiling.settled : null,
        materials: ceiling.ok ? ceiling.materials : null,
        daysLeft,
      };
    });

    return {
      awaitingPayment: {
        rows: awaitingPayment,
        total: refundTotal ?? null,
        cap: REFUND_QUEUE_CAP,
      },
      decidable: {
        rows: decidable,
        total: claimTotal ?? null,
        cap: REFUND_DECIDABLE_CAP,
      },
    };
  } catch (thrown) {
    console.error(`[claims] refund queue threw — ${describeError(thrown)}`);
    return empty;
  }
}

/**
 * The two counts behind the guarantee screen, without fetching any rows.
 *
 * Reported separately rather than summed: the index card names both, because
 * "three refunds to send" and "three verdicts to turn into refunds" are not
 * interchangeable and a single number would hide which kind of work is
 * waiting.
 */
export async function refundQueueCounts(): Promise<{
  awaitingPayment: number | null;
  decidable: number | null;
}> {
  if (!hasSupabaseConfig()) return { awaitingPayment: null, decidable: null };

  try {
    const admin = createAdminClient();
    const [owed, verdicts] = await Promise.all([
      admin
        .from("refunds")
        .select("id", { count: "exact", head: true })
        .eq("status", "requested"),
      admin
        .from("guarantee_claims")
        .select("id", { count: "exact", head: true })
        .eq("status", "resolved")
        .eq("verdict", "sameFault")
        .eq("refund_rupees", 0),
    ]);

    if (owed.error) {
      console.error(`[claims] refund count — ${describeError(owed.error)}`);
    }
    if (verdicts.error) {
      console.error(`[claims] verdict count — ${describeError(verdicts.error)}`);
    }

    return {
      awaitingPayment: owed.error ? null : (owed.count ?? null),
      decidable: verdicts.error ? null : (verdicts.count ?? null),
    };
  } catch (thrown) {
    console.error(`[claims] refund counts threw — ${describeError(thrown)}`);
    return { awaitingPayment: null, decidable: null };
  }
}

/** Display names for a set of professionals. Service role; admin surface only. */
async function providerNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) return names;
  const { data } = await createAdminClient()
    .from("providers")
    .select("id, display_name")
    .in("id", unique);
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    names.set(row.id as string, row.display_name as string);
  }
  return names;
}

/**
 * Tell the customer of a booking something. Addressed from the booking row,
 * for the same reason `notifyProvider` exists: the id has to come from the
 * table that holds profile ids, not from whichever one was to hand.
 */
async function notifyCustomer(
  bookingId: string,
  input: {
    kind: "claim.refundApproved" | "claim.refundSent";
    params: Record<string, string>;
  },
): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("bookings")
      .select("customer_id")
      .eq("id", bookingId)
      .maybeSingle();

    const customerId = (data?.customer_id as string | null) ?? null;
    if (!customerId) return;

    await notify({
      recipientId: customerId,
      kind: input.kind,
      params: input.params,
      bookingId,
    });
  } catch (thrown) {
    console.error(`[claims] customer notify threw — ${describeError(thrown)}`);
  }
}

export type RefundPaidResult =
  | { ok: true; refundId: string }
  | { ok: false; reason: string };

/**
 * The second step: somebody has actually sent the money.
 *
 * WHAT MAKES THIS A SEPARATE ACT AND NOT A FLAG ON THE FIRST. eSewa has no
 * merchant-initiated refund on ePay v2 and cash comes back the way it went
 * out, so on two of our three rails a person leaves this product, moves the
 * money, and comes back. The only honest record of that is one they make
 * afterwards, carrying the reference it went under and the date it went. A
 * single "refunded" written at approval would be this product asserting
 * something it cannot know.
 *
 * A REFERENCE IS REQUIRED AND IT IS THE POINT. It is the one thing that lets a
 * customer saying "I never got it" be answered rather than argued with, and
 * the one thing that tells a second reviewer this has already been sent. A
 * completion with nothing to look up is a completion nobody can check.
 *
 * GUARDED ON `requested`, so two reviewers a minute apart do not both record a
 * payment. `refunds_processed_shape` refuses a completed row with no
 * timestamp, so the shape cannot be got wrong either.
 */
export async function markRefundPaid(input: {
  refundId: string;
  reference: string;
  /** When it actually went, which is not necessarily now. ISO date or instant. */
  paidAt: string;
  actorId: string;
}): Promise<RefundPaidResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const reference = input.reference.trim();
  if (reference.length < 3) return { ok: false, reason: "referenceRequired" };

  const paidAt = new Date(input.paidAt);
  if (Number.isNaN(paidAt.getTime())) {
    return { ok: false, reason: "badDate" };
  }
  /*
   * A DATE IN THE FUTURE IS A TYPO, NOT A PLAN. Money that has not moved yet
   * is a refund still at `requested`; recording it as sent tomorrow would take
   * it off this queue today, which is the one thing the queue exists to stop.
   * An hour of slack absorbs a clock that is a little ahead.
   */
  if (paidAt.getTime() > Date.now() + 60 * 60 * 1000) {
    return { ok: false, reason: "futureDate" };
  }

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

    const { data: refund } = await admin
      .from("refunds")
      .select("id, payment_id, amount, status")
      .eq("id", input.refundId)
      .maybeSingle();
    if (!refund) return { ok: false, reason: "notFound" };
    if ((refund.status as string) !== "requested") {
      return { ok: false, reason: "alreadyPaid" };
    }

    const { data: updated, error } = await admin
      .from("refunds")
      .update({
        status: "completed",
        processed_at: paidAt.toISOString(),
        provider_txn_id: reference.slice(0, 200),
      })
      .eq("id", input.refundId)
      // The status it was judged against. The second reviewer updates nothing.
      .eq("status", "requested")
      .select("id")
      .maybeSingle();

    if (error || !updated) {
      if (error) console.error(`[claims] refund pay failed — ${describeError(error)}`);
      return { ok: false, reason: error ? "saveFailed" : "alreadyPaid" };
    }

    const { data: payment } = await admin
      .from("payments")
      .select("booking_id")
      .eq("id", refund.payment_id as string)
      .maybeSingle();

    if (payment?.booking_id) {
      await notifyCustomer(payment.booking_id as string, {
        kind: "claim.refundSent",
        params: { amount: String(refund.amount ?? 0), reference },
      });
    }

    return { ok: true, refundId: input.refundId };
  } catch (thrown) {
    console.error(`[claims] refund pay threw — ${describeError(thrown)}`);
    return { ok: false, reason: "saveFailed" };
  }
}

/**
 * Send an approved refund through the gateway that took the money.
 *
 * ONLY WHERE THE RAIL CAN CARRY IT. Khalti has a real refund endpoint; eSewa
 * does not on ePay v2 and cash never will. `refundRail` decides, and this
 * refuses rather than pretending — the manual path is not a fallback for a
 * failed call, it is what those rails are.
 *
 * A GATEWAY THAT DOES NOT ANSWER IS NOT A REFUND THAT FAILED. The same rule
 * `verifyAndSettle` follows and for a sharper reason here: the money may
 * already have left our account. So the row stays at `requested`, nothing is
 * recorded as sent, and the screen says to check the gateway before sending
 * again. Recording a failure would be the mirror of recording a success
 * nobody verified.
 */
export async function sendRefundToGateway(input: {
  refundId: string;
  actorId: string;
}): Promise<RefundPaidResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

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

    const { data: refund } = await admin
      .from("refunds")
      .select("id, payment_id, amount, reason, status")
      .eq("id", input.refundId)
      .maybeSingle();
    if (!refund) return { ok: false, reason: "notFound" };
    if ((refund.status as string) !== "requested") {
      return { ok: false, reason: "alreadyPaid" };
    }

    const { data: payment } = await admin
      .from("payments")
      .select("id, booking_id, method, our_reference, provider_txn_id")
      .eq("id", refund.payment_id as string)
      .maybeSingle();
    if (!payment) return { ok: false, reason: "notFound" };

    const method = payment.method as "cash" | "esewa" | "khalti";
    const { gatewayFor } = await import("@/lib/payments");
    const { refundRail } = await import("@/lib/payments/refund");

    const gateway = gatewayFor(method);
    const rail = refundRail({ method, configured: gateway.isConfigured() });
    if (!rail.automatic) return { ok: false, reason: rail.reason ?? "manualOnly" };

    const providerTxnId = (payment.provider_txn_id as string | null) ?? null;
    // Their id for the original payment is what a refund is raised against.
    // Without it there is nothing to refund, and guessing is not an option.
    if (!providerTxnId) return { ok: false, reason: "noGatewayReference" };

    const sent = await gateway.refund({
      reference: payment.our_reference as string,
      providerTxnId,
      amount: Number(refund.amount ?? 0),
      reason: (refund.reason as string) ?? "Guarantee refund",
    });

    if (!sent.ok) {
      console.error(`[claims] gateway refund said no — ${sent.reason}`);
      return { ok: false, reason: "gatewaySaidNo" };
    }

    return markRefundPaid({
      refundId: input.refundId,
      reference: sent.providerTxnId,
      paidAt: new Date().toISOString(),
      actorId: input.actorId,
    });
  } catch (thrown) {
    console.error(`[claims] gateway refund threw — ${describeError(thrown)}`);
    return { ok: false, reason: "noAnswer" };
  }
}

/**
 * The refunds on one booking, for the customer looking at it.
 *
 * THE STATUS, NOT THE AMOUNT. `guarantee_claims.refund_rupees` says what was
 * agreed and nothing about whether it has moved; a panel reading only that
 * would tell somebody their money was refunded while it sat in a queue. So the
 * booking page reads the refund row and says which of the two is true.
 *
 * "Customers read refunds on their payments" is the policy, and it is the
 * floor rather than the filter — the admin policies on `payments` and
 * `refunds` are permissive and carry no owner clause.
 *
 * THE CALLER PASSES A BOOKING ID ALREADY PROVEN TO BE THE ACTOR'S, and
 * `getBooking({ customerId })` is what proves it. RLS is the floor here, not
 * the filter: the admin policy on this table is permissive and carries no
 * owner clause, so "through RLS" alone would answer for everybody. See the
 * note at the top of `lib/data/bookings.ts`.
 */
export type CustomerRefund = {
  id: string;
  amount: number;
  /** `requested` is agreed and on its way. `completed` has actually gone. */
  status: string;
  sentAt: string | null;
};

export async function refundsForBooking(
  bookingId: string,
): Promise<CustomerRefund[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const supabase = createClient();

    const { data: payments } = await supabase
      .from("payments")
      .select("id")
      .eq("booking_id", bookingId);

    const ids = ((payments ?? []) as { id: string }[]).map((p) => p.id);
    if (ids.length === 0) return [];

    const { data, error } = await supabase
      .from("refunds")
      .select("id, amount, status, processed_at, created_at")
      .in("payment_id", ids)
      .order("created_at", { ascending: false });

    if (error) {
      console.error(`[claims] refund read failed — ${describeError(error)}`);
      return [];
    }

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      amount: Number(row.amount ?? 0),
      status: (row.status as string) ?? "requested",
      sentAt: (row.processed_at as string | null) ?? null,
    }));
  } catch (thrown) {
    console.error(`[claims] refund read threw — ${describeError(thrown)}`);
    return [];
  }
}

/**
 * Which of these bookings has a refund agreed but not yet sent.
 *
 * ONE QUERY FOR THE WHOLE LIST, the same rule as `liveClaimsByBooking` and for
 * the same reason: `/bookings` ships no client JavaScript on purpose, and a
 * read per row would undo that on exactly the connection the page exists to
 * serve. The ids come from `listBookings(customerId)`, which is what makes
 * them the reader's own — RLS is the floor, and the admin policies on
 * `payments` and `refunds` carry no owner clause.
 *
 * WHAT IT IS FOR. A booking with money owed on it is not history. Without this
 * the card dropped into "Earlier", quiet and small, while the customer waited
 * for a refund we had already agreed to pay them.
 */
export async function unpaidRefundsByBooking(
  bookingIds: string[],
): Promise<Set<string>> {
  const owed = new Set<string>();
  if (!hasSupabaseConfig() || bookingIds.length === 0) return owed;

  try {
    const supabase = createClient();

    const { data: payments } = await supabase
      .from("payments")
      .select("id, booking_id")
      .in("booking_id", bookingIds);

    const bookingOf = new Map(
      ((payments ?? []) as { id: string; booking_id: string }[]).map((p) => [
        p.id,
        p.booking_id,
      ]),
    );
    if (bookingOf.size === 0) return owed;

    const { data, error } = await supabase
      .from("refunds")
      .select("payment_id, status")
      .in("payment_id", Array.from(bookingOf.keys()))
      .eq("status", "requested");

    if (error) {
      console.error(`[claims] owed read failed — ${describeError(error)}`);
      return owed;
    }

    for (const row of (data ?? []) as { payment_id: string }[]) {
      const bookingId = bookingOf.get(row.payment_id);
      if (bookingId) owed.add(bookingId);
    }
    return owed;
  } catch (thrown) {
    console.error(`[claims] owed read threw — ${describeError(thrown)}`);
    return owed;
  }
}
