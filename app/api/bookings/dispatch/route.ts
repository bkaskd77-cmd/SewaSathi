import { NextResponse } from "next/server";

import { dispatchStage, type Urgency } from "@/lib/booking";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The sweep that keeps a promise.
 *
 * The customer is told "we are alerting professionals now". Without this, a
 * booking sat assigned to one person for ever: if they never opened the app,
 * nobody was alerted, nothing escalated, and the customer waited for a call
 * that was never coming. Silence is the worst possible answer, and it is the
 * one that loses somebody permanently.
 *
 * Two things happen here, both from the booking's own age — see
 * `lib/booking/dispatch.ts` for the windows and why each is what it is.
 *
 *   first refusal lapses -> `provider_id` is cleared and `opened_at` stamped,
 *                           so every eligible professional can see and claim
 *                           it. The customer's choice is preserved on
 *                           `first_choice_provider_id`.
 *
 *   give-up passes       -> the booking ends at `no_provider_found`. Telling
 *                           somebody we could not find anyone is a bad answer;
 *                           leaving them to infer it from silence is worse.
 *
 * Idempotent: it re-derives the stage from timestamps rather than tracking
 * where it got to, so running it twice, late, or overlapping changes nothing.
 * Guarded by `CRON_SECRET` and refusing outright when that is unset — this
 * reassigns work and cancels bookings, so an open endpoint is not an option.
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

  const supabase = createAdminClient();
  const { data } = await supabase
    .from("bookings")
    .select(
      "id, reference, customer_id, provider_id, urgency, created_at, opened_at",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(200);

  const now = new Date();
  let opened = 0;
  let abandoned = 0;

  for (const row of data ?? []) {
    const stage = dispatchStage(
      row.created_at as string,
      (row.urgency as Urgency) ?? "routine",
      now,
    );

    if (stage === "give-up") {
      // Guarded on `status` so a professional accepting in the same second
      // wins rather than having their job cancelled underneath them.
      const { data: closed } = await supabase
        .from("bookings")
        .update({ status: "no_provider_found" })
        .eq("id", row.id as string)
        .eq("status", "pending")
        .select("id");

      if ((closed?.length ?? 0) > 0) {
        abandoned += 1;
        await notify({
          recipientId: row.customer_id as string,
          kind: "booking.noProviderFound",
          params: { reference: row.reference as string },
          bookingId: row.id as string,
        });
      }
      continue;
    }

    if (stage === "open" && !row.opened_at) {
      // Clearing provider_id is what makes it visible to everybody else; the
      // customer's original choice was copied to first_choice_provider_id when
      // the booking was made, so nothing about their decision is lost.
      const { data: widened } = await supabase
        .from("bookings")
        .update({ provider_id: null, opened_at: now.toISOString() })
        .eq("id", row.id as string)
        .eq("status", "pending")
        .select("id");

      if ((widened?.length ?? 0) > 0) {
        opened += 1;
        await notify({
          recipientId: row.customer_id as string,
          kind: "booking.widened",
          params: { reference: row.reference as string },
          bookingId: row.id as string,
        });
      }
    }
  }

  return NextResponse.json(
    { checked: data?.length ?? 0, opened, abandoned },
    { headers: { "cache-control": "no-store" } },
  );
}
