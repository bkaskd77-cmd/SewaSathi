import "server-only";

import {
  TRIP_COMPENSATION,
  addressTrust,
  applyTripRecovery,
  confirmationPlan,
  judgeCustomerLadder,
  judgeNoShowClaim,
  tripDebtFor,
  CUSTOMER_LADDER,
  type AddressTrust,
  type ArrivalEvidence,
  type CustomerHistory,
  type NoShowVerdict,
} from "@/lib/abuse";
import { recordSecurityEvent } from "@/lib/audit";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The customer's side of the fraud problem, and the professional who was
 * paying for it.
 *
 * SERVICE ROLE, and the usual rule: nothing here trusts an id from a browser.
 * These rows mark people and move money, so none of the four tables has an
 * insert or update policy for anybody at all.
 *
 * THE ORDER OF OPERATIONS IS THE DESIGN. The professional is paid the moment a
 * claim is upheld; whether we ever recover it is decided afterwards and
 * separately. A trip payment conditional on recovery would be no payment at
 * all — it would move the uncertainty onto the person least able to absorb it.
 */

/* ------------------------------------------------------------------ *
 * The customer's record
 * ------------------------------------------------------------------ */

export async function customerHistory(
  profileId: string,
): Promise<CustomerHistory & { tripDebt: number; banned: boolean }> {
  const empty = {
    noShows: 0,
    falseAddresses: 0,
    completedJobs: 0,
    tripDebt: 0,
    banned: false,
  };
  if (!hasSupabaseConfig()) return empty;

  const db = createAdminClient();
  const { data } = await db
    .from("customer_risk")
    .select("*")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!data) return empty;
  return {
    noShows: data.no_shows as number,
    falseAddresses: data.false_addresses as number,
    completedJobs: data.completed_jobs as number,
    tripDebt: data.trip_debt_rupees as number,
    banned: data.banned_at !== null,
  };
}

/*
 * WHAT USED TO BE HERE, AND WHY IT IS NOT.
 *
 * `recordCustomerKeys` hashed a customer's name and ward into
 * `customer_match_keys`, and `bannedAccountMatches` looked for a banned account
 * wearing a new SIM by comparing those hashes. Neither ever had a caller, so not one
 * key was ever written and the matcher had nothing to match — a dead path that read,
 * across three comments, like a control.
 *
 * DELETED RATHER THAN WIRED, which is a decision about collecting identity data and
 * not a tidy-up. The keys are weak by construction: thousands of people in Kathmandu
 * share a first name and a ward, so a hit was never evidence of anything, and the
 * design said so itself — a reason to ask for confirmation, never a reason to refuse
 * somebody a plumber. **We now ask for that confirmation anyway**, from any address
 * nobody has proved, which is `armConfirmation` below and is wired. So the matcher's
 * entire output would have been an input to a gate that is already closed, and the
 * table was personal data held for nothing.
 *
 * Collecting now and deciding later is the wrong order for personal data. The honest
 * version of "later": if ban evasion turns out to be real, this comes back with a
 * measurement behind it and a stronger key than a first name. The table is dropped
 * in `20261002000006`.
 *
 * `matchKeysFor` and `MatchKeyKind` survive in `lib/verification` — the provider side
 * matches on document numbers, which are strong keys that applicants give us
 * deliberately.
 */

/* ------------------------------------------------------------------ *
 * Address trust and the confirmation gate
 * ------------------------------------------------------------------ */

export async function trustForAddress(input: {
  addressId: string;
  confirmedForThisBooking: boolean;
}): Promise<AddressTrust> {
  if (!hasSupabaseConfig()) {
    return input.confirmedForThisBooking ? "confirmed" : "unproven";
  }
  const db = createAdminClient();

  const [{ data: address }, { count }] = await Promise.all([
    db
      .from("addresses")
      .select("upheld_no_shows")
      .eq("id", input.addressId)
      .maybeSingle(),
    /*
     * Completed jobs are DERIVED, not counted into a column. That number
     * changes constantly and a stale copy of it would quietly stop protecting
     * anybody — the failure mode where the code looks right and does nothing.
     */
    db
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("address_id", input.addressId)
      .eq("status", "completed"),
  ]);

  return addressTrust({
    completedJobs: count ?? 0,
    upheldNoShows: (address?.upheld_no_shows as number | undefined) ?? 0,
    confirmedForThisBooking: input.confirmedForThisBooking,
  });
}

/**
 * Decide, at creation, whether this trip needs an answer before anybody rides.
 *
 * NOTHING CALLS THIS, SO THE GUARD IS INERT. `bookings.confirmation_required`
 * exists and its trigger works — a customer genuinely cannot clear the flag
 * from a browser, and the db suite proves it — but nothing ever SETS the flag,
 * so the trigger has never had anything to protect. The comment said "written
 * by the server onto the booking", which described the half that was built
 * while reading as though the whole were.
 *
 * The trigger half is worth keeping whatever is decided here: RLS is
 * row-level, so the update policy that lets a customer cancel their own
 * booking would otherwise let them clear this flag.
 */
export async function armConfirmation(input: {
  bookingId: string;
  addressId: string;
  isEmergency: boolean;
  now?: Date;
}): Promise<{ required: boolean; holdUntil: string | null }> {
  const trust = await trustForAddress({
    addressId: input.addressId,
    confirmedForThisBooking: false,
  });
  const plan = confirmationPlan({ trust, isEmergency: input.isEmergency });

  if (!plan.required) return { required: false, holdUntil: null };

  const now = input.now ?? new Date();
  const holdUntil = new Date(
    now.getTime() + plan.holdMinutes * 60_000,
  ).toISOString();

  if (hasSupabaseConfig()) {
    const db = createAdminClient();
    await db
      .from("bookings")
      .update({
        confirmation_required: true,
        confirmation_hold_until: holdUntil,
      })
      .eq("id", input.bookingId);
  }

  return { required: true, holdUntil };
}

/**
 * The customer answers.
 *
 * ONE TAP, and it is the whole anti-fraud mechanism: instant for somebody
 * holding the phone they just booked on, impossible for a script that fired
 * twenty bookings and walked away. The address is marked as confirmed for the
 * first time too, so a real customer is never asked twice for the same door.
 */
export async function confirmTrip(input: {
  bookingId: string;
  actorId: string;
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const db = createAdminClient();

  const { data: booking } = await db
    .from("bookings")
    .select("id, customer_id, address_id, confirmed_at")
    .eq("id", input.bookingId)
    .maybeSingle();

  if (!booking || booking.customer_id !== input.actorId) return false;
  if (booking.confirmed_at) return true;

  const now = new Date().toISOString();
  await db
    .from("bookings")
    .update({ confirmed_at: now })
    .eq("id", input.bookingId);

  await db
    .from("addresses")
    .update({ first_confirmed_at: now })
    .eq("id", booking.address_id as string)
    .is("first_confirmed_at", null);

  return true;
}

/* ------------------------------------------------------------------ *
 * Arrival, and the claim
 * ------------------------------------------------------------------ */

/** Round to about a kilometre. See the migration's note on why. */
function coarsen(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function recordArrival(input: {
  bookingId: string;
  providerProfileId: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const db = createAdminClient();

  const { data: provider } = await db
    .from("providers")
    .select("id")
    .eq("profile_id", input.providerProfileId)
    .maybeSingle();
  if (!provider) return false;

  const { data: booking } = await db
    .from("bookings")
    .select("id, provider_id, status")
    .eq("id", input.bookingId)
    .maybeSingle();

  // Theirs, and actually under way. Re-read rather than trusted.
  if (!booking || booking.provider_id !== provider.id) return false;
  if (!["en_route", "accepted"].includes(booking.status as string)) return false;

  const { error } = await db.from("booking_arrivals").upsert(
    {
      booking_id: input.bookingId,
      provider_id: provider.id as string,
      arrived_at: new Date().toISOString(),
      coarse_lat: typeof input.lat === "number" ? coarsen(input.lat) : null,
      coarse_lng: typeof input.lng === "number" ? coarsen(input.lng) : null,
    },
    { onConflict: "booking_id" },
  );

  return !error;
}

/**
 * The professional gives up and claims a wasted trip.
 *
 * The verdict is computed from evidence rather than asserted, and there is no
 * branch that refuses them outright — `open` and `needs_person` both mean a
 * human will look, and `upheld` pays immediately.
 */
export async function claimNoShow(input: {
  bookingId: string;
  providerProfileId: string;
  waitedMinutes: number;
  contactAttempts: number;
}): Promise<{ ok: boolean; verdict?: NoShowVerdict }> {
  if (!hasSupabaseConfig()) return { ok: false };
  const db = createAdminClient();

  const { data: provider } = await db
    .from("providers")
    .select("id")
    .eq("profile_id", input.providerProfileId)
    .maybeSingle();
  if (!provider) return { ok: false };

  const { data: booking } = await db
    .from("bookings")
    .select("id, provider_id, customer_id, address_id, confirmed_at")
    .eq("id", input.bookingId)
    .maybeSingle();
  if (!booking || booking.provider_id !== provider.id) return { ok: false };

  const { data: arrival } = await db
    .from("booking_arrivals")
    .select("*")
    .eq("booking_id", input.bookingId)
    .maybeSingle();

  const evidence: ArrivalEvidence = {
    arrivedAt: (arrival?.arrived_at as string | null) ?? null,
    waitedMinutes: input.waitedMinutes,
    contactAttempts: input.contactAttempts,
    coarseLocation:
      arrival?.coarse_lat != null && arrival?.coarse_lng != null
        ? {
            lat: Number(arrival.coarse_lat),
            lng: Number(arrival.coarse_lng),
          }
        : null,
  };

  const trust = await trustForAddress({
    addressId: booking.address_id as string,
    confirmedForThisBooking: booking.confirmed_at !== null,
  });

  const verdict = judgeNoShowClaim({
    evidence,
    customerConfirmed: booking.confirmed_at !== null,
    addressProven: trust === "proven",
    customerDisputed: false,
  });

  if (verdict.outcome === "incomplete") return { ok: false, verdict };

  await db
    .from("booking_arrivals")
    .update({
      gave_up_at: new Date().toISOString(),
      waited_minutes: input.waitedMinutes,
      contact_attempts: input.contactAttempts,
    })
    .eq("booking_id", input.bookingId);

  const { error } = await db.from("no_show_claims").upsert(
    {
      booking_id: input.bookingId,
      provider_id: provider.id as string,
      customer_id: booking.customer_id as string,
      status: verdict.outcome === "upheld" ? "open" : "needs_person",
    },
    { onConflict: "booking_id" },
  );
  if (error) {
    console.error(`[no-show] claim — ${describeError(error)}`);
    return { ok: false };
  }

  // An auto-upheld claim still goes through the same settle path, so there is
  // exactly one place that pays a professional and marks a customer.
  if (verdict.outcome === "upheld") {
    await settleNoShowClaim({
      bookingId: input.bookingId,
      decidedBy: null,
      uphold: true,
      reason: "Evidence complete and nothing suggested a real door.",
    });
  }

  return { ok: true, verdict };
}

/**
 * Pay the professional, mark the customer, and decide who carries it.
 *
 * ONE PLACE, whether the claim was upheld automatically or by a person. Two
 * paths that both pay money is two places for the arithmetic to drift.
 */
export async function settleNoShowClaim(input: {
  bookingId: string;
  decidedBy: string | null;
  uphold: boolean;
  reason: string;
  /**
   * How long the reviewer had the evidence open. Never a gate — see
   * `components/admin/use-seconds-on-evidence.ts`. Null for the automatic
   * path, where no person was looking at anything.
   */
  secondsOnEvidence?: number | null;
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;
  const db = createAdminClient();

  const { data: claim } = await db
    .from("no_show_claims")
    .select("*")
    .eq("booking_id", input.bookingId)
    .maybeSingle();
  if (!claim || ["upheld", "refused"].includes(claim.status as string)) {
    return false;
  }

  const now = new Date().toISOString();

  if (!input.uphold) {
    await db
      .from("no_show_claims")
      .update({
        status: "refused",
        decided_by: input.decidedBy,
        decided_at: now,
        decision_reason: input.reason,
        seconds_on_evidence: input.secondsOnEvidence ?? null,
      })
      .eq("booking_id", input.bookingId);
    return true;
  }

  const customerId = claim.customer_id as string;
  const history = await customerHistory(customerId);
  const before = judgeCustomerLadder(history);

  // Does this create a debt, or do we simply absorb it? The professional is
  // paid either way — this decides only who ends up carrying it.
  const debt = tripDebtFor({
    effectiveStrikesBefore: before.effectiveStrikes,
    depositStep: CUSTOMER_LADDER.depositAt,
  });

  await db
    .from("no_show_claims")
    .update({
      status: "upheld",
      trip_rupees_paid: TRIP_COMPENSATION.rupees,
      debt_rupees: debt,
      decided_by: input.decidedBy,
      decided_at: now,
      decision_reason: input.reason,
      seconds_on_evidence: input.secondsOnEvidence ?? null,
    })
    .eq("booking_id", input.bookingId);

  await db.from("customer_risk").upsert(
    {
      profile_id: customerId,
      no_shows: history.noShows + 1,
      false_addresses: history.falseAddresses,
      completed_jobs: history.completedJobs,
      trip_debt_rupees: history.tripDebt + debt,
      updated_at: now,
    },
    { onConflict: "profile_id" },
  );

  const { data: booking } = await db
    .from("bookings")
    .select("address_id")
    .eq("id", input.bookingId)
    .maybeSingle();

  if (booking) {
    // Takes "proven" away from this door. See lib/abuse/address-trust.ts.
    const { data: address } = await db
      .from("addresses")
      .select("upheld_no_shows")
      .eq("id", booking.address_id as string)
      .maybeSingle();

    await db
      .from("addresses")
      .update({
        upheld_no_shows: ((address?.upheld_no_shows as number) ?? 0) + 1,
      })
      .eq("id", booking.address_id as string);
  }

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: input.decidedBy ? "admin" : "system",
    actorId: input.decidedBy ?? undefined,
    subjectType: "profile",
    subjectId: customerId,
    detail: {
      action: "noShow.upheld",
      tripRupeesPaid: TRIP_COMPENSATION.rupees,
      debtRupees: debt,
      // The write-off, named, so the cost of protecting professionals is
      // visible in the log rather than only in a spreadsheet later.
      absorbedByUs: debt === 0,
      secondsOnEvidence: input.secondsOnEvidence ?? null,
    },
  });

  return true;
}

/**
 * What this customer's next bill actually is.
 *
 * NOTHING CALLS THIS, so a trip debt is recorded and never recovered — the
 * same shape as `applyRedoRecovery` sitting uncalled for four phases while
 * `/providers/standards` described the balance going down. The comment said
 * "called at settlement", which was the plan.
 *
 * The plan is still right and is the argument for wiring it: recovering at
 * settlement takes the debt out of work the customer chose to book rather than
 * demanding it from them. Returns the bill unchanged when nothing is owed,
 * which is almost always.
 */
export async function applyTripDebtToBill(input: {
  profileId: string;
  billRupees: number;
}): Promise<{ charged: number; recovered: number }> {
  const history = await customerHistory(input.profileId);
  if (history.tripDebt <= 0) {
    return { charged: input.billRupees, recovered: 0 };
  }

  const result = applyTripRecovery({
    billRupees: input.billRupees,
    outstanding: history.tripDebt,
  });

  if (hasSupabaseConfig() && result.recovered > 0) {
    const db = createAdminClient();
    await db
      .from("customer_risk")
      .update({
        trip_debt_rupees: result.remaining,
        updated_at: new Date().toISOString(),
      })
      .eq("profile_id", input.profileId);
  }

  return { charged: result.charged, recovered: result.recovered };
}
