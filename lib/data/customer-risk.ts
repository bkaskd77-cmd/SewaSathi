import "server-only";

import {
  TRIP_COMPENSATION,
  addressTrust,
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
import { notify } from "@/lib/notify";
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
): Promise<
  CustomerHistory & {
    tripDebt: number;
    banned: boolean;
    /**
     * Set while the customer says the trip debt is not theirs.
     *
     * NULL IS "NOT DISPUTED", and here that reading is safe where it usually is not:
     * the column is only ever written by somebody disputing, and a failed read
     * returns the empty object below — which holds no debt, so nothing is recovered
     * on a read that did not work. The unsafe arrangement would be the other way
     * round: a debt surviving a failed read while the dispute that holds it off did
     * not.
     */
    tripDebtDisputedAt: string | null;
    /** The customer's own words, kept for whoever decides. Null when not disputed. */
    tripDebtDisputeNote: string | null;
  }
> {
  const empty = {
    noShows: 0,
    falseAddresses: 0,
    completedJobs: 0,
    tripDebt: 0,
    banned: false,
    tripDebtDisputedAt: null,
    tripDebtDisputeNote: null,
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
    tripDebtDisputedAt: (data.trip_debt_disputed_at as string | null) ?? null,
    tripDebtDisputeNote: (data.trip_debt_dispute_note as string | null) ?? null,
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
  /** A photograph of the door, base64. Optional, and a failure never blocks. */
  photoBase64?: string | null;
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
    .select("id, provider_id, customer_id, reference, status")
    .eq("id", input.bookingId)
    .maybeSingle();

  // Theirs, and actually under way. Re-read rather than trusted.
  if (!booking || booking.provider_id !== provider.id) return false;
  if (!["en_route", "accepted"].includes(booking.status as string)) return false;

  const arrivedAt = new Date();

  /*
   * THE PHOTOGRAPH IS STORED BEFORE THE ROW, so the row never names an object that
   * is not there. The other order would leave `photo_path` pointing at nothing on a
   * storage failure, and a reviewer opening a claim would see a missing picture and
   * have no way to tell "they did not take one" from "we lost it".
   *
   * IT NEVER BLOCKS THE ARRIVAL. `storeArrivalPhoto` returns null on anything it does
   * not like — not a JPEG, too large, storage down — and the arrival is recorded
   * without it. Somebody is standing in a street; a claim with no photograph is an
   * ordinary claim and was the only kind until this phase.
   */
  let photo: { path: string; skewMinutes: number | null } | null = null;
  if (input.photoBase64) {
    const { storeArrivalPhoto } = await import("@/lib/data/arrival-photos");
    photo = await storeArrivalPhoto({
      base64: input.photoBase64,
      providerProfileId: input.providerProfileId,
      bookingId: input.bookingId,
      receivedAt: arrivedAt,
    });
  }

  const { error } = await db.from("booking_arrivals").upsert(
    {
      booking_id: input.bookingId,
      provider_id: provider.id as string,
      arrived_at: arrivedAt.toISOString(),
      coarse_lat: typeof input.lat === "number" ? coarsen(input.lat) : null,
      coarse_lng: typeof input.lng === "number" ? coarsen(input.lng) : null,
      /*
       * Only written when there is something to write. A retry that arrives without a
       * photograph must not blank the one the first attempt stored — the arrival panel
       * queues a failed call and drains it later, so a second pass is ordinary.
       */
      ...(photo ? { photo_path: photo.path, exif_skew_minutes: photo.skewMinutes } : {}),
    },
    { onConflict: "booking_id" },
  );
  if (error) {
    console.error(`[arrival] not recorded — ${describeError(error)}`);
    return false;
  }

  /*
   * AND THE CUSTOMER IS TOLD, which is the point of doing it here rather than at the
   * claim. `MIN_WAIT_MINUTES` has to pass before a wasted trip can be claimed, and
   * somebody inside with the tap running has no way of knowing anybody is at a locked
   * gate. This hands them that window. `notify` never throws — the arrival already
   * happened, and a dead gateway must not undo it.
   */
  await notify({
    recipientId: booking.customer_id as string,
    kind: "booking.providerArrived",
    params: { reference: booking.reference as string },
    bookingId: input.bookingId,
  });

  return true;
}

/**
 * One tap on the call or WhatsApp button, recorded.
 *
 * WHAT THIS REPLACES. `claimNoShow` took a `contactAttempts` number from the browser
 * and wrote it into the claim as evidence — a figure the claimant chose, on the screen
 * where somebody decides whether to pay them. A row written when the dialler opened is
 * a weaker claim and a true one.
 *
 * IT IS STILL NOT PROOF, and `/admin/claims` says so. The row records that a link was
 * opened: whether it rang, whether anybody answered and whether a word was exchanged
 * are all invisible to us, and four taps can be made from the end of the road. What
 * changes is that the number is no longer theirs to pick.
 *
 * THE ACTOR COMES FROM THE SESSION and the booking is re-read as theirs, which is why
 * this is a server write rather than an RLS insert: a professional able to write these
 * directly could manufacture a call history for any booking id they could name.
 *
 * NEVER THROWS AND NEVER BLOCKS THE CALL. The button is a link; the recording is a
 * side effect. Somebody trying to reach a customer from a doorstep must not find the
 * dialler refusing to open because a log write failed.
 */
export async function recordContactAttempt(input: {
  bookingId: string;
  providerProfileId: string;
  channel: "call" | "whatsapp";
}): Promise<boolean> {
  if (!hasSupabaseConfig()) return false;

  try {
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
    if (!booking || booking.provider_id !== provider.id) return false;
    /*
     * The same window the customer's number is released in — `provider_contacts`
     * allows it while a job of theirs is live, so recording an attempt outside that
     * window would be recording a call they could not have made.
     */
    if (!["accepted", "en_route", "in_progress"].includes(booking.status as string)) {
      return false;
    }

    const { error } = await db.from("booking_contact_attempts").insert({
      booking_id: input.bookingId,
      provider_id: provider.id as string,
      channel: input.channel,
    });
    if (error) {
      console.error(`[arrival] contact attempt — ${describeError(error)}`);
      return false;
    }
    return true;
  } catch (thrown) {
    console.error(`[arrival] contact attempt threw — ${describeError(thrown)}`);
    return false;
  }
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

  /*
   * COUNTED, NOT TAKEN FROM THE BROWSER. This used to be a number the claimant typed
   * into their own claim, read by a reviewer as evidence on the screen where the
   * payment is decided. It is now the number of times the call or WhatsApp button
   * actually opened — still not proof that anybody was reached, and no longer theirs
   * to choose.
   *
   * A FAILED COUNT IS ZERO HERE AND THAT IS DELIBERATE, against rule 6's usual
   * direction: `contact_attempts` is `not null default 0` and `judgeNoShowClaim` reads
   * zero attempts as a REASON TO SEND IT TO A PERSON rather than as a mark against
   * anybody. So an unreadable count fails towards review, which is the safe side; a
   * null would have to become a number somewhere anyway, and inventing a flattering
   * one is the alternative.
   */
  const { count: attemptCount } = await db
    .from("booking_contact_attempts")
    .select("id", { count: "exact", head: true })
    .eq("booking_id", input.bookingId);
  const contactAttempts = attemptCount ?? 0;

  const evidence: ArrivalEvidence = {
    arrivedAt: (arrival?.arrived_at as string | null) ?? null,
    waitedMinutes: input.waitedMinutes,
    contactAttempts,
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
      // Frozen onto the row at the claim, so a tap made afterwards cannot change the
      // evidence a reviewer is looking at.
      contact_attempts: contactAttempts,
    })
    .eq("booking_id", input.bookingId);

  /*
   * EVERY CLAIM WAITS FOR A PERSON. This used to open as `open` when the evidence
   * was complete and then settle itself two lines below — which was survivable
   * while `trip_rupees_paid` was a column nothing paid, and is not now that
   * `trip_compensation` moves real money. `needs_person` is the only status a
   * claim can be created in.
   */
  const { error } = await db.from("no_show_claims").upsert(
    {
      booking_id: input.bookingId,
      provider_id: provider.id as string,
      customer_id: booking.customer_id as string,
      status: "needs_person",
    },
    { onConflict: "booking_id" },
  );
  if (error) {
    console.error(`[no-show] claim — ${describeError(error)}`);
    return { ok: false };
  }

  /*
   * NOTHING IS SETTLED HERE. `settleNoShowClaim` is reached from `/admin/claims`
   * and from nowhere else, so the one place that pays a professional and marks a
   * customer is always a person pressing a button with the evidence in front of
   * them. The auto-settle that used to live here passed `decidedBy: null`, which
   * is itself the tell: a decision with no decider.
   */
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

  /*
   * PAY THEM, WHICH IS THE PART THAT NEVER HAPPENED.
   *
   * `trip_rupees_paid` has been written here since Phase 10 under a column comment
   * reading "What we paid the professional", and no money ever moved — no ledger
   * row, so nothing for the payout run to find, nothing in `provider_balance`,
   * nothing on their own money screen. The claim asserted a payment that did not
   * exist.
   *
   * THE LEDGER ROW GOES FIRST, before the claim is marked upheld. If the ledger
   * write fails, the claim stays open and a person sees it again — recoverable. The
   * other order would mark it paid with nothing paid, which is the state this is
   * fixing. `provider_ledger_trip_once_idx` makes a second attempt on the same
   * booking a database refusal rather than a double payment, so a re-decided claim
   * cannot pay twice: the insert errors, the claim is left alone, and the ledger
   * carries exactly one row.
   */
  const { error: ledgerError } = await db.from("provider_ledger").insert({
    provider_id: claim.provider_id as string,
    booking_id: input.bookingId,
    kind: "trip_compensation",
    amount_rupees: TRIP_COMPENSATION.rupees,
    note: "Trip to an address where nobody answered",
  });

  if (ledgerError) {
    /*
     * A unique violation means this claim was already paid — the decision is simply
     * being re-recorded, so carry on and let the claim row catch up. Anything else
     * leaves the claim open rather than marking a payment nobody made.
     */
    const duplicate = (ledgerError as { code?: string }).code === "23505";
    if (!duplicate) {
      console.error(
        `[customer-risk] trip not paid, claim left open — ${describeError(ledgerError)}`,
      );
      return false;
    }
  }

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

/*
 * WHAT USED TO BE HERE: `applyTripDebtToBill`.
 *
 * It read the balance, took its quarter and wrote the remainder — and nothing called
 * it, under a comment that said so. The fix was never to find it a caller, because
 * the function could not safely have one: it wrote the customer's balance and NOTHING
 * ELSE, so a professional correcting a typed figure ran it twice and the second pass
 * took another quarter off a debt that had already been settled on that bill. There
 * was no record on the booking to ask.
 *
 * `recordFinalAmount` owns the recovery now (`lib/data/payments.ts`), and the record
 * is `bookings.trip_debt_added_rupees`: written in the same update as `final_amount`,
 * null meaning nobody has judged this bill yet and 0 meaning somebody judged it and
 * nothing was owed. The rule itself is `tripDebtOnBill` in `lib/abuse/trip.ts`, pure
 * and tested, which composes `applyTripRecovery` rather than restating the cap.
 *
 * So this is a deletion rather than a wiring, and the reason is worth keeping: a
 * money function with no caller is not half-built, it is unexamined — the question
 * "what happens the second time this runs?" had never been asked of it.
 */

/* ------------------------------------------------------------------ *
 * Disputing a trip debt
 * ------------------------------------------------------------------ */

/**
 * The customer says the trip debt is not theirs.
 *
 * WHAT A DISPUTE DOES AND DOES NOT DO. It holds the whole debt off every bill until a
 * person decides — `tripDebtOnBill` returns `disputed` and `recordFinalAmount` writes
 * nothing, not even a zero, so the next booking asks again. It does not cancel the
 * debt and it does not delete the claim that produced it: the balance stays exactly
 * where it was, which is what makes this safe to allow with no gate on it.
 *
 * NOTHING IS LOST BY WAITING, which is the whole argument for holding rather than
 * recovering-and-arguing. The money is still owed if the dispute fails; if we had
 * taken it first, the customer would be arguing to get money back instead of arguing
 * about whether it was ever due, and those two conversations do not go the same way.
 *
 * A REASON IS REQUIRED, and it is stored as the customer's own words. Nothing
 * classifies it: a closed list here would be us deciding in advance what the possible
 * objections are, on the one surface where somebody is telling us we got something
 * wrong. `booking_refusals.reason_code` can be a closed set because the professional
 * is choosing from grounds we already understand; this is not that.
 *
 * THE ACTOR COMES FROM THE SESSION. The caller passes an id it read from
 * `getSessionProfile`, and this writes only that row — there is no id on the form.
 */
export async function disputeTripDebt(input: {
  profileId: string;
  note: string;
}): Promise<{ ok: boolean; reason?: "nothingOwed" | "alreadyOpen" | "failed" }> {
  const note = input.note.trim();
  if (note.length === 0) return { ok: false, reason: "failed" };
  if (!hasSupabaseConfig()) return { ok: false, reason: "failed" };

  const history = await customerHistory(input.profileId);
  /*
   * A dispute over nothing is refused rather than stored. It would otherwise sit on
   * the row for ever holding off a debt that does not exist, and the next genuine
   * one would read as "already open" — a dispute nobody could file.
   */
  if (history.tripDebt <= 0) return { ok: false, reason: "nothingOwed" };
  if (history.tripDebtDisputedAt !== null) {
    return { ok: false, reason: "alreadyOpen" };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("customer_risk")
    .update({
      trip_debt_disputed_at: new Date().toISOString(),
      // 1000 characters is the column; trimming here rather than letting Postgres
      // refuse means a long explanation is kept rather than losing the whole write.
      trip_debt_dispute_note: note.slice(0, 1000),
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", input.profileId)
    .is("trip_debt_disputed_at", null);

  if (error) {
    console.error(`[trip-debt] dispute failed — ${describeError(error)}`);
    return { ok: false, reason: "failed" };
  }

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "customer",
    actorId: input.profileId,
    subjectType: "profile",
    subjectId: input.profileId,
    detail: {
      action: "tripDebt.disputed",
      debtRupees: history.tripDebt,
      // The words themselves live on `customer_risk`; the log records that a dispute
      // was opened and over how much, which is what a timeline needs.
      noteLength: note.length,
    },
  });

  return { ok: true };
}

/**
 * A person decides the dispute.
 *
 * TWO OUTCOMES AND THEY ARE NOT SYMMETRICAL. `cancel` says the debt was wrong, so the
 * balance goes to zero — the trip is absorbed by us, which is what the first-one-free
 * rule already does in the ordinary case and is the cheap side of being wrong.
 * `stands` says it was right, so the stamp clears and the next booking recovers as it
 * would have. Neither touches the no-show claim or the professional's payment: they
 * were paid when the claim was upheld, and whether we recover it from the customer was
 * always a separate question. That ordering is the design, not a convenience.
 *
 * THE REASON IS REQUIRED AND IS THE DECIDER'S OWN, same as a band rejection: a
 * decision that reduces or confirms what somebody owes has to be answerable later by
 * reading one row.
 */
export async function resolveTripDebtDispute(input: {
  customerId: string;
  actorId: string;
  outcome: "cancel" | "stands";
  note: string;
}): Promise<boolean> {
  const note = input.note.trim();
  if (note.length === 0) return false;
  if (!hasSupabaseConfig()) return false;

  const history = await customerHistory(input.customerId);
  if (history.tripDebtDisputedAt === null) return false;

  const db = createAdminClient();
  const { error } = await db
    .from("customer_risk")
    .update({
      trip_debt_disputed_at: null,
      trip_debt_dispute_note: null,
      ...(input.outcome === "cancel" ? { trip_debt_rupees: 0 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", input.customerId)
    .not("trip_debt_disputed_at", "is", null);

  if (error) {
    console.error(`[trip-debt] resolution failed — ${describeError(error)}`);
    return false;
  }

  await recordSecurityEvent({
    kind: "admin.action",
    actorRole: "admin",
    actorId: input.actorId,
    subjectType: "profile",
    subjectId: input.customerId,
    detail: {
      action:
        input.outcome === "cancel"
          ? "tripDebt.disputeUpheld"
          : "tripDebt.disputeRejected",
      // What was at stake, so the row answers "how much" without a join.
      debtRupees: history.tripDebt,
      reason: note.slice(0, 500),
      // The customer's own words, carried into the log because the resolution
      // clears them from `customer_risk` — a decision whose grounds vanished with
      // the row is not answerable later.
      disputeNote: history.tripDebtDisputeNote,
    },
  });

  return true;
}
