import "server-only";

import {
  recordContactAccess,
  recordRiskAccess,
  recordSecurityEvent,
} from "@/lib/audit";
import type { Booking } from "@/lib/data/bookings";
import {
  getBooking,
  getBookingHistory,
  listRefusals,
  type StatusEvent,
} from "@/lib/data/bookings";
import { claimsForBooking } from "@/lib/data/claims";
import { customerHistory } from "@/lib/data/customer-risk";
import { readHandle, phoneSuffix, type Handle } from "@/lib/data/handles";
import {
  findPaymentByReference,
  listPaymentsForBooking,
  type Payment,
} from "@/lib/data/payments";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * One booking, everything about it, for somebody on a support call.
 *
 * WHY THIS IS A SCREEN AND NOT A QUERY SOMEBODY RUNS. Every fact here is
 * already readable by an admin through PostgREST or the Supabase dashboard,
 * and that is exactly the problem `lib/audit` complains about: those reads
 * leave no trace. A screen that logs is not a widening of what an admin can
 * see — it is the first version of that access anybody can account for
 * afterwards.
 *
 * THE LOG GOES IN HERE, NOT IN THE PAGE. `applicationForReview` settled this
 * shape: the read logs itself, before it returns, so the caller cannot forget
 * and a second caller added later inherits it. A page that remembered to log
 * would be a page somebody could copy without the line.
 *
 * WHAT THE LOG MAY NOT CONTAIN. The handle KIND and the RESOLVED ids, never
 * the string that was typed. A phone number in `detail` would make the audit
 * log a second copy of the thing it exists to protect, searchable by anybody
 * who can read the log — and the log is readable by every admin, which is a
 * wider circle than the one screen. Same rule as `recordContactAccess`
 * carrying a count rather than the numbers.
 */

export type LookupResult =
  | { found: false; reason: "none" | "notFound" | "impossible"; offending?: string }
  | {
      found: true;
      booking: Booking;
      /** Null when the admin client could not read it, not when there is none. */
      address: LookupAddress | null;
      customer: LookupPerson | null;
      provider: LookupPerson | null;
      payments: Payment[];
      history: StatusEvent[];
      refusals: Array<{ providerId: string; kind: string; createdAt: string }>;
      claims: Array<{ id: string; status: string; openedAt: string }>;
      risk: { noShows: number; falseAddresses: number; completedJobs: number; tripDebt: number; banned: boolean };
    };

export type LookupPerson = { id: string; name: string | null; phone: string | null };
export type LookupAddress = {
  city: string;
  wardNumber: number;
  tole: string;
  landmark: string;
  directionsNote: string | null;
};

/**
 * Resolve whatever was typed to a booking id, without reading anything else.
 *
 * Separated so the expensive half only runs once there is something to read,
 * and so a search that resolves nothing still logs that it happened — an admin
 * trying six phone numbers in a row is a thing the log should show.
 */
async function resolveToBooking(handle: Handle): Promise<string | null> {
  const admin = createAdminClient();

  if (handle.kind === "reference") {
    const booking = await getBooking(handle.value);
    return booking?.id ?? null;
  }

  if (handle.kind === "paymentReference") {
    const hit = await findPaymentByReference(handle.value);
    return hit?.bookingId ?? null;
  }

  if (handle.kind === "phone") {
    /*
     * A SEQUENTIAL SCAN, KNOWINGLY. `profiles.phone` carries no index and no
     * unique constraint — unlike `provider_contacts.phone`, which at least has
     * a format check. At the current size that costs nothing and saying so is
     * cheaper than discovering it later; if this screen ever gets used in
     * anger, an index on `lower(phone)` is the fix.
     *
     * Matched on the last nine digits because the column has no format check
     * either, so `+9779800000011` and `9800000011` are the same person written
     * two ways.
     */
    const suffix = phoneSuffix(handle.value);
    const { data, error } = await admin
      .from("profiles")
      .select("id, phone")
      .not("phone", "is", null)
      .limit(500);

    if (error) {
      console.error(`[lookup] phone scan failed — ${describeError(error)}`);
      return null;
    }

    const match = (data ?? []).find((row) =>
      String(row.phone ?? "").replace(/\D/g, "").endsWith(suffix),
    );
    if (!match) return null;

    // Their most recent booking. A support call is nearly always about the
    // last one, and the screen carries the reference so the next search is
    // exact.
    const { data: rows } = await admin
      .from("bookings")
      .select("id")
      .eq("customer_id", match.id as string)
      .order("created_at", { ascending: false })
      .limit(1);
    return (rows?.[0]?.id as string | undefined) ?? null;
  }

  return null;
}

export async function lookup(input: {
  query: string;
  adminId: string;
}): Promise<LookupResult> {
  const handle = readHandle(input.query);

  if (handle.kind === "none") return { found: false, reason: "none" };
  if (handle.kind === "impossibleReference") {
    // Nothing was read, so nothing is logged: this never reached a record.
    return { found: false, reason: "impossible", offending: handle.offending };
  }
  if (!hasSupabaseConfig()) return { found: false, reason: "notFound" };

  const bookingId = await resolveToBooking(handle).catch((thrown) => {
    console.error(`[lookup] resolve threw — ${describeError(thrown)}`);
    return null;
  });

  /*
   * EVERY SEARCH IS LOGGED, INCLUDING THE ONES THAT FIND NOTHING. Six phone
   * numbers tried in a row and none of them ours is a pattern worth being able
   * to see later, and a log that only recorded hits would hide it.
   */
  await recordSecurityEvent({
    kind: "lookup.searched",
    actorId: input.adminId,
    actorRole: "admin",
    subjectType: bookingId ? "booking" : undefined,
    subjectId: bookingId,
    // The kind, never the string. See the note at the top of this file.
    detail: { handle: handle.kind, found: Boolean(bookingId) },
  });

  if (!bookingId) return { found: false, reason: "notFound" };

  const booking = await getBooking(bookingId);
  if (!booking) return { found: false, reason: "notFound" };

  const admin = createAdminClient();

  /*
   * `Booking` carries no `customerId`: it is the customer's own view of their
   * own job and never needed to say whose it was. An admin looking at somebody
   * else's booking does, so it is read here rather than widening a type every
   * customer screen also uses.
   */
  const { data: owner } = await admin
    .from("bookings")
    .select("customer_id")
    .eq("id", booking.id)
    .maybeSingle();
  const customerId = (owner?.customer_id as string | undefined) ?? null;

  const [address, customer, provider, payments, history, refusals, claims, risk] =
    await Promise.all([
      readAddress(admin, booking.addressId),
      customerId ? readPerson(admin, customerId) : Promise.resolve(null),
      booking.providerId ? readProvider(admin, booking.providerId) : Promise.resolve(null),
      listPaymentsForBooking(booking.id),
      getBookingHistory(booking.id),
      listRefusals(booking.id),
      claimsForBooking(booking.id).then((rows) =>
        rows.map((row) => ({ id: row.id, status: row.status, openedAt: row.openedAt })),
      ),
      customerId
        ? customerHistory(customerId)
        : Promise.resolve({
            noShows: 0,
            falseAddresses: 0,
            completedJobs: 0,
            tripDebt: 0,
            banned: false,
          }),
    ]);

  /*
   * The numbers that reached the screen, counted rather than copied. Logged
   * before the return, so the page cannot render them without this having run.
   */
  const shown = [customer?.phone, provider?.phone].filter(Boolean).length;
  if (shown > 0 && customerId) {
    await recordContactAccess({
      adminId: input.adminId,
      subjectId: customerId,
      count: shown,
      reason: `Support lookup on booking ${booking.reference}.`,
    });
  }

  /*
   * THE RISK RECORD IS ITS OWN ACCESS, AND THIS IS THE FIRST CALLER
   * `recordRiskAccess` HAS EVER HAD. It was written in Phase 10, documented,
   * and never wired — a helper that records nothing is the same as not having
   * one. This screen fits it exactly: one customer, named, and the no-shows and
   * false addresses beside their phone number.
   *
   * `action` is "nothing" because a lookup usually ends in a conversation
   * rather than a decision, and the docstring names that as a real answer. The
   * decisions that DO follow are logged where they happen.
   */
  if (customerId) {
    await recordRiskAccess({
      adminId: input.adminId,
      customerId,
      reason: `Support lookup on booking ${booking.reference}.`,
      action: "nothing",
    });
  }

  return {
    found: true,
    booking,
    address,
    customer,
    provider,
    payments,
    history,
    refusals,
    claims,
    risk,
  };
}

/**
 * The address, through the service role, because RLS gives admins none.
 *
 * `addresses` is admin-`none` in `docs/rls-matrix.md`, and "where is he meant
 * to be?" is the most useful sentence on a support call. The alternative was an
 * `Admins read every address` policy, which would widen the untraceable
 * PostgREST route `lib/audit` already warns about to include everybody's home.
 * Reading it here keeps the access inside a function that logs — the same
 * trade `customerHistory` and `applicationForReview` already make.
 */
async function readAddress(
  admin: ReturnType<typeof createAdminClient>,
  addressId: string,
): Promise<LookupAddress | null> {
  const { data, error } = await admin
    .from("addresses")
    .select("city, ward_number, tole, landmark, directions_note")
    .eq("id", addressId)
    .maybeSingle();

  if (error) {
    console.error(`[lookup] address failed — ${describeError(error)}`);
    return null;
  }
  if (!data) return null;
  return {
    city: data.city as string,
    wardNumber: Number(data.ward_number ?? 0),
    tole: data.tole as string,
    landmark: data.landmark as string,
    directionsNote: (data.directions_note as string | null) ?? null,
  };
}

async function readPerson(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<LookupPerson | null> {
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, phone")
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    name: (data.full_name as string | null) ?? null,
    phone: (data.phone as string | null) ?? null,
  };
}

/** The professional, whose number is on `provider_contacts` and never on `providers`. */
async function readProvider(
  admin: ReturnType<typeof createAdminClient>,
  providerId: string,
): Promise<LookupPerson | null> {
  const [{ data: provider }, { data: contact }] = await Promise.all([
    admin.from("providers").select("id, display_name").eq("id", providerId).maybeSingle(),
    admin.from("provider_contacts").select("phone").eq("provider_id", providerId).maybeSingle(),
  ]);
  if (!provider) return null;
  return {
    id: provider.id as string,
    name: (provider.display_name as string | null) ?? null,
    phone: (contact?.phone as string | null) ?? null,
  };
}
