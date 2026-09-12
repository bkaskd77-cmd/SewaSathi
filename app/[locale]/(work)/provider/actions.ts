"use server";

import { revalidatePath } from "next/cache";

import { getSessionProfile } from "@/lib/auth/session";
import { acceptClaim, recordVerdict, releaseClaim } from "@/lib/data/claims";
import { getMyProvider } from "@/lib/data/provider-jobs";
import { setAvailableNow, setBaseRate } from "@/lib/data/provider-profile";
import { CLAIM_VERDICTS, type ClaimVerdict } from "@/lib/config/guarantee";

/**
 * The professional's own settings, and their side of a guarantee claim.
 *
 * THE ACTOR COMES FROM THE SESSION. Every one of these re-reads
 * `getSessionProfile()` and resolves the listing from it; none takes a provider
 * id from the browser. Three holes have been found in this product that were
 * all the same shape — an id arrived from a caller and nothing asked whose it
 * was — and a provider id is exactly the kind that would let one professional
 * mark another available or answer a claim against them.
 */

export type ProviderSettingResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

/**
 * "I am free now."
 *
 * The expiry is NOT a parameter. It is computed server-side from
 * `availableUntil`, because a professional who could name their own would be
 * back to a flag that never decays — which outranks everybody honest enough to
 * turn it off, and sends somebody with a burst pipe to a person who is asleep.
 */
export async function setAvailabilityAction(
  on: boolean,
): Promise<ProviderSettingResult> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: "notSignedIn" };

  const result = await setAvailableNow({ profileId: profile.id, on });
  if (!result.ok) return { ok: false, error: "generic" };

  revalidatePath("/provider");
  return { ok: true };
}

/**
 * Their starting price.
 *
 * Clamped rather than refused — see `lib/provider/rates.ts`. The result says
 * which way it moved so the screen can tell them, because a figure that
 * silently becomes a different figure reads as the form losing what they typed.
 */
export async function setRateAction(
  rate: number,
): Promise<
  | { ok: true; rate: number; clampedTo: "low" | "high" | null }
  | { ok: false; error: string }
> {
  const profile = await getSessionProfile();
  if (!profile) return { ok: false, error: "notSignedIn" };

  const result = await setBaseRate({ profileId: profile.id, rate });
  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/provider");
  return {
    ok: true,
    rate: result.verdict.rate,
    clampedTo: result.verdict.clampedTo,
  };
}

/** Taking the return visit. Their own choice, never an assignment. */
export async function acceptClaimAction(
  claimId: string,
): Promise<ProviderSettingResult> {
  const me = await requireProvider();
  if (!me) return { ok: false, error: "notSignedIn" };

  const result = await acceptClaim({ claimId, providerId: me });
  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/provider");
  return { ok: true };
}

/** They cannot go after all. The claim reopens rather than stalling. */
export async function releaseClaimAction(
  claimId: string,
): Promise<ProviderSettingResult> {
  const me = await requireProvider();
  if (!me) return { ok: false, error: "notSignedIn" };

  const result = await releaseClaim({ claimId, providerId: me });
  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/provider");
  return { ok: true };
}

/**
 * What they found, standing in the room.
 *
 * The verdict is validated against the published list here as well as by the
 * database's own check: an unknown string would otherwise reach `claimOutcome`,
 * which answers "customer pays" for everything that is not `sameFault` — a
 * default that must never be reachable by typo.
 */
export async function recordVerdictAction(
  claimId: string,
  verdict: string,
  note: string,
): Promise<ProviderSettingResult> {
  const me = await requireProvider();
  if (!me) return { ok: false, error: "notSignedIn" };

  if (!(CLAIM_VERDICTS as readonly string[]).includes(verdict)) {
    return { ok: false, error: "unknownVerdict" };
  }

  const result = await recordVerdict({
    claimId,
    providerId: me,
    verdict: verdict as ClaimVerdict,
    note,
  });
  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/provider");
  return { ok: true };
}

async function requireProvider(): Promise<string | null> {
  const profile = await getSessionProfile();
  if (!profile) return null;
  const me = await getMyProvider(profile.id);
  return me?.providerId ?? null;
}
