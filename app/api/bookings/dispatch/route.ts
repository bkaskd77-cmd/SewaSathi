import "server-only";

import { NextResponse } from "next/server";

import { sweepDispatch } from "@/lib/data/dispatch";
import { sweepDurationPromotions } from "@/lib/data/duration-loop";
import { publishDueReviews } from "@/lib/data/reviews";
import { expireStaleQuotes } from "@/lib/data/survey";
import { hasSupabaseConfig } from "@/lib/env";
import { cronTokenAccepted } from "@/lib/security/cron-token";
import { recordCronRun } from "@/lib/data/cron-runs";
import {
  describeDrift,
  matchesTree,
  readSchemaDrift,
} from "@/lib/data/schema-drift";

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
  if (
    !cronTokenAccepted(
      process.env.CRON_SECRET,
      request.headers.get("authorization"),
    )
  ) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasSupabaseConfig()) {
    return NextResponse.json({ error: "notConfigured" }, { status: 503 });
  }

  // The run records itself — see lib/config/cron.ts. A sweep that correctly
  // finds nothing due leaves no other trace that it happened.
  const startedAt = new Date();

  try {
    /*
     * The quote sweep rides along rather than getting a cron of its own. Both
     * answer the same question — "is this booking still waiting on something
     * that has already run out?" — both are idempotent, and a second scheduled
     * endpoint is a second thing that can silently stop running.
     */
    /*
     * THE DURATION LOOP RIDES ALONG TOO, for the same reasons and one more.
     * Hobby allows two schedules and both are taken; it is idempotent, so
     * running late or twice writes the same answer; and it belongs on the
     * BOOKING cron rather than the payments one because nothing it does touches
     * money, and `/api/payments/reconcile` is the route that holds the
     * service-role key on a money path.
     *
     * In the same `Promise.all` because it depends on none of the others: it
     * reads completed bookings and writes sub-band durations, where the three
     * above read and write bookings that are still open.
     */
    const [result, quotes, reviews, durations] = await Promise.all([
      sweepDispatch(),
      expireStaleQuotes(),
      publishDueReviews(),
      sweepDurationPromotions(),
    ]);

    const summary = {
      ...result,
      quotesExpired: quotes.expired,
      reviewsPublished: reviews.published,
      durations,
    };

    /*
     * AND THE NIGHTLY DRIFT CHECK, WHICH FAILS THE RUN RATHER THAN A LINE.
     *
     * `db.functions` on `/api/health` has compared the live function
     * fingerprints against the build's since the day it shipped, and it caught
     * real drift — a trigger in production missing the guard that stops a
     * customer writing `billable` on their own booking — and nothing happened,
     * because that endpoint was already red over the SMS gateway. A finding
     * whose only channel is a health line nobody reads is not a finding.
     *
     * So the sweep carries it too, and a mismatch makes the run FAIL: the
     * `cron_runs` row records `ok: false` with the drifted names, and the route
     * answers 503 so Vercel's cron log shows a failed invocation. A run that
     * found an unfiled schema change did not have a good night.
     *
     * IT RUNS AFTER THE SWEEPS AND THE RECORD CARRIES THEM. Everything above
     * has already committed and its summary is in the row, so nothing is lost
     * by the failure — and a retry re-runs only idempotent work.
     *
     * A READ THAT FAILED IS NOT A PASS AND IS NOT A FAILURE EITHER. No service
     * role key means nobody looked, which is the `unknown` the health check
     * reports; failing the cron for it would page somebody about a missing
     * variable every night.
     */
    const drift = await readSchemaDrift();
    const drifted = drift.read && !matchesTree(drift);

    await recordCronRun({
      job: "/api/bookings/dispatch",
      startedAt,
      ok: !drifted,
      summary: { ...summary, schema: describeDrift(drift) },
      error: drifted ? `Schema drift: ${describeDrift(drift)}` : undefined,
    });

    if (drifted) {
      return NextResponse.json(
        { ...summary, error: "schemaDrift", schema: describeDrift(drift) },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return NextResponse.json(
      { ...summary, schema: describeDrift(drift) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (thrown) {
    await recordCronRun({
      job: "/api/bookings/dispatch",
      startedAt,
      ok: false,
      error: thrown instanceof Error ? thrown.message : String(thrown),
    });
    throw thrown;
  }
}
