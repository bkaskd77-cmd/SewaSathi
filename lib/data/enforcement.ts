import "server-only";

import { recordSecurityEvent } from "@/lib/audit";
import { judgeCancellation, type BookingStatus } from "@/lib/booking";
import { notify } from "@/lib/notify";
import { hasSupabaseConfig } from "@/lib/env";
import {
  canLift,
  isEnforcementStep,
  isRemoved,
  type EnforcementStep,
} from "@/lib/provider";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The only writer of the enforcement ladder's state, on both sides.
 *
 * SERVICE ROLE, AND THE SUBJECT IS RE-READ RATHER THAN BELIEVED. Every id here
 * arrives from a form, so nothing is written against it until the row has been
 * read back — the shape this repository records three holes against, all of them
 * an id that came from a browser with nothing asking whose it was.
 *
 * THE REASON IS NOT OPTIONAL AND THE DATABASE AGREES. `providers_enforcement_shape`
 * and `customer_risk_ban_shape` refuse a step or a ban with no words beside it,
 * so a future caller that forgets is refused rather than quietly recorded. The
 * page promises an appeal answered by a human being; a human answering needs
 * something to read.
 *
 * EVERY WRITE IS AUDITED AND THE AUDIT IS THE HISTORY. The columns hold only
 * what is true now. `security_events` is append-only for every caller including
 * this one, so "step 4 was raised on the 3rd and lifted on the 9th" lives there
 * and cannot later be tidied into something else.
 */

export type EnforcementResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "notFound"
        | "needsReason"
        | "badStep"
        /** Step 5 is published as permanent. Coming back means re-applying. */
        | "removedIsPermanent"
        | "writeFailed"
        | "unavailable";
    };

function words(reason: string, max: number): string | null {
  const text = reason.trim();
  if (text.length === 0) return null;
  return text.slice(0, max);
}

/**
 * Raise or change the step in force for one professional.
 *
 * RAISING AND LOWERING ARE ONE CALL on purpose. Step 4 after step 3 and step 3
 * after step 4 are both "a person looked again and decided this"; two functions
 * would need the caller to know which it was, and a caller that got it wrong
 * would write the wrong event kind into a log somebody argues an appeal from.
 */
export async function setEnforcement(input: {
  providerId: string;
  step: EnforcementStep;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };
  if (!isEnforcementStep(input.step)) return { ok: false, reason: "badStep" };

  const reason = words(input.reason, 2000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("providers")
    .select("id, enforcement_step")
    .eq("id", input.providerId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!existing) return { ok: false, reason: "notFound" };

  /*
   * ALREADY REMOVED IS THE END OF THE LADDER. Writing step 3 over step 5 would
   * put a removed listing back into the open pool, and `removed_at` would have
   * to be cleared with it — erasing the decision rather than reversing it.
   */
  if (isRemoved(existing.enforcement_step as EnforcementStep | null)) {
    return { ok: false, reason: "removedIsPermanent" };
  }

  const now = new Date().toISOString();

  const { error: writeError } = await db
    .from("providers")
    .update({
      enforcement_step: input.step,
      enforcement_reason: reason,
      enforcement_at: now,
      enforcement_by: input.actorId,
      /*
       * PAIRED HERE AND REFUSED BY THE DATABASE IF IT IS NOT.
       * `providers_removed_is_step_five` is what stops these two disagreeing —
       * four modules already read `removed_at` and none of them knows about the
       * step number.
       */
      removed_at: input.step === 5 ? now : null,
    })
    .eq("id", input.providerId);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "provider.enforcementRaised",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "provider",
    subjectId: input.providerId,
    detail: {
      step: input.step,
      from: existing.enforcement_step ?? null,
      reason,
    },
  });

  return { ok: true };
}

/**
 * Lift the step. Reversible is the whole point of the first four.
 *
 * STEP 5 IS REFUSED, in `canLift` rather than here, so the screen and the write
 * cannot disagree about what is permanent. The page says removal is permanent
 * and says what happens instead: somebody who should come back re-applies,
 * through `provider_applications`, which records the second decision beside the
 * first. Clearing the column would erase the first one.
 */
export async function liftEnforcement(input: {
  providerId: string;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const reason = words(input.reason, 2000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("providers")
    .select("id, enforcement_step")
    .eq("id", input.providerId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!existing) return { ok: false, reason: "notFound" };

  const step = existing.enforcement_step as EnforcementStep | null;
  if (!canLift(step)) {
    return { ok: false, reason: step === 5 ? "removedIsPermanent" : "badStep" };
  }

  const { error: writeError } = await db
    .from("providers")
    .update({
      enforcement_step: null,
      enforcement_reason: null,
      enforcement_at: null,
      enforcement_by: null,
      removed_at: null,
    })
    .eq("id", input.providerId);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "provider.enforcementLifted",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "provider",
    subjectId: input.providerId,
    detail: { from: step, reason },
  });

  return { ok: true };
}

/**
 * Suspend a customer: reason required, reversible, audited, history kept.
 *
 * THE COLUMNS ARE OLDER THAN THIS FUNCTION BY FIVE WEEKS. `banned_at` and
 * `banned_reason` landed in 20260910000002 and nothing has ever written them —
 * and the one reader turns `banned_at` into a boolean that two admin screens
 * DISPLAY, while `createBooking` never consulted customer risk at all. So the
 * setting existed, could be set by hand, and did nothing: a false control, which
 * is worse than an absent one because somebody would have believed it.
 *
 * UPSERT, BECAUSE A CUSTOMER MAY HAVE NO RISK ROW. `customer_risk` is written
 * when something is recorded about somebody, and a customer nobody has recorded
 * anything about is exactly the one a first suspension is most likely to name.
 */
export async function suspendCustomer(input: {
  profileId: string;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const reason = words(input.reason, 1000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: person, error: readError } = await db
    .from("profiles")
    .select("id")
    .eq("id", input.profileId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!person) return { ok: false, reason: "notFound" };

  const { error: writeError } = await db.from("customer_risk").upsert(
    {
      profile_id: input.profileId,
      banned_at: new Date().toISOString(),
      banned_reason: reason,
      banned_by: input.actorId,
    },
    { onConflict: "profile_id" },
  );

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "customer.suspended",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "profile",
    subjectId: input.profileId,
    detail: { reason },
  });

  return { ok: true };
}

/**
 * Let them back in. A reason is required for this half too.
 *
 * SYMMETRY IS NOT THE REASON — the record is. A reinstatement with no words is a
 * decision somebody made that nobody can later ask about, and the suspension it
 * reverses is sitting in the same log with its own sentence.
 */
export async function reinstateCustomer(input: {
  profileId: string;
  reason: string;
  actorId: string;
}): Promise<EnforcementResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const reason = words(input.reason, 1000);
  if (!reason) return { ok: false, reason: "needsReason" };

  const db = createAdminClient();

  const { data: existing, error: readError } = await db
    .from("customer_risk")
    .select("profile_id, banned_at, banned_reason")
    .eq("profile_id", input.profileId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!existing || existing.banned_at === null) {
    return { ok: false, reason: "notFound" };
  }

  const { error: writeError } = await db
    .from("customer_risk")
    .update({ banned_at: null, banned_reason: null, banned_by: null })
    .eq("profile_id", input.profileId);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "customer.reinstated",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "profile",
    subjectId: input.profileId,
    detail: { reason, was: existing.banned_reason ?? null },
  });

  return { ok: true };
}

/**
 * Is this customer stopped from booking right now?
 *
 * THE ONE READ THE BOOKING PATH ASKS, so "suspended" is decided in one place.
 * A failed read returns `null` and the caller decides — rule 6, because
 * answering "not suspended" to a question we could not ask would be the same
 * false control from the other direction.
 */
export async function customerIsSuspended(
  profileId: string,
): Promise<{ suspended: boolean; reason: string | null } | null> {
  if (!hasSupabaseConfig()) return { suspended: false, reason: null };

  const { data, error } = await createAdminClient()
    .from("customer_risk")
    .select("banned_at, banned_reason")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) return null;
  if (!data || data.banned_at === null) return { suspended: false, reason: null };
  return { suspended: true, reason: (data.banned_reason as string) ?? null };
}

/* ------------------------------------------------------------------ reads --- */

export type EnforcedProvider = {
  id: string;
  displayName: string;
  step: EnforcementStep | null;
  reason: string | null;
  at: string | null;
};

export type SuspendedCustomer = {
  profileId: string;
  fullName: string | null;
  reason: string | null;
};

export type EnforcementBoard = {
  /** Null is "we could not read it", never "nobody is under a step". */
  providers: EnforcedProvider[] | null;
  customers: SuspendedCustomer[] | null;
};

/**
 * What the screen shows.
 *
 * A FAILED READ IS ITS OWN ANSWER AND NEVER AN EMPTY LIST. "Nobody is under a
 * step" and "we could not ask" are opposite facts, and on this screen the first
 * one read as the second would tell somebody the ladder is clear when it is
 * simply unreadable — the `/services` rule, where a failed read must never
 * render as a measured zero.
 *
 * EVERY PROVIDER, NOT ONLY THE ENFORCED ONES. A screen that listed only people
 * already under a step would have no way to raise one, which is how the ladder
 * came to be published with nothing behind it in the first place.
 */
export async function enforcementBoard(): Promise<EnforcementBoard> {
  if (!hasSupabaseConfig()) return { providers: null, customers: null };

  const db = createAdminClient();

  const [providers, customers] = await Promise.all([
    db
      .from("providers")
      .select("id, display_name, enforcement_step, enforcement_reason, enforcement_at")
      .order("enforcement_step", { ascending: false, nullsFirst: false })
      .order("display_name"),
    db
      .from("customer_risk")
      .select("profile_id, banned_reason")
      .not("banned_at", "is", null),
  ]);

  /*
   * THE NAMES COME IN A SECOND QUERY RATHER THAN AN EMBED, and that is cheaper
   * to reason about than it looks. `customer_risk` has exactly one foreign key
   * to `profiles`, so an embed would be unambiguous at runtime — but the
   * hand-written types do not model the relation, and the failure mode of an
   * embed PostgREST refuses is the WHOLE read failing, which this repository has
   * already been bitten by four times in one day. Two reads on an admin screen
   * with a handful of rows is not a cost worth that risk.
   */
  let names = new Map<string, string | null>();
  if (!customers.error && (customers.data ?? []).length > 0) {
    const ids = (customers.data ?? []).map((row) => row.profile_id as string);
    const { data: people } = await db
      .from("profiles")
      .select("id, full_name")
      .in("id", ids);
    names = new Map(
      (people ?? []).map((row) => [
        row.id as string,
        (row.full_name as string | null) ?? null,
      ]),
    );
  }

  return {
    providers: providers.error
      ? null
      : (providers.data ?? []).map((row) => ({
          id: row.id as string,
          displayName: (row.display_name as string) ?? "",
          step: (row.enforcement_step as EnforcementStep | null) ?? null,
          reason: (row.enforcement_reason as string | null) ?? null,
          at: (row.enforcement_at as string | null) ?? null,
        })),
    customers: customers.error
      ? null
      : (customers.data ?? []).map((row) => ({
          profileId: row.profile_id as string,
          fullName: names.get(row.profile_id as string) ?? null,
          reason: (row.banned_reason as string | null) ?? null,
        })),
  };
}

/**
 * The step in force for one professional, for the booking path.
 *
 * NULL IS "WE COULD NOT ASK", and the caller must treat it as such. Returning
 * "no step" for a failed read is the `banned_at` mistake from the other
 * direction: a gate that opens when it cannot see.
 *
 * SEPARATE FROM THE CATALOGUE READ ON PURPOSE. `getProvider` already refuses a
 * listing at step 4 or 5, so by the time this is asked the only step that can
 * still come back is 3 — the one the page says keeps by-name customers. Folding
 * the column into the public `Provider` type would put an enforcement state on
 * an object the seed fallback also builds, where it would have to be invented.
 */
export async function providerEnforcement(
  providerId: string,
): Promise<{ step: EnforcementStep | null } | null> {
  if (!hasSupabaseConfig()) return { step: null };

  const { data, error } = await createAdminClient()
    .from("providers")
    .select("enforcement_step")
    .eq("id", providerId)
    .maybeSingle();

  if (error) return null;
  return { step: (data?.enforcement_step as EnforcementStep | null) ?? null };
}

/* ------------------------------------------------- jobs already in flight --- */

export type InFlightBooking = {
  id: string;
  reference: string;
  status: string;
  scheduledFor: string | null;
  customerId: string;
  /** False for `in_progress`: somebody is in the house with the floor up. */
  releasable: boolean;
};

/**
 * The jobs a suspension leaves hanging.
 *
 * WHY THE SCREEN NEEDS THIS AT ALL. Raising a step stops NEW work — the open
 * pool closes, the listing goes, the payout waits. It does nothing to a job
 * already accepted, so without this list a suspension leaves customers waiting
 * at home for somebody who is never coming, and nothing anywhere says so. That
 * is the gap between "they cannot take more work" and "the work they have is
 * handled", and only the second one is a customer not being let down.
 *
 * `in_progress` IS LISTED AND CANNOT BE RELEASED. The status machine allows
 * `accepted -> pending` and `en_route -> pending` and deliberately not this one:
 * somebody is in the customer's house with the floor up, and walking out of
 * that is a phone call rather than a button. It still appears, because a job
 * the screen hid would be the one nobody dealt with.
 *
 * A FAILED READ IS NULL AND NEVER AN EMPTY LIST. "No jobs in flight" and "we
 * could not ask" are opposite facts, and on this screen the second rendered as
 * the first tells somebody they are finished when they have not started.
 */
export async function inFlightBookings(
  subject: { providerId: string } | { customerId: string },
): Promise<InFlightBooking[] | null> {
  if (!hasSupabaseConfig()) return [];

  const open = ["pending", "accepted", "en_route", "in_progress"];

  let query = createAdminClient()
    .from("bookings")
    .select("id, reference, status, scheduled_for, customer_id")
    .in("status", open)
    .order("scheduled_for", { ascending: true, nullsFirst: false });

  query =
    "providerId" in subject
      ? query.eq("provider_id", subject.providerId)
      : query.eq("customer_id", subject.customerId);

  const { data, error } = await query;
  if (error) return null;

  return (data ?? []).map((row) => ({
    id: row.id as string,
    reference: (row.reference as string) ?? "",
    status: row.status as string,
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    customerId: row.customer_id as string,
    releasable: row.status !== "in_progress",
  }));
}

export type JobOutcome =
  | { ok: true }
  | { ok: false; reason: "notFound" | "inProgress" | "writeFailed" | "unavailable" };

/**
 * Take the job off them and open it to everybody.
 *
 * THE SUSPENSION ITSELF IS WHAT MAKES THIS SAFE. Releasing to the pool would
 * normally risk the same person claiming it straight back; `provider_can_serve`
 * now excludes anybody with a step in force, so the pool they are released into
 * is one they cannot reach. The dispatch machinery then does what it already
 * does for a withdrawal, including offering the customer ranked alternatives.
 *
 * THE CUSTOMER'S ORIGINAL CHOICE SURVIVES, as it does on every other widening:
 * "I asked for Krishna and Sita came" has to stay answerable afterwards.
 *
 * THE CUSTOMER IS TOLD, AND WITH ITS OWN REASON. `booking.providerUnavailable`
 * rather than `booking.declined`, because they did not decline — we took them
 * off — and a product that says otherwise teaches the customer something false
 * about a person it has stopped working with.
 */
export async function releaseSuspendedBooking(input: {
  bookingId: string;
  actorId: string;
}): Promise<JobOutcome> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const db = createAdminClient();

  const { data: booking, error: readError } = await db
    .from("bookings")
    .select("id, reference, status, provider_id, customer_id")
    .eq("id", input.bookingId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.status === "in_progress") return { ok: false, reason: "inProgress" };

  const now = new Date().toISOString();

  const { error: writeError } = await db
    .from("bookings")
    .update({
      status: "pending",
      provider_id: null,
      opened_at: now,
      first_choice_provider_id:
        (booking.provider_id as string | null) ?? undefined,
    })
    .eq("id", input.bookingId)
    /* The state this was judged against: a second tap updates nothing. */
    .in("status", ["pending", "accepted", "en_route"]);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "booking.releasedOnSuspension",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "booking",
    subjectId: input.bookingId,
    detail: { from: (booking.provider_id as string | null) ?? null },
  });

  await notify({
    recipientId: booking.customer_id as string,
    audience: "customer",
    kind: "booking.providerUnavailable",
    params: { reference: (booking.reference as string) ?? "" },
    bookingId: input.bookingId,
  });

  return { ok: true };
}

/**
 * End the job instead, at no cost to the customer.
 *
 * THE FEE IS ZERO AND IS NOT A DECISION TAKEN HERE. `lib/booking/cancellation.ts`
 * returns zero for every window because our money moves after the work — and on
 * this path charging anything would be charging somebody for a suspension they
 * had no part in. The column exists so a fee is later a constant rather than a
 * migration; it is not one today and this writer does not invent one.
 *
 * THE ADMIN WINDOW IS THE WIDEST OF THE THREE, which is why this can end a job
 * the customer no longer could: `judgeCancellation` lets support cancel until
 * the job is over. That is the published rule, not an exception made here.
 */
export async function cancelSuspendedBooking(input: {
  bookingId: string;
  actorId: string;
  reason: string;
}): Promise<JobOutcome> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  const db = createAdminClient();

  const { data: booking, error: readError } = await db
    .from("bookings")
    .select("id, reference, status, customer_id")
    .eq("id", input.bookingId)
    .maybeSingle();

  if (readError) return { ok: false, reason: "writeFailed" };
  if (!booking) return { ok: false, reason: "notFound" };

  const verdict = judgeCancellation(booking.status as BookingStatus, "admin");
  if (!verdict.allowed) return { ok: false, reason: "inProgress" };

  const { error: writeError } = await db
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: words(input.reason, 500),
      cancellation_fee: 0,
    })
    .eq("id", input.bookingId)
    .in("status", ["pending", "accepted", "en_route", "in_progress"]);

  if (writeError) return { ok: false, reason: "writeFailed" };

  await recordSecurityEvent({
    kind: "booking.cancelledOnSuspension",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "booking",
    subjectId: input.bookingId,
    detail: { reason: words(input.reason, 500) },
  });

  await notify({
    recipientId: booking.customer_id as string,
    audience: "customer",
    kind: "booking.cancelled",
    params: { reference: (booking.reference as string) ?? "" },
    bookingId: input.bookingId,
  });

  return { ok: true };
}

/**
 * The step in force for the person signed in, by their profile id.
 *
 * BY PROFILE RATHER THAN BY LISTING, because the screens that show the notice
 * know who is signed in and not which `providers` row is theirs. One read
 * rather than making four pages join it themselves.
 *
 * NULL IS "WE COULD NOT ASK", and a screen that cannot ask simply shows no
 * notice — the opposite of the booking gate, deliberately. There, failing open
 * lets somebody past a control; here, failing closed would put a suspension
 * notice in front of somebody who is not suspended, which is its own harm.
 */
export async function providerStandingFor(
  profileId: string,
): Promise<{ step: EnforcementStep | null; reason: string | null } | null> {
  if (!hasSupabaseConfig()) return { step: null, reason: null };

  const { data, error } = await createAdminClient()
    .from("providers")
    .select("enforcement_step, enforcement_reason")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) return null;
  return {
    step: (data?.enforcement_step as EnforcementStep | null) ?? null,
    reason: (data?.enforcement_reason as string | null) ?? null,
  };
}
