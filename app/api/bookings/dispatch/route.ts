import { NextResponse } from "next/server";

import { sweepDispatch } from "@/lib/data/dispatch";
import { hasSupabaseConfig } from "@/lib/env";

/**
 * The sweep that keeps a promise.
 *
 * The customer is told "we are alerting professionals now". Without this, a
 * booking sat assigned to one person for ever: if they never opened the app,
 * nobody was alerted, nothing escalated, and the customer waited for a call
 * that was never coming.
 *
 * The rules are in `lib/booking/dispatch.ts` and applying them is
 * `lib/data/dispatch.ts` — deliberately not here, because the customer's
 * "check now" button runs exactly the same code. An escalation rule with two
 * implementations escalates differently depending on who asked, and the
 * difference stays invisible until somebody's emergency sits unwidened.
 *
 * Idempotent: every decision comes from the booking's own timestamps, so
 * running late, twice or overlapping changes nothing. Guarded by `CRON_SECRET`
 * and refusing outright when that is unset — it reassigns work and closes
 * bookings, so an open endpoint is not an option.
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
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "notConfigured" }, { status: 503 });
  }

  const result = await sweepDispatch();
  return NextResponse.json(result, {
    headers: { "cache-control": "no-store" },
  });
}
