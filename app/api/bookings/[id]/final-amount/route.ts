import { NextResponse } from "next/server";

import { getSessionProfile } from "@/lib/auth/session";
import { recordFinalAmount } from "@/lib/data/payments";

/**
 * The professional entering the figure at the end of the job.
 *
 * There is no professional's screen yet — that is Phase 8 — so this is the
 * entry point rather than a page. It exists now because without it the whole
 * payment path is unreachable: a booking with no final amount can never be
 * paid, and a flow nobody can enter is not shipped.
 *
 * It decides nothing itself. `recordFinalAmount` re-reads the booking, checks
 * that this actor is the assigned professional or an admin, checks the job has
 * actually started, and judges the amount against the band frozen on the
 * booking. All of that has to be in the data layer rather than here, because
 * the professional's app in Phase 8 will call the same function and must not
 * be able to skip a check by calling it a different way.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const profile = await getSessionProfile();
  if (!profile) {
    return NextResponse.json({ error: "notSignedIn" }, { status: 401 });
  }

  let body: { amount?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "badRequest" }, { status: 400 });
  }

  const amount = Number(body.amount);
  const reason = typeof body.reason === "string" ? body.reason : null;

  const result = await recordFinalAmount({
    bookingId: params.id,
    amount,
    reason,
    actorId: profile.id,
  });

  if (!result.ok) {
    // "notYours" is 403 and everything else 422: the difference between "you
    // may not" and "that figure is not allowed" matters to whoever is
    // debugging the professional's app.
    const status = result.reason === "notYours" ? 403 : 422;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
}
