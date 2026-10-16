"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import { AI_LIMIT_KEYS, type AiLimits } from "@/lib/config/ai-limits";
import { saveAiLimits } from "@/lib/data/ai-ceilings";

/**
 * Move a ceiling.
 *
 * A FRESH SECOND FACTOR, THE SAME FIFTEEN MINUTES A PAYOUT NEEDS, and the reason is the
 * same one: this is a field that spends money. A budget raised from one dollar to a
 * hundred is a hundred-dollar decision taken in one box, and the eight-hour admin
 * step-up is for batched work rather than for an act with a price on it.
 *
 * THE PROOF IS READ FROM THE SESSION AND NEVER FROM THE FORM. `freshAdminActor()`
 * takes it off the `amr` claim, which carries the moment somebody actually proved who
 * they were — deliberately not `iat`, which resets on every silent refresh, so a gate
 * reading it would mean "recently active", which is exactly what a stolen session is.
 *
 * IT USED TO DO THAT SUBTRACTION ITSELF, which was one rule written twice: the window
 * was enforced here and in `lib/data/payouts.ts` by two pieces of arithmetic with no
 * way to disagree loudly. `lib/config/admin-money.ts` is the list now and a test reads
 * this source.
 *
 * NOTHING HERE TRUSTS THE FORM FOR WHO IS ASKING either, because a server action is a
 * public POST reachable by anybody who can reach the page.
 */
export async function saveAiLimitsAction(
  data: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, error: gate.reason };
  const actor = gate.profile;

  const next: Partial<AiLimits> = {};
  for (const key of AI_LIMIT_KEYS) {
    const raw = data.get(key);
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const value = Number(raw);
    /* A field that is not a number is left out rather than defaulted to zero: a slip in
       one box must not silently set that ceiling to "refuse everybody". */
    if (Number.isFinite(value)) next[key] = value;
  }

  const result = await saveAiLimits({ next, actorId: actor.id });
  if (!result.ok) return { ok: false, error: result.reason };

  revalidatePath("/[locale]/(admin)/admin/ai-limits", "page");
  return { ok: true };
}
