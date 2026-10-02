"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import {
  approveBand,
  rejectBand,
  type BandDecisionResult,
} from "@/lib/data/bands";

/**
 * Approve or reject a band proposal.
 *
 * THE PROPOSAL CROSSES THE WIRE AND IS NOT TRUSTED AS A BAND. The form carries
 * the numbers the screen displayed, because a rejection has to record what was
 * refused and an approval has to publish what somebody actually read — a server
 * that recomputed the proposal here could publish a figure nobody saw, which is
 * the opposite of what the approve button means. What makes that safe is that the
 * pair is bounded by the same rule either way: `MAX_REVISION_MOVE` already held
 * the displayed number inside ±20% of the published band, and the revision row
 * keeps the old band beside the new one, so a forged pair is visible in the
 * history next to the band it replaced and cannot exceed what the editor could
 * have offered without being obvious. The actor is never taken from the form.
 *
 * NO FIFTEEN-MINUTE RE-CHALLENGE, deliberately, and this is the `markConfirmed`
 * reasoning rather than an oversight. `adminActor()` already requires the
 * eight-hour step-up. Nothing here moves money out of an account: the change is
 * forward-only — `freeze_booking_band()` froze every existing quote — and another
 * approval reverses it. A code demanded for a write that cannot cost anybody
 * anything today is how people learn to tap through the ones that can.
 */

const PATH = "/[locale]/(admin)/admin/bands";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

function number(data: FormData, name: string): number {
  const parsed = Number(field(data, name));
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

/** The evidence the screen showed, carried so the decision records what it was about. */
function proposalFrom(data: FormData) {
  return {
    low: number(data, "low"),
    high: number(data, "high"),
    sample: number(data, "sample"),
    winsorised: number(data, "winsorised"),
    capped: field(data, "capped") === "1",
  };
}

export async function approveBandAction(
  data: FormData,
): Promise<BandDecisionResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "refused" };

  const result = await approveBand({
    slug: field(data, "slug"),
    proposal: proposalFrom(data),
    actorId: profile.id,
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}

export async function rejectBandAction(
  data: FormData,
): Promise<BandDecisionResult> {
  const profile = await adminActor();
  if (!profile) return { ok: false, reason: "refused" };

  const result = await rejectBand({
    slug: field(data, "slug"),
    proposal: proposalFrom(data),
    actorId: profile.id,
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}
