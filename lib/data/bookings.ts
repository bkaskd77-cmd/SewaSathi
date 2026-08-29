import "server-only";

import { z } from "zod";

import type { Locale } from "@/i18n/routing";
import { isValidSlot } from "@/lib/booking/schedule";
import {
  customerCanCancel,
  isBookingStatus,
  type BookingStatus,
} from "@/lib/booking/status";
import { getCategory } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
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
  "id, reference, category_slug, provider_id, address_id, status, urgency, description, photo_url, scheduled_for, quoted_min, quoted_max, final_amount, payment_method, payment_status, created_at, accepted_at, completed_at, cancelled_at";

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
 * Cancel — the only status change a customer may make.
 *
 * Three things have to agree for this to work, and all three are deliberate:
 * the RLS policy restricts which rows may be updated at all, the transition
 * trigger rejects an illegal target status, and `customerCanCancel` here keeps
 * the button off the screen in the first place. The check below makes a
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
    if (!customerCanCancel(current.status)) return { ok: false };

    const { data, error } = await supabase
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_by: "customer",
        cancellation_reason: reason?.trim().slice(0, 300) || null,
      })
      .eq("id", id)
      .select("id");

    if (error) {
      console.error(`[bookings] cancel failed — ${describeError(error)}`);
      return { ok: false };
    }
    return { ok: (data?.length ?? 0) > 0 };
  } catch (thrown) {
    console.error(`[bookings] cancel threw — ${describeError(thrown)}`);
    return { ok: false };
  }
}
