import "server-only";

import { judgeCancellation, type BookingStatus } from "@/lib/booking";
import { canTransition } from "@/lib/booking";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify, notifyAll, type NotificationKind } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * The professional's side of a job.
 *
 * Minimal on purpose — Phase 10 is the real provider dashboard. What is here
 * is exactly what it takes for one booking to go from pending to paid with a
 * real person on each end, because until that is possible none of the customer
 * side can actually be seen working.
 *
 * Reads go through RLS: the "Providers read their assigned bookings" policy
 * already limits a professional to their own work, so this file does not
 * re-filter — doing it twice would hide a policy bug rather than surface it.
 * Writes re-read and re-judge, the same rule the payments layer follows.
 */

export type ProviderIdentity = {
  providerId: string;
  displayName: string;
};

/** The provider row linked to the signed-in profile, if there is one. */
export async function getMyProvider(
  profileId: string,
): Promise<ProviderIdentity | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data } = await createClient()
      .from("providers")
      .select("id, display_name")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (!data) return null;
    return {
      providerId: data.id as string,
      displayName: data.display_name as string,
    };
  } catch {
    return null;
  }
}

export type ProviderJob = {
  id: string;
  reference: string;
  status: BookingStatus;
  categorySlug: string;
  description: string;
  urgency: string;
  scheduledFor: string | null;
  quotedMin: number;
  quotedMax: number;
  finalAmount: number | null;
  /** pending | paid — the booking's own payment state, not a payment row. */
  paymentStatus: string;
  paymentMethod: string;
  /** What this professional keeps, frozen at settlement. Null until paid. */
  providerEarning: number | null;
  customerName: string | null;
  customerPhone: string | null;
  addressLine: string | null;
  landmark: string | null;
  createdAt: string;
};

/**
 * Every job assigned to this professional, newest first.
 *
 * The customer's name, phone and address come through the admin client, and
 * that is a deliberate, narrow exception: a professional needs to reach the
 * person whose kitchen they are going to, and no RLS policy grants a provider
 * a read on `profiles` or `addresses`. Rather than widening those policies —
 * which would expose every customer to every provider — the join happens here,
 * after the booking list has already been filtered by RLS to this
 * professional's own jobs. The set is bounded by what they were assigned.
 */
export async function listProviderJobs(
  profileId: string,
): Promise<ProviderJob[]> {
  if (!hasSupabaseConfig()) return [];

  const me = await getMyProvider(profileId);
  if (!me) return [];

  // The jobs themselves, through RLS. Its own try: this is the list, and
  // nothing below is allowed to take it down.
  let rows: Record<string, unknown>[] = [];
  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(
        "id, reference, status, category_slug, description, urgency, scheduled_for, quoted_min, quoted_max, final_amount, payment_status, payment_method, provider_earning, customer_id, address_id, created_at",
      )
      .eq("provider_id", me.providerId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error(`[provider-jobs] list failed — ${describeError(error)}`);
      return [];
    }
    rows = (data ?? []) as Record<string, unknown>[];
  } catch (thrown) {
    console.error(`[provider-jobs] list threw — ${describeError(thrown)}`);
    return [];
  }

  if (rows.length === 0) return [];

  /*
   * Who to call, and where to go — and DELIBERATELY not in the same try as the
   * list above.
   *
   * This half needs the admin client, because no RLS policy grants a provider
   * a read on `profiles` or `addresses`; widening those would expose every
   * customer to every professional, so the join happens here instead, over a
   * set RLS has already narrowed to this professional's own jobs.
   *
   * The first version wrapped both halves in one try. When the service role
   * key was absent the enrichment threw, the catch returned [], and a
   * professional with two live jobs was shown "No jobs yet" — a missing
   * customer name silently deleting the work. Now it degrades: the jobs
   * render, the name and address are null, and the failure is logged rather
   * than swallowed.
   */
  let byProfile = new Map<string, Record<string, unknown>>();
  let byAddress = new Map<string, Record<string, unknown>>();
  try {
    const admin = createAdminClient();
    // Array.from rather than spreading a Set: the tsconfig target predates
    // downlevel iteration, same note as the payments callback reader.
    const customerIds = Array.from(
      new Set(rows.map((r) => r.customer_id as string)),
    );
    const addressIds = Array.from(
      new Set(rows.map((r) => r.address_id as string)),
    );

    const [{ data: profiles }, { data: addresses }] = await Promise.all([
      admin.from("profiles").select("id, full_name, phone").in("id", customerIds),
      admin
        .from("addresses")
        .select("id, tole, city, landmark")
        .in("id", addressIds),
    ]);

    byProfile = new Map(
      (profiles ?? []).map((p) => [p.id as string, p as Record<string, unknown>]),
    );
    byAddress = new Map(
      (addresses ?? []).map((a) => [a.id as string, a as Record<string, unknown>]),
    );
  } catch (thrown) {
    console.error(
      `[provider-jobs] could not load customer details — ${describeError(thrown)}. Jobs are still listed without them.`,
    );
  }

  return rows.map((row) => {
    const profile = byProfile.get(row.customer_id as string);
    const address = byAddress.get(row.address_id as string);
    return {
      id: row.id as string,
      reference: row.reference as string,
      status: row.status as BookingStatus,
      categorySlug: row.category_slug as string,
      description: row.description as string,
      urgency: row.urgency as string,
      scheduledFor: (row.scheduled_for as string | null) ?? null,
      quotedMin: row.quoted_min as number,
      quotedMax: row.quoted_max as number,
      finalAmount: (row.final_amount as number | null) ?? null,
      paymentStatus: (row.payment_status as string) ?? "pending",
      paymentMethod: (row.payment_method as string) ?? "cash",
      providerEarning: (row.provider_earning as number | null) ?? null,
      customerName: (profile?.full_name as string | null) ?? null,
      customerPhone: (profile?.phone as string | null) ?? null,
      addressLine: address
        ? `${address.tole as string}, ${address.city as string}`
        : null,
      landmark: (address?.landmark as string | null) ?? null,
      createdAt: row.created_at as string,
    };
  });
}

/** What the notification catalogue calls each arrival. */
const ARRIVAL_KIND: Partial<Record<BookingStatus, NotificationKind>> = {
  accepted: "booking.accepted",
  en_route: "booking.en_route",
  in_progress: "booking.in_progress",
  completed: "booking.completed",
};

/**
 * The booking a professional is acting on, read the same way the screen read it.
 *
 * RLS-scoped deliberately. The policy is the authority on whether this
 * professional may see the row at all, so using it here means the check is
 * exercised on every real request rather than only in the db suite — and it
 * removes a service-role dependency from a path that never needed one.
 *
 * Null covers "no such booking" and "not yours" alike, which is the right
 * answer to both.
 */
async function readAssignedBooking(bookingId: string) {
  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select("id, reference, status, provider_id, customer_id")
      .eq("id", bookingId)
      .maybeSingle();
    if (error) {
      console.error(`[provider-jobs] read failed — ${describeError(error)}`);
      return null;
    }
    return data as {
      id: string;
      reference: string;
      status: string;
      provider_id: string | null;
      customer_id: string;
    } | null;
  } catch (thrown) {
    console.error(`[provider-jobs] read threw — ${describeError(thrown)}`);
    return null;
  }
}

type AdvanceResult = { ok: true } | { ok: false; reason: string };

/**
 * Move a job to its next status.
 *
 * Four things have to agree and all four already existed: the RLS policy
 * limits which rows this professional may update at all, the database trigger
 * rejects an illegal transition, `canTransition` decides whether the button was
 * ever drawn, and the ownership check here re-reads rather than trusting the
 * id it was handed. This function adds the fifth thing — telling the customer.
 */
export async function advanceJob(input: {
  bookingId: string;
  to: BookingStatus;
  actorId: string;
}): Promise<AdvanceResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const me = await getMyProvider(input.actorId);
  if (!me) return { ok: false, reason: "notAProvider" };

  // Through RLS, not the admin client. The "Providers read their assigned
  // bookings" policy already grants exactly this row, so reaching for the
  // service role bought nothing and cost everything: with the key absent,
  // `createAdminClient()` throws, the server action rejects, and every button
  // on the screen says "that didn't work" with no way to tell why.
  const booking = await readAssignedBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.provider_id !== me.providerId) {
    return { ok: false, reason: "notYours" };
  }

  const from = booking.status as BookingStatus;
  if (!canTransition(from, input.to)) {
    return { ok: false, reason: "illegalTransition" };
  }

  // Through the RLS-scoped client on purpose: the policy is what actually
  // enforces this, and using the admin client here would mean the policy was
  // never exercised in production and only ever tested in the db suite.
  const { data, error } = await createClient()
    .from("bookings")
    .update({ status: input.to })
    .eq("id", input.bookingId)
    .select("id");

  if (error) {
    console.error(`[provider-jobs] advance failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  if ((data?.length ?? 0) === 0) return { ok: false, reason: "notYours" };

  const kind = ARRIVAL_KIND[input.to];
  if (kind) {
    await notify({
      recipientId: booking.customer_id as string,
      kind,
      params: { reference: booking.reference as string, provider: me.displayName },
      bookingId: input.bookingId,
    });
  }

  return { ok: true };
}

/**
 * The professional pulls out.
 *
 * A separate function from `advanceJob` even though both write `cancelled`,
 * because they are different events with different windows and a different
 * thing to say afterwards. `cancelled_by_role` is what makes them
 * distinguishable later — Phase 10's reliability score reads it.
 */
export async function declineJob(input: {
  bookingId: string;
  actorId: string;
  reason: string | null;
}): Promise<AdvanceResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const me = await getMyProvider(input.actorId);
  if (!me) return { ok: false, reason: "notAProvider" };

  const booking = await readAssignedBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "notFound" };
  if (booking.provider_id !== me.providerId) {
    return { ok: false, reason: "notYours" };
  }

  const verdict = judgeCancellation(booking.status as BookingStatus, "provider");
  if (!verdict.allowed) return { ok: false, reason: verdict.reason };

  const { data, error } = await createClient()
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_by: "provider",
      cancelled_by_role: "provider",
      cancellation_fee: verdict.fee,
      cancellation_reason: input.reason?.trim().slice(0, 300) || null,
    })
    .eq("id", input.bookingId)
    .select("id");

  if (error) {
    console.error(`[provider-jobs] decline failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  if ((data?.length ?? 0) === 0) return { ok: false, reason: "notYours" };

  await notifyAll([
    {
      recipientId: booking.customer_id as string,
      kind: "booking.declined",
      params: { reference: booking.reference as string },
      bookingId: input.bookingId,
    },
  ]);

  return { ok: true };
}

/**
 * The professional's phone, for the customer's call button.
 *
 * Read through RLS, which is the whole security model here: the policy on
 * `provider_contacts` hands it out only while a job of theirs is accepted, on
 * the way or under way. Null therefore means "not yours to see" and "not
 * recorded" alike, and the caller shows the support line for both — which is
 * the right answer to both.
 */
export async function getProviderPhone(
  providerId: string,
): Promise<string | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data } = await createClient()
      .from("provider_contacts")
      .select("phone")
      .eq("provider_id", providerId)
      .maybeSingle();
    return (data?.phone as string | null) ?? null;
  } catch {
    return null;
  }
}
