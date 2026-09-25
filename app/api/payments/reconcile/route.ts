import "server-only";

import { NextResponse } from "next/server";

import { reconcileStuckPayments } from "@/lib/data/payments";
import { sweepRedoRecovery, sweepWriteOffs } from "@/lib/data/recovery";

/**
 * THREE SWEEPS, AND TWO OF THEM ARE NOT ABOUT PAYMENTS.
 *
 * This route was the payment reconciliation alone. It now also runs the redo
 * recovery and the write-off, and that is said here rather than left for
 * somebody to find:
 * a cron that silently grows a second responsibility is the next person's
 * surprise, and this one moves money between us and a professional.
 *
 * They share a route because they share every property that matters — both
 * are idempotent, both are safe to run late or twice, both need no session and
 * both are guarded by the same secret — and a second cron entry would be a
 * second thing to notice had stopped firing. If either ever needs its own
 * schedule, splitting them is one file and one line of `vercel.json`.
 *
 * THE RECOVERY HALF EXISTS BECAUSE IT WAS PROMISED AND NOT BUILT.
 * `applyRedoRecovery` had no caller anywhere, so `provider_outstanding` only
 * ever went up — while /providers/standards told professionals the balance was
 * one "you can watch going down". See `lib/data/recovery.ts`.
 *
 * ---
 *
 * The sweep for payments that started and never came back.
 *
 * A dropped connection mid-payment is routine on Nepali mobile data, and the
 * failure it produces is the worst one this product has: money left the
 * customer's account and our page says unpaid. The return route only runs if
 * the browser makes it back. This runs whether or not it did.
 *
 * Safe to call as often as you like — `verifyAndSettle` is idempotent and only
 * ever asks the gateway.
 *
 * `vercel.json` runs it daily, because daily is the most frequent schedule
 * every Vercel plan accepts; on Pro, tighten it to every ten minutes, which is
 * what this sweep is actually sized for. That note lives here rather than in
 * `vercel.json` because Vercel validates that file strictly and rejects any
 * property it does not know — a stray comment key there fails the deployment
 * before the build starts, which looks exactly like nothing having been pushed.
 *
 * The customer-present case does not wait for the cron: the payment panel's
 * "Check again" re-verifies on the spot.
 *
 * Guarded by `CRON_SECRET` rather than a session, because there is no user
 * here. With no secret set it refuses rather than running open: a reconcile
 * endpoint anybody can call is a way to make us hammer a gateway.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!secret || offered !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  /*
   * SEQUENTIAL, NOT `Promise.all`, and this is the one place in the product
   * where that is deliberate rather than an oversight. Reconciling can settle
   * a payment, and settling stamps `payout_due_at` — so a booking that becomes
   * due in the first half should be recoverable in the second half of the same
   * run rather than waiting a day for the next one.
   */
  const payments = await reconcileStuckPayments();
  const recovery = await sweepRedoRecovery();

  /*
   * LAST, AND THE ORDER IS THE POINT. Recovery runs first so a balance that
   * can still be collected is collected; only what survives that is written
   * off. Reversed, a dormant professional's debt would be cleared a moment
   * before a due payout could have taken a quarter of it.
   */
  const writeOffs = await sweepWriteOffs();

  return NextResponse.json(
    { payments, recovery, writeOffs },
    { headers: { "cache-control": "no-store" } },
  );
}
