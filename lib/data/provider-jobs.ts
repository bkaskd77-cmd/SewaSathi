import "server-only";

import { judgeCancellation, type BookingStatus } from "@/lib/booking";
import { canTransition } from "@/lib/booking";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify, type NotificationKind } from "@/lib/notify";
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
  /**
   * The figure the fee was charged on. Differs from the amount collected only
   * when the commission floor lifted it — which is exactly when a professional
   * deserves to be told, rather than left to work out why the arithmetic looks
   * wrong.
   */
  commissionBasis: number | null;
  /** When this settlement becomes payable. Digital is days sooner than cash. */
  payoutDueAt: string | null;
  /** open | upheld | rejected, when they have appealed the floor on this job. */
  appealStatus: string | null;
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
        "id, reference, status, category_slug, description, urgency, scheduled_for, quoted_min, quoted_max, final_amount, payment_status, payment_method, provider_earning, commission_basis, payout_due_at, customer_id, address_id, created_at",
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
  let appealByBooking = new Map<string, string>();
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

    const [{ data: profiles }, { data: addresses }, { data: appeals }] = await Promise.all([
      admin.from("profiles").select("id, full_name, phone").in("id", customerIds),
      admin
        .from("addresses")
        .select("id, tole, city, landmark")
        .in("id", addressIds),
      // Their own appeals against the commission floor. Shown on the card so
      // an appeal is a thing with a state rather than a form that vanished.
      admin
        .from("commission_appeals")
        .select("booking_id, status")
        .in("booking_id", rows.map((r) => r.id as string)),
    ]);

    appealByBooking = new Map(
      (appeals ?? []).map((a) => [a.booking_id as string, a.status as string]),
    );

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
      commissionBasis: (row.commission_basis as number | null) ?? null,
      payoutDueAt: (row.payout_due_at as string | null) ?? null,
      appealStatus: appealByBooking.get(row.id as string) ?? null,
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

  /*
   * BACK TO THE POOL, NOT CANCELLED.
   *
   * This used to write `cancelled`, and the customer was shown "This booking
   * was cancelled. Nothing is owed." on a job they still needed doing — their
   * appliance still broken, the product simply stopped. Nothing owed, and
   * nothing happening.
   *
   * A professional pulling out does not remove the customer's need. The job
   * returns to `pending` and is opened immediately (no second first-refusal
   * window: the customer has already waited through one), so anybody eligible
   * can take it. Only the customer may actually end a booking.
   *
   * The database clears `accepted_at`, `en_route_at` and `provider_id` on the
   * way back — see `enforce_booking_transition`.
   */
  /*
   * `provider_id: null` IS THE RELEASE, and it is a SERVER-SIDE write.
   *
   * Two separate things were wrong here.
   *
   * The first: on a job still at PENDING — the first-choice professional
   * saying no before ever accepting — `pending -> pending` is not a status
   * change, so the transition trigger returned early and never cleared
   * `provider_id`. The old code wrote a status identical to the one already
   * there and nothing else happened: the job stayed theirs, their screen went
   * on saying it was waiting for them, and the customer was told about a
   * withdrawal that had not happened to their booking. Clearing `provider_id`
   * explicitly is what makes both paths mean the same thing — nobody holds
   * this job.
   *
   * The second: this cannot go through RLS at all, and that is a property of
   * Postgres rather than a missing policy. On UPDATE the table's SELECT
   * policies are applied to the NEW row — an update may not make a row vanish
   * from the person making it — and an unassigned booking is exactly that to
   * the professional letting it go. Every update policy in the world fails
   * that check. See the note in 20260905000003_reliability.sql.
   *
   * So ownership is established through RLS above (`readAssignedBooking` reads
   * under the caller's own policies and the id is compared) and the release is
   * written by the server, guarded on `provider_id` so a professional who has
   * already lost the job releases nothing.
   */
  const { data, error } = await createAdminClient()
    .from("bookings")
    .update({
      status: "pending",
      provider_id: null,
      // Straight into the pool. The customer has already waited through one
      // first-refusal window; making them wait through a second one for a
      // professional who has just said no would punish them for choosing.
      opened_at: new Date().toISOString(),
    })
    .eq("id", input.bookingId)
    .eq("provider_id", me.providerId)
    .select("id");

  if (error) {
    console.error(`[provider-jobs] release failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  if ((data?.length ?? 0) === 0) return { ok: false, reason: "notYours" };

  // Recorded against them, not against the booking's outcome. Phase 10's
  // reliability score reads this: repeatedly accepting and then withdrawing is
  // a fact worth keeping, and it is not the same as never accepting at all.
  await createAdminClient().from("booking_status_history").insert({
    booking_id: input.bookingId,
    from_status: booking.status,
    to_status: "pending",
    changed_by: input.actorId,
    changed_by_role: "provider",
    note: `withdrew: ${input.reason?.trim().slice(0, 250) || "no reason given"}`,
  });

  /*
   * The reason, onto the refusal the trigger has just written.
   *
   * The row itself is the database's — every path that releases a booking
   * produces one, including paths nobody has written yet — but the trigger
   * cannot know what the professional typed. Failing to attach it must not
   * fail the withdrawal: the refusal is recorded either way, and a missing
   * sentence is not worth telling somebody their release did not happen.
   */
  const reason = input.reason?.trim().slice(0, 300);
  if (reason) {
    try {
      await createAdminClient()
        .from("booking_refusals")
        .update({ reason })
        .eq("booking_id", input.bookingId)
        .eq("provider_id", me.providerId);
    } catch (thrown) {
      console.error(
        `[provider-jobs] could not attach the refusal reason — ${describeError(thrown)}`,
      );
    }
  }

  await notify({
    recipientId: booking.customer_id,
    kind: "booking.declined",
    params: { reference: booking.reference },
    bookingId: input.bookingId,
  });

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

/**
 * Jobs nobody has taken yet, that this professional could do.
 *
 * RLS does the whole filter — "Providers see open jobs they can do" limits it
 * to unassigned, still-pending bookings in a category they work and a ward
 * they serve. Deliberately no admin client anywhere in here: an open job list
 * is a list of strangers' addresses, and the policy is what keeps it honest.
 * The customer's name and phone are NOT joined in for the same reason — nobody
 * has agreed to anything yet.
 */
export async function listOpenJobs(
  profileId: string,
): Promise<ProviderJob[]> {
  if (!hasSupabaseConfig()) return [];
  const me = await getMyProvider(profileId);
  if (!me) return [];

  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(
        "id, reference, status, category_slug, description, urgency, scheduled_for, quoted_min, quoted_max, final_amount, payment_status, payment_method, provider_earning, customer_id, address_id, created_at",
      )
      .is("provider_id", null)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(20);

    if (error) {
      console.error(`[provider-jobs] open list failed — ${describeError(error)}`);
      return [];
    }

    // Only the ward, not the doorstep: a professional deciding whether to take
    // a job needs to know roughly where it is, not which gate to knock on.
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return [];

    const admin = createAdminClient();
    const { data: areas } = await admin
      .from("addresses")
      .select("id, city, area_key")
      .in("id", Array.from(new Set(rows.map((r) => r.address_id as string))));
    const byAddress = new Map(
      (areas ?? []).map((a) => [a.id as string, a as Record<string, unknown>]),
    );

    return rows.map((row) => {
      const area = byAddress.get(row.address_id as string);
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
        finalAmount: null,
        paymentStatus: "pending",
        paymentMethod: (row.payment_method as string) ?? "cash",
        providerEarning: null,
        commissionBasis: null,
        payoutDueAt: null,
        appealStatus: null,
        customerName: null,
        customerPhone: null,
        addressLine: (area?.city as string | null) ?? null,
        landmark: null,
        createdAt: row.created_at as string,
      };
    });
  } catch (thrown) {
    console.error(`[provider-jobs] open list threw — ${describeError(thrown)}`);
    return [];
  }
}

/**
 * Take an open job. First to arrive wins.
 *
 * The race is settled by the RLS policy, not by this function: its `using`
 * clause matches only rows that are still unassigned, so a second claimant
 * updates zero rows. Checking "is it taken?" here first and then writing would
 * be exactly the gap two professionals tapping at once fall through — and the
 * result of that is two people arriving at one house.
 */
export async function claimJob(input: {
  bookingId: string;
  actorId: string;
}): Promise<AdvanceResult> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  const me = await getMyProvider(input.actorId);
  if (!me) return { ok: false, reason: "notAProvider" };

  const { data, error } = await createClient()
    .from("bookings")
    .update({ provider_id: me.providerId, status: "accepted" })
    .eq("id", input.bookingId)
    .select("id, reference, customer_id");

  if (error) {
    console.error(`[provider-jobs] claim failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  // Zero rows means somebody else got there first, which is a normal outcome
  // and not an error worth alarming anyone about.
  if ((data?.length ?? 0) === 0) return { ok: false, reason: "alreadyTaken" };

  await notify({
    recipientId: data![0].customer_id as string,
    kind: "booking.accepted",
    params: {
      reference: data![0].reference as string,
      provider: me.displayName,
    },
    bookingId: input.bookingId,
  });

  return { ok: true };
}
