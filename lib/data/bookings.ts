import "server-only";

import { z } from "zod";

import type { Locale } from "@/i18n/routing";
import { isValidSlot } from "@/lib/booking";
import {
  isBookingStatus,
  judgeCancellation,
  type BookingStatus,
} from "@/lib/booking";
import { getCategory } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { notify } from "@/lib/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Bookings.
 *
 * Everything here goes through the RLS-scoped client, never the service role.
 * The policies on `bookings` are what actually guarantee a customer touches
 * only their own; repeating that check in TypeScript would be a second source
 * of truth that can drift from the first.
 *
 * What this module is responsible for that the database cannot be:
 *
 * - Rejecting a booking for an inactive category or an unavailable provider,
 *   because "is this still for sale" is a product question.
 * - Rejecting a time we would not have offered, using the same slot function
 *   the picker renders from.
 * - Freezing the quote onto the row.
 *
 * What it deliberately leaves to the database: who may read what, and which
 * status may follow which. Both are enforced by policy and trigger, so no code
 * path — including a future one nobody has written yet — can go around them.
 */

export type Urgency = "emergency" | "soon" | "routine";
export type PaymentMethod = "cash" | "esewa" | "khalti";

export type Booking = {
  id: string;
  reference: string;
  categorySlug: string;
  providerId: string | null;
  addressId: string;
  status: BookingStatus;
  urgency: Urgency;
  description: string;
  photoUrl: string | null;
  /** Null means as soon as possible — the default and the common case. */
  scheduledFor: string | null;
  quotedMin: number;
  quotedMax: number;
  finalAmount: number | null;
  /** Why the professional went over the band, in their own words. */
  finalAmountReason: string | null;
  /** Set when the figure is agreed — automatically inside the band, by the
   * customer above it. Null with a final amount set means "waiting on you". */
  finalAmountApprovedAt: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
};

/** Field errors keyed to the flow's steps. Values are message-catalogue keys. */
export type BookingErrors = Partial<
  Record<
    | "description"
    | "category"
    | "provider"
    | "address"
    | "scheduledFor"
    | "payment"
    | "form",
    string
  >
>;

export type CreateBookingResult =
  | { ok: true; reference: string; id: string }
  | { ok: false; errors: BookingErrors };

/**
 * Unambiguous down a phone line: no 0/O, no 1/I. Somebody is going to read one
 * of these out to a professional standing at the wrong gate.
 */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function makeReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let out = "";
  // Indexed rather than iterated: the tsconfig target predates downlevel
  // iteration of typed arrays, and this is not worth moving it for.
  for (let i = 0; i < bytes.length; i += 1) {
    out += REFERENCE_ALPHABET[bytes[i] % 32];
  }
  return `SK-${out}`;
}

export type BookingInput = {
  category: string;
  provider?: string | null;
  urgency?: string;
  addressId: string;
  description: string;
  photoUrl?: string | null;
  /** ISO instant of a chosen slot, or empty for as-soon-as-possible. */
  scheduledFor?: string | null;
  paymentMethod?: string;
  triageLogId?: string | null;
};

const schema = z.object({
  category: z.string().min(1),
  provider: z.string().uuid().nullish(),
  urgency: z.enum(["emergency", "soon", "routine"]).default("routine"),
  addressId: z.string().uuid(),
  description: z.string().trim().min(4).max(1000),
  photoUrl: z.string().url().max(2000).nullish(),
  paymentMethod: z.enum(["cash", "esewa", "khalti"]).default("cash"),
  triageLogId: z.string().uuid().nullish(),
});

const COLUMNS =
  "id, reference, category_slug, provider_id, address_id, status, urgency, description, photo_url, scheduled_for, quoted_min, quoted_max, final_amount, final_amount_reason, final_amount_approved_at, payment_method, payment_status, created_at, accepted_at, completed_at, cancelled_at";

function rowToBooking(row: Record<string, unknown>): Booking {
  const status = row.status as string;
  return {
    id: row.id as string,
    reference: row.reference as string,
    categorySlug: row.category_slug as string,
    providerId: (row.provider_id as string | null) ?? null,
    addressId: row.address_id as string,
    status: isBookingStatus(status) ? status : "pending",
    urgency: row.urgency as Urgency,
    description: row.description as string,
    photoUrl: (row.photo_url as string | null) ?? null,
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    quotedMin: row.quoted_min as number,
    quotedMax: row.quoted_max as number,
    finalAmount: (row.final_amount as number | null) ?? null,
    finalAmountReason: (row.final_amount_reason as string | null) ?? null,
    finalAmountApprovedAt:
      (row.final_amount_approved_at as string | null) ?? null,
    paymentMethod: row.payment_method as PaymentMethod,
    paymentStatus: row.payment_status as string,
    createdAt: row.created_at as string,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
  };
}

export async function createBooking(
  input: BookingInput,
  customerId: string,
  locale: Locale,
): Promise<CreateBookingResult> {
  const errors: BookingErrors = {};

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "description") errors.description = "describeTheProblem";
      if (field === "addressId") errors.address = "pickAddress";
      if (field === "paymentMethod") errors.payment = "pickPayment";
      if (field === "category" || field === "provider" || field === "photoUrl") {
        errors.form = "badRequest";
      }
    }
  }

  // A time we would not have offered is refused with the same function the
  // picker renders from, so the list and the validator cannot drift apart.
  const scheduledFor = input.scheduledFor?.trim() || null;
  if (scheduledFor && !isValidSlot(scheduledFor)) {
    errors.scheduledFor = "timeUnavailable";
  }

  if (Object.keys(errors).length > 0 || !parsed.success) {
    return { ok: false, errors };
  }

  // Is this still something we sell? The category could have been retired
  // between the triage that suggested it and the confirm button.
  const category = await getCategory(parsed.data.category);
  if (!category) return { ok: false, errors: { category: "categoryUnavailable" } };

  // Is the chosen professional still taking work? Booking someone who has gone
  // unavailable is a job that sits pending until it times out.
  if (parsed.data.provider) {
    const provider = await getProvider(parsed.data.provider);
    if (!provider || !provider.categories.includes(category.slug)) {
      return { ok: false, errors: { provider: "providerUnavailable" } };
    }
  }

  if (!hasSupabaseConfig()) {
    console.warn("[bookings] no Supabase config — booking not stored");
    return { ok: true, reference: makeReference(), id: "local-preview" };
  }

  const supabase = createClient();

  // One retry, because the only way this collides is a reference clash, and a
  // customer should never see that as an error.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase
        .from("bookings")
        .insert({
          reference: makeReference(),
          customer_id: customerId,
          provider_id: parsed.data.provider || null,
          category_slug: category.slug,
          address_id: parsed.data.addressId,
          description: parsed.data.description,
          photo_url: parsed.data.photoUrl || null,
          urgency: parsed.data.urgency,
          scheduled_for: scheduledFor,
          // Frozen here, on purpose. See the note at the top of the file.
          quoted_min: category.basePriceMin,
          quoted_max: category.basePriceMax,
          payment_method: parsed.data.paymentMethod,
          // The customer's actual choice, kept separately so it survives the
          // job being widened to other professionals. See lib/booking/dispatch.
          first_choice_provider_id: parsed.data.provider ?? null,
          triage_log_id: parsed.data.triageLogId || null,
          locale,
        })
        .select("id, reference")
        .single();

      if (!error && data) {
        return {
          ok: true,
          reference: data.reference as string,
          id: data.id as string,
        };
      }

      // 23505 is unique_violation — the reference clashed. Anything else is
      // real and must not be retried.
      if (error && (error as { code?: string }).code !== "23505") {
        console.error(`[bookings] insert failed — ${describeError(error)}`);
        return { ok: false, errors: { form: "saveFailed" } };
      }
    } catch (thrown) {
      console.error(`[bookings] insert threw — ${describeError(thrown)}`);
      return { ok: false, errors: { form: "saveFailed" } };
    }
  }

  console.error("[bookings] insert failed — reference collided twice");
  return { ok: false, errors: { form: "saveFailed" } };
}

/**
 * The signed-in customer's bookings, newest first.
 *
 * No seed fallback, unlike categories and providers: an empty list is a real
 * and correct answer for a new customer.
 */
export async function listBookings(): Promise<Booking[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error(`[bookings] list failed — ${describeError(error)}`);
      return [];
    }
    return (data ?? []).map((row) =>
      rowToBooking(row as Record<string, unknown>),
    );
  } catch (thrown) {
    console.error(`[bookings] list threw — ${describeError(thrown)}`);
    return [];
  }
}

/** One booking, by id or by the reference a customer reads off a screen. */
export async function getBooking(
  idOrReference: string,
): Promise<Booking | null> {
  if (!hasSupabaseConfig()) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrReference,
    );

  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(COLUMNS)
      .eq(isUuid ? "id" : "reference", idOrReference)
      .maybeSingle();

    if (error) {
      console.error(`[bookings] read failed — ${describeError(error)}`);
      return null;
    }
    return data ? rowToBooking(data as Record<string, unknown>) : null;
  } catch (thrown) {
    console.error(`[bookings] read threw — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * Who has already said no to this booking.
 *
 * Read through RLS — "Customers read refusals on their bookings" — so a
 * customer sees the refusals on their own job and nobody else's. Used for two
 * things that must agree: the screen that says a professional pulled out, and
 * the suggestion list that must not offer that professional back.
 */
export async function listRefusals(
  bookingId: string,
): Promise<Array<{ providerId: string; kind: string; createdAt: string }>> {
  if (!hasSupabaseConfig()) return [];
  try {
    const { data, error } = await createClient()
      .from("booking_refusals")
      .select("provider_id, kind, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false });

    if (error || !data) return [];
    return data.map((row) => ({
      providerId: row.provider_id as string,
      kind: row.kind as string,
      createdAt: row.created_at as string,
    }));
  } catch {
    // A booking page that cannot read its refusals is still a correct booking
    // page: it simply offers no replacements, and the support line is there.
    return [];
  }
}

/**
 * The customer picks a replacement.
 *
 * Everything about this is re-checked here, and then re-checked again by the
 * database: `enforce_booking_immutability` refuses an assignment to a
 * professional who does not cover the job or who has already refused it, for
 * every caller including this one. Two layers because they fail differently —
 * this one can say *why* on a screen, and that one holds even when a future
 * caller forgets to ask.
 *
 * The write goes through the service role rather than the customer's own
 * policy. The customer may legally set `provider_id` on their own pending
 * booking, but `opened_at` and `reassigned_at` are dispatch state, not theirs
 * to edit — a browser that can clear `opened_at` can hide its own job from the
 * pool indefinitely. So the decision is made here with the caller's identity
 * known, and the write is made by the server.
 */
export async function chooseProvider(input: {
  bookingId: string;
  providerId: string;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  // Through RLS: a customer can only read their own booking, so this is the
  // ownership check as well as the read.
  const booking = await getBooking(input.bookingId);
  if (!booking) return { ok: false, reason: "notYours" };
  if (booking.status !== "pending") return { ok: false, reason: "notWaiting" };
  if (booking.providerId) return { ok: false, reason: "alreadyAssigned" };

  const provider = await getProvider(input.providerId);
  if (!provider || !provider.categories.includes(booking.categorySlug)) {
    return { ok: false, reason: "providerUnavailable" };
  }

  const refusals = await listRefusals(input.bookingId);
  if (refusals.some((r) => r.providerId === input.providerId)) {
    return { ok: false, reason: "alreadyRefused" };
  }

  const { data, error } = await createAdminClient()
    .from("bookings")
    .update({
      provider_id: input.providerId,
      // Theirs alone again, and the dispatch clock restarts from here — see
      // the note on `reassigned_at`. Without both, the next sweep would widen
      // the job away from somebody the customer chose seconds ago.
      opened_at: null,
      reassigned_at: new Date().toISOString(),
    })
    .eq("id", input.bookingId)
    .eq("customer_id", input.actorId)
    .eq("status", "pending")
    .is("provider_id", null)
    .select("id");

  if (error) {
    console.error(`[bookings] re-pick failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }
  // Zero rows means somebody claimed it between the read and the write. Not an
  // error: the customer wanted a professional and now has one.
  if ((data?.length ?? 0) === 0) return { ok: false, reason: "alreadyAssigned" };

  const listing = await createAdminClient()
    .from("providers")
    .select("profile_id")
    .eq("id", input.providerId)
    .maybeSingle();

  const profileId = (listing.data?.profile_id as string | null) ?? null;
  if (profileId) {
    await notify({
      recipientId: profileId,
      kind: "booking.assigned",
      params: { reference: booking.reference },
      bookingId: input.bookingId,
    });
  }

  return { ok: true };
}

export type StatusEvent = {
  fromStatus: string | null;
  toStatus: string;
  changedByRole: string;
  createdAt: string;
};

/** What happened to this booking, oldest first. Phase 11 reads this too. */
export async function getBookingHistory(
  bookingId: string,
): Promise<StatusEvent[]> {
  if (!hasSupabaseConfig()) return [];
  try {
    const { data, error } = await createClient()
      .from("booking_status_history")
      .select("from_status, to_status, changed_by_role, created_at")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

    if (error || !data) return [];
    return data.map((row) => ({
      fromStatus: (row.from_status as string | null) ?? null,
      toStatus: row.to_status as string,
      changedByRole: row.changed_by_role as string,
      createdAt: row.created_at as string,
    }));
  } catch {
    return [];
  }
}

/**
 * Tell the professional their job is off.
 *
 * Their profile id is not on the booking — `provider_id` points at the
 * directory row — so it takes a hop. Failing to find one is not an error worth
 * surfacing to the customer who just cancelled: the cancellation happened, and
 * a missing notification is not a reason to tell them it did not.
 */
async function notifyProviderOfCancellation(
  providerId: string,
  reference: string,
  bookingId: string,
): Promise<void> {
  const { data } = await createAdminClient()
    .from("providers")
    .select("profile_id")
    .eq("id", providerId)
    .maybeSingle();

  const profileId = (data?.profile_id as string | null) ?? null;
  if (!profileId) return;

  await notify({
    recipientId: profileId,
    kind: "booking.cancelled",
    params: { reference },
    bookingId,
  });
}

/**
 * Cancel — the only status change a customer may make.
 *
 * Three things have to agree for this to work, and all three are deliberate:
 * the RLS policy restricts which rows may be updated at all, the transition
 * trigger rejects an illegal target status, and the cancellation policy here
 * keeps the button off the screen in the first place. The check below makes a
 * refusal legible instead of letting the policy return a silent zero rows.
 */
export async function cancelBooking(
  id: string,
  reason: string | null,
): Promise<{ ok: boolean }> {
  if (!hasSupabaseConfig()) return { ok: false };

  try {
    const supabase = createClient();

    const current = await getBooking(id);
    if (!current) return { ok: false };

    // One policy, three surfaces. See lib/booking/cancellation.ts for why the
    // window is the whole rule and the fee is always zero.
    const verdict = judgeCancellation(current.status, "customer");
    if (!verdict.allowed) return { ok: false };

    const { data, error } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: "customer",
        cancelled_by_role: "customer",
        cancellation_fee: verdict.fee,
        cancellation_reason: reason?.trim().slice(0, 300) || null,
      })
      .eq("id", id)
      .select("id, provider_id");

    if (error) {
      console.error(`[bookings] cancel failed — ${describeError(error)}`);
      return { ok: false };
    }
    if ((data?.length ?? 0) === 0) return { ok: false };

    // The professional finds out from us, not by turning up. Only worth
    // sending once somebody has actually been assigned.
    const providerId = data?.[0]?.provider_id as string | null | undefined;
    if (providerId) await notifyProviderOfCancellation(providerId, current.reference, id);

    return { ok: true };
  } catch (thrown) {
    console.error(`[bookings] cancel threw — ${describeError(thrown)}`);
    return { ok: false };
  }
}
