"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { sessionAuthenticatedAt } from "@/lib/auth/session";
import {
  approvePayout,
  markPayoutConfirmed,
  markPayoutFailed,
  markPayoutSent,
  type PayoutActionResult,
} from "@/lib/data/payouts";
import { revealDestination } from "@/lib/data/payout-destinations";

/**
 * The four things a person does to a payout, and the one that shows an account.
 *
 * EVERY ONE OF THESE IS A PUBLIC POST ENDPOINT. A server action is reachable by
 * anybody who can reach the page, so `adminActor()` reads the session rather than
 * trusting anything in the form — the same reasoning
 * `confirmDestinationAction` states one screen over. Only the payout id, the
 * reason and (for a send) the reference cross the wire; who did it, how much it
 * was and whose money it is are all re-read server-side.
 *
 * `reauthenticatedAt` IS READ HERE AND NEVER ACCEPTED FROM THE FORM.
 * `sessionAuthenticatedAt()` takes it from the session's `amr` claim, which
 * carries the moment somebody actually proved who they were. A field, a parameter
 * or a cookie would all be the browser's to set, and this is the gate between a
 * stolen admin session and somebody's week of earnings. It is deliberately NOT
 * `iat`: that resets on every silent token refresh, so a gate reading it means
 * "recently active", which is what a stolen session is.
 */

const PATH = "/[locale]/(admin)/admin/payouts";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function approvePayoutAction(
  data: FormData,
): Promise<PayoutActionResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "generic" };

  const result = await approvePayout({
    payoutId: field(data, "payoutId"),
    adminId: profile.id,
    reauthenticatedAt: await sessionAuthenticatedAt(),
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}

export async function markSentAction(
  data: FormData,
): Promise<PayoutActionResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "generic" };

  const result = await markPayoutSent({
    payoutId: field(data, "payoutId"),
    adminId: profile.id,
    reauthenticatedAt: await sessionAuthenticatedAt(),
    reference: field(data, "reference"),
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}

export async function markConfirmedAction(
  data: FormData,
): Promise<PayoutActionResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "generic" };

  const result = await markPayoutConfirmed({
    payoutId: field(data, "payoutId"),
    adminId: profile.id,
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}

export async function markFailedAction(
  data: FormData,
): Promise<PayoutActionResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "generic" };

  const result = await markPayoutFailed({
    payoutId: field(data, "payoutId"),
    adminId: profile.id,
    reauthenticatedAt: await sessionAuthenticatedAt(),
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}

/**
 * The account number itself, for the person about to type it into a bank.
 *
 * THE ONE PATH IN THE PRODUCT THAT RETURNS DIGITS, and it writes its audit row
 * before it opens the envelope — `revealDestination` does that, not this action, so
 * there is one place the recording can be removed from and a test that counts
 * `security_events` either side of it.
 *
 * IT IS NOT REVALIDATED and never rendered into the page. The number goes back as
 * the action's return value to the component that asked, which keeps it out of the
 * server-rendered HTML, out of the router cache and out of anything a later
 * visitor to this screen would receive.
 */
export async function revealDestinationAction(
  data: FormData,
): Promise<{ ok: boolean; accountRef?: string; accountName?: string; reason?: string }> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "generic" };

  const reason = field(data, "reason");
  // A reason is required by the data layer too; refusing here as well is what
  // keeps the audit row from ever carrying an empty sentence.
  if (reason.length < 4) return { ok: false, reason: "needsReason" };

  const result = await revealDestination({
    destinationId: field(data, "destinationId"),
    adminId: profile.id,
    reason,
  });

  if (!result.ok) return { ok: false, reason: result.reason };
  return {
    ok: true,
    accountRef: result.accountRef,
    accountName: result.accountName,
  };
}
