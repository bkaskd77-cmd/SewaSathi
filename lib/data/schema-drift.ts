import "server-only";

import FINGERPRINTS from "@/supabase/function-fingerprints.json";
import { hasSupabaseConfig } from "@/lib/env";

/**
 * Does the live database hold the functions this build shipped?
 *
 * THE AXIS NOTHING LOCAL CAN SEE. `check:migrations` polices the tree against
 * itself and the column manifest polices the code against the tree, both inside
 * `npm run verify`. Neither can tell whether the LIVE database matches, because
 * migrations are applied through an MCP connection from a sandbox whose egress
 * policy blocks the database over HTTPS. A function applied but never committed,
 * or edited in a dashboard, is invisible to every check that runs before a
 * deploy.
 *
 * IT HAPPENED, AND IT COST A SECURITY HOLE FOR WEEKS.
 * `enforce_booking_immutability` in production fingerprinted `6213c2c190f1f168`
 * against the tree's `9e16a1e8854153c8`: somebody had rebuilt it from a stale
 * copy and applied that to the database only. What it had lost was the guard
 * stopping a signed-in customer writing `billable` on their own pending
 * booking, the reassignment ban, and the `provider_serves` coverage check — and
 * `authenticated` holds UPDATE on every column of that table, so the trigger
 * was the only thing in front of them.
 *
 * **THIS MODULE EXISTS BECAUSE THE COMPARISON WAS WRITTEN INSIDE A ROUTE
 * HANDLER.** It was one `/api/health` check and nothing else could reach it, so
 * the drift had exactly one reader — a health line that was already red for
 * another reason. One implementation, three callers: the health check, the
 * nightly cron, and `scripts/check-drift.mjs` through the endpoint. Two copies
 * of a comparison is how two readers come to disagree about what drift means.
 */

export type DriftReading =
  /** The comparison could not be made. Never "nothing drifted". */
  | { read: false; why: string }
  | {
      read: true;
      /** Live, and different from this build's. */
      drifted: string[];
      /** In this build and absent from the database entirely. */
      missing: string[];
      /** How many were compared, so a clean answer carries its own sample. */
      compared: number;
    };

/** Drifted or missing, in one sentence a cron error or a health line can carry. */
export function describeDrift(reading: DriftReading): string {
  if (!reading.read) return reading.why;
  if (reading.drifted.length === 0 && reading.missing.length === 0) {
    return `All ${reading.compared} match supabase/migrations.`;
  }

  return (
    [
      reading.drifted.length
        ? `${reading.drifted.length} differ from this build (${reading.drifted.slice(0, 4).join(", ")})`
        : null,
      reading.missing.length
        ? `${reading.missing.length} missing (${reading.missing.slice(0, 4).join(", ")})`
        : null,
    ]
      .filter(Boolean)
      .join("; ") +
    ". Something was applied or edited outside supabase/migrations."
  );
}

/** True only on a reading that was actually made and found nothing. */
export function matchesTree(reading: DriftReading): boolean {
  return (
    reading.read && reading.drifted.length === 0 && reading.missing.length === 0
  );
}

export async function readSchemaDrift(): Promise<DriftReading> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!hasSupabaseConfig() || !key) {
    return {
      read: false,
      why: "No service role key, so the live definitions cannot be read.",
    };
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/function_fingerprints`,
      {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: "{}",
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return {
        read: false,
        why: `function_fingerprints answered ${response.status}.`,
      };
    }

    const live = (await response.json()) as Array<{
      name: string;
      sha: string;
    }>;
    const expected = FINGERPRINTS as Record<
      string,
      { sha: string; file: string }
    >;
    const liveBy = new Map(live.map((row) => [row.name, row.sha]));

    const drifted: string[] = [];
    const missing: string[] = [];
    for (const [name, { sha }] of Object.entries(expected)) {
      const actual = liveBy.get(name);
      if (actual === undefined) missing.push(name);
      else if (actual !== sha) drifted.push(name);
    }

    return {
      read: true,
      drifted,
      missing,
      compared: Object.keys(expected).length,
    };
  } catch (error) {
    return {
      read: false,
      why: `Could not read the live definitions: ${(error as Error).message}`,
    };
  }
}
