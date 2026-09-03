import { NextResponse } from "next/server";

import { reconcileStuckPayments } from "@/lib/data/payments";

/**
 * The sweep for payments that started and never came back.
 *
 * A dropped connection mid-payment is routine on Nepali mobile data, and the
 * failure it produces is the worst one this product has: money left the
 * customer's account and our page says unpaid. The return route only runs if
 * the browser makes it back. This runs whether or not it did.
 *
 * Safe to call as often as you like — `verifyAndSettle` is idempotent and only
 * ever asks the gateway. Point a Vercel cron at it every 10 minutes.
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

  const result = await reconcileStuckPayments();
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
