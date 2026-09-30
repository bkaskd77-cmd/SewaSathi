import "server-only";

import { NextResponse } from "next/server";

import { sweepApplicationSealing } from "@/lib/data/application-sealing";

/**
 * Seal the account numbers already written, and re-key the digests beside them.
 *
 * Guarded by `CRON_SECRET` and refusing everything when that is unset — the same
 * rule as the payment reconciliation, the dispatch sweep and the retention sweep.
 * An endpoint that rewrites stored personal data must not become reachable
 * because somebody forgot to set a variable.
 *
 * A DRY RUN UNLESS `?armed=1`. It reports what it would touch first, because the
 * only safe way to evaluate a pass over live rows is to count them before
 * changing any. Re-running armed is a no-op: `isSealed` decides per row, so
 * "has this been done" is answered by the data rather than by a flag somebody
 * has to keep correct.
 *
 * WHY THIS IS A URL AND NOT A SCRIPT. The key is a Vercel variable, so the
 * conversion has to run where that variable exists — not from a developer's
 * machine and not through the database, which deliberately does not hold the key.
 * Nothing in this repository can reach the project's host directly.
 *
 * IT IS NOT A CRON. It is a one-shot with a life expectancy: once
 * `remainingPlaintext` is 0 and the shape constraint lands, this route and its
 * module can be deleted. That sentence is here so it is not still sitting in the
 * route table in a year with nobody sure whether anything calls it.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const offered =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";

  if (!secret || offered !== secret) {
    return NextResponse.json(
      {
        error: "unauthorized",
        // WHICH REFUSAL THIS IS. An unset secret means no token will ever work,
        // which used to read exactly like a mistyped one — the same fix as
        // `/api/health?deep=1`.
        reason: secret ? "wrong-token" : "CRON_SECRET is not set",
      },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const armed = new URL(request.url).searchParams.get("armed") === "1";
  const report = await sweepApplicationSealing({ armed });

  return NextResponse.json(
    {
      ...report,
      hint: armed
        ? report.remainingPlaintext === 0
          ? "Done. Every account number is sealed; the shape constraint can land."
          : `${report.remainingPlaintext} still plaintext — read the log and run again.`
        : "Dry run. Nothing was changed. Add ?armed=1 to convert.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
