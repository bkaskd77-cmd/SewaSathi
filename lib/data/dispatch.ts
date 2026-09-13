import "server-only";

import { dispatchStage, type Urgency } from "@/lib/booking";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Applying the dispatch rules to a booking.
 *
 * ONE implementation, two callers: the cron sweep and the customer's "check
 * now" button. That is the whole reason this file exists rather than the logic
 * living in the route — an escalation rule with two copies is an escalation
 * rule that will eventually escalate differently depending on who asked, and
 * the difference would be invisible until somebody's emergency sat unwidened.
 *
 * Every decision comes from the booking's own timestamps (see
 * `lib/booking/dispatch.ts`), so this is idempotent: running it early, twice,
 * or from both callers at once changes nothing that was not already due.
 */

export type DispatchOutcome =
  /** Still the chosen professional's alone. Nothing happened, correctly. */
  | { changed: false; stage: "first-refusal" }
  /**
   * Waiting on the customer to say they will be there.
   *
   * Its own outcome rather than folded into `first-refusal`, because the two
   * mean opposite things to whoever reads the sweep's report: one is the
   * system working as designed, the other is a customer who has not answered
   * and may need ringing.
   */
  | { changed: false; stage: "awaiting-confirmation" }
  /** Already open, or already ended. Nothing left to do. */
  | { changed: false; stage: "open" | "give-up" }
  | { changed: true; stage: "open" | "give-up" };

type Row = {
  id: string;
  reference: string;
  customer_id: string;
  urgency: string;
  created_at: string;
  opened_at: string | null;
  reassigned_at: string | null;
  /*
   * PROTECT THE TRIP, NOT THE BOOKING.
   *
   * A booking to an address nobody has ever been to waits here until the
   * customer actively answers. It is not a status — see the note in
   * 20260910000002_customer_risk.sql — because the booking really is pending;
   * what is held is the DISPATCH, and only this file needed to learn that.
   */
  confirmation_required: boolean;
  confirmed_at: string | null;
};

/**
 * Move one booking to wherever its age says it should be.
 *
 * The updates are guarded on `status = 'pending'` so a professional accepting
 * in the same second wins rather than having their job widened or cancelled
 * underneath them. That guard is the only thing standing between this and two
 * professionals arriving at one house.
 */
export async function applyDispatch(
  row: Row,
  now: Date = new Date(),
): Promise<DispatchOutcome> {
  /*
   * HELD, NOT ABANDONED, and the difference is the whole point.
   *
   * A booking to an address nobody has ever been to does not widen and does
   * not give up while the customer still owes us an answer. Widening it would
   * send a professional across town on the strength of nothing; giving up
   * would abandon somebody who is simply carrying buckets rather than watching
   * their phone. So the clock stops until they tap, and the booking screen
   * says what is being waited for.
   *
   * Checked before the stage is even computed, because an emergency's five
   * minutes would otherwise have already elapsed by the time anybody looked.
   */
  if (row.confirmation_required && row.confirmed_at === null) {
    return { changed: false, stage: "awaiting-confirmation" };
  }

  const stage = dispatchStage(
    row.created_at,
    (row.urgency as Urgency) ?? "routine",
    now,
    row.reassigned_at,
  );

  if (stage === "first-refusal") return { changed: false, stage };

  const supabase = createAdminClient();

  if (stage === "give-up") {
    const { data, error } = await supabase
      .from("bookings")
      .update({ status: "no_provider_found" })
      .eq("id", row.id)
      .eq("status", "pending")
      .select("id");

    if (error) {
      console.error(`[dispatch] give-up failed — ${describeError(error)}`);
      return { changed: false, stage };
    }
    if ((data?.length ?? 0) === 0) return { changed: false, stage };

    await notify({
      recipientId: row.customer_id,
      kind: "booking.noProviderFound",
      params: { reference: row.reference },
      bookingId: row.id,
    });
    return { changed: true, stage };
  }

  // Already widened. Not an error — the sweep and the button both land here
  // routinely, and the second one has nothing to do.
  if (row.opened_at) return { changed: false, stage };

  // Clearing provider_id is what makes it visible to everybody else.
  // `first_choice_provider_id` was written when the booking was created, so
  // the customer's decision survives this.
  const { data, error } = await supabase
    .from("bookings")
    .update({ provider_id: null, opened_at: now.toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id");

  if (error) {
    console.error(`[dispatch] widen failed — ${describeError(error)}`);
    return { changed: false, stage };
  }
  if ((data?.length ?? 0) === 0) return { changed: false, stage };

  await notify({
    recipientId: row.customer_id,
    kind: "booking.widened",
    params: { reference: row.reference },
    bookingId: row.id,
  });
  return { changed: true, stage };
}

const COLUMNS =
  "id, reference, customer_id, provider_id, urgency, created_at, opened_at, reassigned_at, confirmation_required, confirmed_at";

/** Every pending booking, oldest first. The cron's input. */
export async function sweepDispatch(
  now: Date = new Date(),
): Promise<{ checked: number; opened: number; abandoned: number }> {
  if (!hasSupabaseConfig()) return { checked: 0, opened: 0, abandoned: 0 };

  const { data } = await createAdminClient()
    .from("bookings")
    .select(COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  let opened = 0;
  let abandoned = 0;
  for (const row of (data ?? []) as unknown as Row[]) {
    const outcome = await applyDispatch(row, now);
    if (!outcome.changed) continue;
    if (outcome.stage === "open") opened += 1;
    else abandoned += 1;
  }

  return { checked: data?.length ?? 0, opened, abandoned };
}

/**
 * "Check now", from the customer's own booking page.
 *
 * Deliberately NOT guarded by `CRON_SECRET`, and safe without it: it is scoped
 * to one booking the caller owns, and it applies the same age-based rule the
 * cron would apply anyway. Tapping it early cannot widen anything early — the
 * stage comes from timestamps, so an impatient customer gets "still with your
 * professional" and nothing moves.
 *
 * It exists because the cron runs daily on this Vercel plan, and a five-minute
 * emergency window that only advances once a day is not a five-minute window.
 * Somebody waiting by a leak should not have to wait for tomorrow's sweep.
 */
export async function checkDispatchNow(input: {
  bookingId: string;
  actorId: string;
}): Promise<DispatchOutcome | { changed: false; stage: "notYours" }> {
  if (!hasSupabaseConfig()) return { changed: false, stage: "notYours" };

  const { data } = await createAdminClient()
    .from("bookings")
    .select(`${COLUMNS}, status`)
    .eq("id", input.bookingId)
    .maybeSingle();

  const row = data as (Row & { status: string }) | null;
  if (!row || row.customer_id !== input.actorId) {
    return { changed: false, stage: "notYours" };
  }
  // Only a job still waiting has anywhere to go.
  if (row.status !== "pending") return { changed: false, stage: "first-refusal" };

  return applyDispatch(row);
}

/**
 * The customer stops waiting and opens the job to everybody.
 *
 * WHY THIS EXISTS. A professional who simply ignores the notification produced
 * nothing at all on the customer's screen: the job held with them for the
 * first-refusal window, and the replacement chooser only appears when somebody
 * actively refuses. Silence looked exactly like progress, and the customer had
 * no way to act on it. `checkDispatchNow` deliberately only applies what the
 * clock already made due, so it could not answer this — tapping it early
 * correctly moves nothing.
 *
 * IT IS NOT A REFUSAL AND MUST NEVER BE COUNTED AS ONE. Clearing `provider_id`
 * on a pending booking is exactly how a decline is detected, so without the
 * `widened_by_customer_at` stamp this would write `declines + 1` and a
 * `booking_refusals` row against somebody who did nothing — contradicting a
 * published promise, and hiding the job from them for ever through
 * `provider_refused`. The trigger reads that stamp and records nothing; the db
 * suite asserts both halves.
 *
 * THE ORIGINAL PROFESSIONAL CAN STILL TAKE IT. They were slow, not unwilling,
 * and somebody who picks their phone up thirty seconds later should find the
 * job waiting rather than gone.
 */
export async function widenBooking(input: {
  bookingId: string;
  actorId: string;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "unavailable" };

  try {
    const admin = createAdminClient();

    const { data: booking } = await admin
      .from("bookings")
      .select("id, customer_id, status, provider_id, widened_by_customer_at")
      .eq("id", input.bookingId)
      .maybeSingle();

    if (!booking || booking.customer_id !== input.actorId) {
      return { ok: false, reason: "notYours" };
    }
    // Only a job still waiting has anywhere to go. A booking somebody has
    // accepted is theirs, and widening it would send two people to one house.
    if (booking.status !== "pending") {
      return { ok: false, reason: "notWaiting" };
    }
    if (!booking.provider_id) return { ok: true };

    /*
     * The customer's original choice survives, exactly as it does when the
     * sweep widens a job: "I asked for Krishna and Sita came" has to stay
     * answerable afterwards.
     */
    const { error } = await admin
      .from("bookings")
      .update({
        widened_by_customer_at: new Date().toISOString(),
        provider_id: null,
        opened_at: new Date().toISOString(),
        first_choice_provider_id:
          (booking.provider_id as string | null) ?? undefined,
      })
      .eq("id", input.bookingId)
      // The state this was judged against. Two taps a second apart: the second
      // updates nothing rather than re-stamping.
      .eq("status", "pending")
      .not("provider_id", "is", null);

    if (error) {
      console.error(`[dispatch] widen failed — ${describeError(error)}`);
      return { ok: false, reason: "generic" };
    }

    return { ok: true };
  } catch (thrown) {
    console.error(`[dispatch] widen threw — ${describeError(thrown)}`);
    return { ok: false, reason: "generic" };
  }
}
