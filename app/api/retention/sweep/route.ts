import { NextResponse } from "next/server";

import { sweepRetention, retentionPolicy } from "@/lib/data/retention";

/**
 * Apply the retention policy, or report what it would apply.
 *
 * Guarded by `CRON_SECRET` and refusing everything when that is unset, the
 * same rule as the payment reconciliation and the dispatch sweep: an endpoint
 * that deletes data must not be reachable because somebody forgot to set a
 * variable.
 *
 * It is a dry run unless `RETENTION_ENABLED=true`. That is deliberate and it
 * is the whole shape of this feature: the durations in
 * `lib/retention/policy.ts` are a proposal, and the only safe way to evaluate
 * a proposal is to see how many rows it would touch before it touches any.
 * Run it unarmed, read the counts, then arm it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!secret || offered !== secret) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const report = await sweepRetention();

  return NextResponse.json(
    {
      ...report,
      policy: retentionPolicy(),
      hint: report.armed
        ? "Armed: rows past their date were changed."
        : "Dry run. Nothing was touched. Set RETENTION_ENABLED=true to arm it.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
