"use server";

import { revalidatePath } from "next/cache";

import { adminActor, freshAdminActor } from "@/lib/auth/admin-gate";
import {
  approveBand,
  rejectBand,
  stateBand,
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
 * NO FIFTEEN-MINUTE RE-CHALLENGE ON THESE TWO, deliberately, and this is the
 * `markConfirmed` reasoning rather than an oversight. `adminActor()` already
 * requires the eight-hour step-up. Nothing in an approval or a rejection moves
 * money out of an account: the change is forward-only — `freeze_booking_band()`
 * froze every existing quote — the figure came off an evidence screen bounded by
 * `MAX_REVISION_MOVE`, and another approval reverses it. A code demanded for a
 * write that cannot cost anybody anything today is how people learn to tap
 * through the ones that can.
 *
 * `stateBandAction` IS THE EXCEPTION AND IT IS BELOW, with the fifteen-minute
 * gate and the reason. The split is declared in `lib/config/admin-money.ts` and
 * `tests/unit/admin-money-reauth.test.ts` reads this file through the TypeScript
 * AST, so the three cannot drift apart by one of them being edited.
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

/**
 * A figure exactly as it was typed, for a rule that has to judge it.
 *
 * `number()` ROUNDS AND THAT IS WRONG FOR A BOX SOMEBODY TYPES INTO. Rounding is
 * right for a proposal's hidden fields — those are our own integers making a
 * round trip, and a stray `.5` there would be a bug upstream. Here it would turn
 * 1,200.50 into 1,201 and publish a figure nobody typed, with
 * `statedBandRefusal`'s `notWholeRupees` never getting to see the slip: the
 * guard would be in the code and unreachable. A blank or unparseable box becomes
 * NaN rather than 0, so it is refused as "not whole rupees" rather than arriving
 * as a band of nothing.
 */
function rupees(data: FormData, name: string): number {
  const raw = field(data, name);
  return raw === "" ? Number.NaN : Number(raw);
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

/**
 * Publish a band a person typed.
 *
 * A FRESH SECOND FACTOR, WHERE THE OTHER TWO NEED NONE, and the difference is
 * not that this one is newer. An approval publishes a figure `proposeBand`
 * computed and `MAX_REVISION_MOVE` held inside a fifth of the band already
 * published; the worst an unlocked phone on a desk could do with it is nudge a
 * price by twenty percent toward what our own settled jobs already say. This
 * takes two numbers out of two boxes, bounded only by `STATED_BAND_MAX_FACTOR`,
 * and `freeze_booking_band()` pins the result onto every booking taken before
 * anybody notices — so putting the right band back does not undo it. That is the
 * account-takeover shape pointed at the product's own price list.
 *
 * THE FIGURES CROSS THE WIRE; THE BAND THEY ARE MEASURED AGAINST DOES NOT.
 * `stateBand` re-reads `base_price_min`/`base_price_max` itself before running
 * the typo guard, because a bound enforced against a number the form supplied is
 * a bound the browser can widen. The consistency with the comment above is worth
 * stating: what a person SAW is theirs to send, because a decision has to record
 * what was read; what a rule is ENFORCED against is ours to look up.
 *
 * NOTHING HERE TRUSTS THE FORM FOR WHO IS ASKING, because a server action is a
 * public POST reachable by anybody who can reach the page.
 */
export async function stateBandAction(
  data: FormData,
): Promise<BandDecisionResult | { ok: false; reason: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const result = await stateBand({
    slug: field(data, "slug"),
    low: rupees(data, "statedLow"),
    high: rupees(data, "statedHigh"),
    actorId: gate.profile.id,
    reason: field(data, "reason"),
  });

  if (result.ok) revalidatePath(PATH, "page");
  return result;
}
