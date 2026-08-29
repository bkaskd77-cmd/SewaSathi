import "server-only";

import { z } from "zod";

import type { Locale } from "@/i18n/routing";
import { AREA_KEYS } from "@/lib/config/areas";
import { CATEGORY_SEED } from "@/lib/config/services";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Bookings — the first thing in this product that is a promise to a person.
 *
 * Everything here goes through the RLS-scoped client, never the service role.
 * The policy on `bookings` is what actually guarantees a customer can only
 * read and write their own; doing the check in TypeScript as well would be a
 * second source of truth that can drift from the first.
 *
 * Two rules this module exists to enforce:
 *
 * - **The quote is frozen at booking time.** `quoted_min`/`quoted_max` are
 *   written from the category's band as it stands now, and every screen reads
 *   them back from the row rather than from `categories`. Repricing a service
 *   next month must not rewrite what somebody already agreed to.
 * - **The customer's contact details are copied, not joined.** Changing your
 *   account phone number later must not redirect a professional who is already
 *   on the way.
 */

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "on_the_way"
  | "completed"
  | "cancelled";

export type Urgency = "emergency" | "soon" | "routine";

export type Booking = {
  id: string;
  reference: string;
  categorySlug: string;
  providerId: string | null;
  status: BookingStatus;
  urgency: Urgency;
  /** Null means "as soon as possible" — the default, and the common case. */
  scheduledFor: string | null;
  areaKey: string;
  addressLine: string;
  landmark: string | null;
  contactPhone: string;
  contactName: string;
  notes: string | null;
  quotedMin: number;
  quotedMax: number;
  finalPrice: number | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
};

/** Field errors keyed to the form. Values are message-catalogue keys. */
export type BookingErrors = Partial<
  Record<
    "addressLine" | "landmark" | "notes" | "scheduledFor" | "area" | "form",
    string
  >
>;

export type CreateBookingResult =
  | { ok: true; reference: string; id: string }
  | { ok: false; errors: BookingErrors };

const CATEGORY_SLUGS = CATEGORY_SEED.map((c) => c.slug);

/**
 * Unambiguous down a phone line: no 0/O, no 1/I. Somebody is going to read
 * this out to a professional standing at the wrong gate.
 */
const REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

function makeReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  // Indexed rather than iterated: the tsconfig target predates downlevel
  // iteration of typed arrays, and this is not worth moving it for.
  for (let i = 0; i < bytes.length; i += 1) {
    out += REFERENCE_ALPHABET[bytes[i] % 32];
  }
  return `SK-${out}`;
}

const schema = z.object({
  category: z.string().refine((v) => CATEGORY_SLUGS.includes(v)),
  provider: z.string().uuid().nullable().optional(),
  urgency: z.enum(["emergency", "soon", "routine"]).default("routine"),
  area: z.string().refine((v) => AREA_KEYS.includes(v)),
  addressLine: z.string().trim().min(4).max(160),
  landmark: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(600).optional(),
  /** Empty string means ASAP, which is a choice and not a missing value. */
  scheduledFor: z.string().trim().optional(),
});

export type BookingInput = {
  category: string;
  provider?: string | null;
  urgency?: string;
  area: string;
  addressLine: string;
  landmark?: string;
  notes?: string;
  scheduledFor?: string;
};

/**
 * A scheduled slot has to be in the future and inside the window we can
 * actually staff. Thirty days is not a policy decision so much as a guard: a
 * date picker with no ceiling collects bookings for next year.
 */
function parseScheduledFor(value: string | undefined): {
  ok: boolean;
  iso: string | null;
} {
  if (!value) return { ok: true, iso: null };
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return { ok: false, iso: null };

  const now = Date.now();
  // A small grace window, because the customer's clock is not ours and a slot
  // chosen thirty seconds ago should not be rejected as "in the past".
  if (when.getTime() < now - 5 * 60_000) return { ok: false, iso: null };
  if (when.getTime() > now + 30 * 24 * 60 * 60_000)
    return { ok: false, iso: null };

  return { ok: true, iso: when.toISOString() };
}

function rowToBooking(row: Record<string, unknown>): Booking {
  return {
    id: row.id as string,
    reference: row.reference as string,
    categorySlug: row.category_slug as string,
    providerId: (row.provider_id as string | null) ?? null,
    status: row.status as BookingStatus,
    urgency: row.urgency as Urgency,
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    areaKey: row.area_key as string,
    addressLine: row.address_line as string,
    landmark: (row.landmark as string | null) ?? null,
    contactPhone: row.contact_phone as string,
    contactName: row.contact_name as string,
    notes: (row.notes as string | null) ?? null,
    quotedMin: row.quoted_min as number,
    quotedMax: row.quoted_max as number,
    finalPrice: (row.final_price as number | null) ?? null,
    createdAt: row.created_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
    cancelledAt: (row.cancelled_at as string | null) ?? null,
  };
}

const COLUMNS =
  "id, reference, category_slug, provider_id, status, urgency, scheduled_for, area_key, address_line, landmark, contact_phone, contact_name, notes, quoted_min, quoted_max, final_price, created_at, completed_at, cancelled_at";

export async function createBooking(
  input: BookingInput,
  customer: { id: string; fullName: string | null; phone: string | null },
  quote: { min: number; max: number },
  locale: Locale,
): Promise<CreateBookingResult> {
  const errors: BookingErrors = {};

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "addressLine") errors.addressLine = "addressTooShort";
      if (field === "landmark") errors.landmark = "landmarkTooLong";
      if (field === "notes") errors.notes = "notesTooLong";
      if (field === "area") errors.area = "pickArea";
      // A bad category or provider id cannot come from the form; it is a
      // crafted POST, and there is no field to hang the message on.
      if (field === "category" || field === "provider") errors.form = "badRequest";
    }
  }

  const when = parseScheduledFor(input.scheduledFor);
  if (!when.ok) errors.scheduledFor = "timeOutOfRange";

  // Nobody can be reached without a number, and the account is where it comes
  // from. This is unreachable through the UI — the phone is how you sign in —
  // but a booking with no way to call the customer is not a booking.
  if (!customer.phone) errors.form = "noPhoneOnAccount";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!parsed.success || !customer.phone) return { ok: false, errors };

  if (!hasSupabaseConfig()) {
    console.warn("[bookings] no Supabase config — booking not stored");
    return { ok: true, reference: makeReference(), id: "local-preview" };
  }

  const supabase = createClient();

  // One retry, because the only way this collides is the 1-in-a-billion
  // reference clash, and a customer should never see that as an error.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reference = makeReference();
    try {
      const { data, error } = await supabase
        .from("bookings")
        .insert({
          reference,
          customer_id: customer.id,
          provider_id: parsed.data.provider || null,
          category_slug: parsed.data.category,
          urgency: parsed.data.urgency,
          scheduled_for: when.iso,
          area_key: parsed.data.area,
          address_line: parsed.data.addressLine,
          landmark: parsed.data.landmark || null,
          contact_phone: customer.phone,
          contact_name: customer.fullName?.trim() || "—",
          notes: parsed.data.notes || null,
          quoted_min: quote.min,
          quoted_max: quote.max,
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
      // real and should not be retried.
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
 * No seed fallback, unlike categories and providers. An empty list is a real
 * and correct answer for a new customer, and inventing rows for somebody's own
 * booking history would be a lie about their own life rather than a gap in a
 * catalogue.
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
    return (data ?? []).map((row) => rowToBooking(row as Record<string, unknown>));
  } catch (thrown) {
    console.error(`[bookings] list threw — ${describeError(thrown)}`);
    return [];
  }
}

/** One booking, by id or by the reference a customer reads off a screen. */
export async function getBooking(idOrReference: string): Promise<Booking | null> {
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
 * Cancel, which is the only status change a customer may make.
 *
 * The RLS policy is what enforces "only while pending or confirmed" — the
 * `.in()` here makes the failure legible rather than letting the policy return
 * a silent zero-row update.
 */
export async function cancelBooking(
  id: string,
  reason: string | null,
): Promise<{ ok: boolean }> {
  if (!hasSupabaseConfig()) return { ok: false };

  try {
    const { data, error } = await createClient()
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: "customer",
        cancellation_reason: reason?.trim().slice(0, 300) || null,
      })
      .eq("id", id)
      .in("status", ["pending", "confirmed"])
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
