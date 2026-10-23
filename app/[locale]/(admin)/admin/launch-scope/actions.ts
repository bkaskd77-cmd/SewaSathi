"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import {
  setLaunchScope,
  type ScopeWriteResult,
} from "@/lib/data/launch-scope-admin";

/**
 * Narrowing the product's reach, and widening it again.
 *
 * A FRESH SECOND FACTOR, which is `addAreaAction`'s gate and its argument with
 * a larger blast radius. Opening a ward starts taking bookings in one place;
 * turning the scope OFF opens every ward and every trade at once, and turning
 * it on with the wrong boxes ticked stops the product taking bookings at all.
 * The eight-hour admin window is for reading a queue. Declared in
 * `lib/config/admin-money.ts` so `tests/unit/admin-money-reauth.test.ts` reads
 * this file through the TypeScript AST and fails if the gate is ever dropped.
 *
 * THE GATE'S OWN REASON IS PASSED THROUGH RATHER THAN CAST, the mistake that
 * action's comment records: `isReauthReason` keys on `reauthNeeded` to render
 * `ReauthNotice`, so flattening it to `refused` would print "that did not
 * save" at somebody whose only problem was a fifteen-minute window, with no
 * way to find the remedy.
 *
 * `revalidatePath` WITH "layout", NOT "page". The scope reaches the landing
 * grid, `/services`, every category page and the booking flow's two pickers —
 * `setLaunchScope` already calls `updateTag`, which covers the cached read, and
 * this is what re-renders the Server Components that consumed it. Revalidating
 * this one screen would leave a widening invisible everywhere it matters.
 */

const PATH = "/[locale]";

export async function setLaunchScopeAction(
  data: FormData,
): Promise<ScopeWriteResult | { ok: false; reason: string }> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  /*
   * `getAll` RATHER THAN `get`, because an unticked checkbox sends nothing and
   * a single `get` would read one ward out of eight. The empty case is the one
   * that has to work: unticking everything is how somebody closes the product
   * on purpose, and reading it as "no change" would make that unexpressible.
   */
  const areaKeys = data.getAll("area").filter((v): v is string => typeof v === "string");
  const categorySlugs = data
    .getAll("category")
    .filter((v): v is string => typeof v === "string");

  const note = data.get("note");

  const result = await setLaunchScope({
    /*
     * THE SWITCH IS READ FROM ITS OWN FIELD, never inferred from the lists
     * being empty — `lib/config/launch-scope.ts` argues that in full, and the
     * form carries a hidden input so an unchecked box is `false` rather than
     * absent.
     */
    enabled: data.get("enabled") === "on" || data.get("enabled") === "true",
    areaKeys,
    categorySlugs,
    note: typeof note === "string" ? note : null,
    actorId: gate.profile.id,
  });

  /*
   * ONLY ON SUCCESS. Revalidating after a refusal would throw away every
   * visitor's cached catalogue to change nothing — and it would make a failed
   * save look like a successful one to anybody watching the pages move.
   */
  if (result.ok) revalidatePath(PATH, "layout");

  return result;
}
