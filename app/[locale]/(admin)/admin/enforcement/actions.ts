"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import {
  cancelSuspendedBooking,
  liftEnforcement,
  reinstateCustomer,
  releaseSuspendedBooking,
  setEnforcement,
  suspendCustomer,
  type EnforcementResult,
  type JobOutcome,
} from "@/lib/data/enforcement";
import { isEnforcementStep } from "@/lib/provider";

/**
 * Raise, lift, suspend, reinstate — the four acts the published ladder needs.
 *
 * A FRESH SECOND FACTOR ON ALL FOUR, the same fifteen minutes a payout needs,
 * and the eight-hour `adminActor()` window is deliberately not enough. Step 4
 * holds a professional's earnings and step 5 removes their listing and reclaims
 * the commission that was avoided; a customer suspension stops every future
 * booking that account could make. None of those is batched queue-reading, which
 * is what the eight-hour window is for.
 *
 * AND LIFTING IS GATED AS HARD AS RAISING. The tempting asymmetry is that
 * clearing a step only gives something back — but a stolen session that can lift
 * is a stolen session that can un-review the account somebody opened a review
 * on, and release the earnings that were being held while they looked.
 *
 * THE ACTOR COMES FROM THE SESSION, NEVER FROM THE FORM. Three holes in this
 * product have been exactly that shape: an id arrived from a browser and nothing
 * asked whose it was. The subject id does cross the wire, and the data layer
 * re-reads it before writing a word.
 *
 * THE REASON CROSSES THE WIRE AND IS REQUIRED, by the form, by the writer and by
 * a CHECK constraint. `/providers/standards` promises an appeal answered by a
 * human being at every step; a human answering needs something to read.
 */

const PATH = "/[locale]/(admin)/admin/enforcement";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function setEnforcementAction(
  data: FormData,
): Promise<EnforcementResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) {
    return { ok: false, reason: gate.reason === "reauthNeeded" ? "unavailable" : "notFound" };
  }

  const step = Number(field(data, "step"));
  if (!isEnforcementStep(step)) return { ok: false, reason: "badStep" };

  const result = await setEnforcement({
    providerId: field(data, "providerId"),
    step,
    reason: field(data, "reason"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function liftEnforcementAction(
  data: FormData,
): Promise<EnforcementResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) {
    return { ok: false, reason: gate.reason === "reauthNeeded" ? "unavailable" : "notFound" };
  }

  const result = await liftEnforcement({
    providerId: field(data, "providerId"),
    reason: field(data, "reason"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function suspendCustomerAction(
  data: FormData,
): Promise<EnforcementResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) {
    return { ok: false, reason: gate.reason === "reauthNeeded" ? "unavailable" : "notFound" };
  }

  const result = await suspendCustomer({
    profileId: field(data, "profileId"),
    reason: field(data, "reason"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function reinstateCustomerAction(
  data: FormData,
): Promise<EnforcementResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) {
    return { ok: false, reason: gate.reason === "reauthNeeded" ? "unavailable" : "notFound" };
  }

  const result = await reinstateCustomer({
    profileId: field(data, "profileId"),
    reason: field(data, "reason"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH);
  return result;
}

/**
 * Take a job off a suspended professional, or end it.
 *
 * GATED LIKE THE SUSPENSION ITSELF. These move real work away from somebody and
 * tell a customer their professional is gone; the eight-hour window is for
 * reading a queue, not for rearranging somebody's week.
 *
 * SEPARATE FROM RAISING THE STEP ON PURPOSE. The suspension lands immediately —
 * somebody who needs stopping is stopped before the paperwork — and the jobs
 * already in flight are dealt with one at a time afterwards. Blocking a
 * suspension until a dozen bookings were resolved would mean the slowest case
 * delays the most urgent one.
 */
export async function releaseJobAction(data: FormData): Promise<JobOutcome> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: "unavailable" };

  const result = await releaseSuspendedBooking({
    bookingId: field(data, "bookingId"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH);
  return result;
}

export async function cancelJobAction(data: FormData): Promise<JobOutcome> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: "unavailable" };

  const result = await cancelSuspendedBooking({
    bookingId: field(data, "bookingId"),
    actorId: gate.profile.id,
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH);
  return result;
}
