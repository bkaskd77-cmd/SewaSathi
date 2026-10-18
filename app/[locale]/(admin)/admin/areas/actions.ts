"use server";

import { revalidatePath } from "next/cache";

import { freshAdminActor } from "@/lib/auth/admin-gate";
import {
  addArea,
  reopenArea,
  retireArea,
  type AreaWriteResult,
} from "@/lib/data/areas-admin";

/**
 * What the screen gets back.
 *
 * THE GATE'S OWN REASON IS PASSED THROUGH RATHER THAN CAST. The first draft
 * wrote `gate.reason as "refused"`, which type-checks and throws away the one
 * distinction the screen needs: `isReauthReason` keys on `reauthNeeded` to show
 * `ReauthNotice` — one sentence with a link to the code — and flattening it to
 * `refused` would have printed "that did not save" at somebody whose only
 * problem was a fifteen-minute window, with no way to find the remedy.
 */
type ActionResult = AreaWriteResult | { ok: false; reason: string };

/**
 * Open a ward, withdraw one, or serve it again.
 *
 * A FRESH SECOND FACTOR ON ALL THREE. Retiring a ward stops every future
 * booking in it — our revenue there and the work for every professional who
 * covers it — and opening one starts taking bookings somewhere we may have
 * nobody. The eight-hour admin window is for reading a queue; this is the
 * `setEnforcement` shape with a whole ward of customers behind it rather than
 * one account. All three are declared in `lib/config/admin-money.ts` and
 * `tests/unit/admin-money-reauth.test.ts` reads this file through the
 * TypeScript AST, so the gate cannot be dropped from one of them quietly.
 *
 * `revalidatePath` WITH "layout", NOT "page". A ward reaches the landing page's
 * footer links, `/services`, every category page, the booking flow's address
 * picker and `/providers/join` — the same reasoning the category content editor
 * records. Revalidating this one screen would leave a withdrawn ward in the
 * picker until something else happened to expire it.
 */

const PATH = "/[locale]";

function field(data: FormData, name: string): string {
  const raw = data.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

export async function addAreaAction(data: FormData): Promise<ActionResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  /*
   * THE WARD NUMBER IS PARSED, NEVER ROUNDED. `Number("4.5")` is 4.5 and
   * `Math.round` would make it 4 — a ward somebody did not type, keyed
   * `kathmandu-4` while they meant something else. `addArea` refuses a
   * non-integer and says so; this just has to not hide it first, which is the
   * `rupees()` lesson from the stated-band form one screen over.
   */
  const result = await addArea({
    key: field(data, "key"),
    city: field(data, "city"),
    cityNe: field(data, "cityNe"),
    wardNumber: Number(field(data, "wardNumber")),
    name: field(data, "name"),
    nameNe: field(data, "nameNe"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH, "layout");
  return result;
}

export async function retireAreaAction(
  data: FormData,
): Promise<ActionResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const result = await retireArea({
    key: field(data, "key"),
    reason: field(data, "reason"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH, "layout");
  return result;
}

export async function reopenAreaAction(
  data: FormData,
): Promise<ActionResult> {
  const gate = await freshAdminActor();
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const result = await reopenArea({
    key: field(data, "key"),
    actorId: gate.profile.id,
  });

  if (result.ok) revalidatePath(PATH, "layout");
  return result;
}
