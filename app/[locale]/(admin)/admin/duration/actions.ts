"use server";

import { revalidatePath } from "next/cache";

import { adminActor } from "@/lib/auth/admin-gate";
import { recordSecurityEvent } from "@/lib/audit";
import { revertDuration, type DurationRevert } from "@/lib/data/duration-loop";

/**
 * Take a published duration back down.
 *
 * NOTHING BUT THE ADDRESS CROSSES THE WIRE. The form carries the sub-band, the
 * kind and a sentence; the figure to revert to and the sample behind it are read
 * server-side off the promotion's own observation row. That is the opposite
 * choice from `approveBandAction`, which deliberately trusts the numbers the
 * screen displayed — and the reason the two differ is what the decision means.
 * An approval has to publish the figure somebody actually read, so recomputing
 * it server-side could publish one nobody saw. A revert publishes a figure
 * nobody is choosing at all: it is whatever was in force before, which only the
 * database knows. Letting a form assert it would make "revert" a way to publish
 * an arbitrary duration.
 *
 * The actor is never taken from the form — `adminActor()` already requires the
 * eight-hour step-up, and `revertDuration` writes that id onto the append-only
 * row.
 *
 * NO FIFTEEN-MINUTE RE-CHALLENGE, the `markConfirmed` reasoning: no duration
 * touches a rupee, the change is forward-only, and the loop itself will publish
 * again once the evidence moves. A code demanded for a write that cannot cost
 * anybody anything is how people learn to tap through the ones that can.
 */

const PATH = "/[locale]/(admin)/admin/duration";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function revertDurationAction(
  data: FormData,
): Promise<DurationRevert> {
  const profile = await adminActor();
  if (!profile) return { ok: false, why: "notConfigured" };

  const kind = field(data, "kind");
  if (kind !== "minutes" && kind !== "span") {
    return { ok: false, why: "notRecorded" };
  }

  const result = await revertDuration({
    categorySlug: field(data, "categorySlug"),
    bandSlug: field(data, "bandSlug"),
    kind,
    reason: field(data, "reason"),
    actorId: profile.id,
  });

  if (result.ok) {
    /*
     * AUDITED TWICE, AND THE TWO ARE NOT REDUNDANT. `duration_reverts` answers
     * "is this figure held back and what would release it", which the nightly
     * sweep has to ask on every run; this is the append-only staff-action record
     * no caller can tidy afterwards. `recordSecurityEvent` never throws, because
     * the revert has already happened.
     */
    await recordSecurityEvent({
      kind: "duration.reverted",
      actorId: profile.id,
      actorRole: "admin",
      subjectType: "category",
      subjectId: field(data, "categorySlug"),
      detail: {
        category: field(data, "categorySlug"),
        band: field(data, "bandSlug"),
        kind,
        from: result.from,
        to: result.to,
        source: result.source,
        releaseAt: result.releaseAt,
      },
    });
    revalidatePath(PATH, "page");
  }

  return result;
}
