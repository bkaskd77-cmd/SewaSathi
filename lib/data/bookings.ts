import "server-only";

import { z } from "zod";

import { recordSecurityEvent } from "@/lib/audit";

import type { Locale } from "@/i18n/routing";
import { hasRoom, isValidSlot, type QuoteModel } from "@/lib/booking";
import {
  isBookingStatus,
  judgeCancellation,
  type BookingStatus,
} from "@/lib/booking";
import { providerCapacity } from "@/lib/data/capacity";
import { isSurveyPriced } from "@/lib/config/services";
import { getCategory, getSubBands } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { PAYOUT_RULES } from "@/lib/payments";
import { notify } from "@/lib/notify";
import {
  blocksBooking,
  canServeAt,
  quoteFloor,
  servingWhen,
} from "@/lib/provider";
import { bandBounds, BAND_SOURCES, type BandSource } from "@/lib/booking";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * Bookings.
 *
 * Everything here goes through the RLS-scoped client, never the service role.
 *
 * RLS IS A FLOOR, NOT A FILTER, AND THIS FILE IS WHERE THAT WAS LEARNED. This
 * comment used to say the policies on `bookings` were what guaranteed a
 * customer touched only their own, and that repeating the check here would be
 * a second source of truth that could drift. Every word of it was true when it
 * was written and the conclusion was wrong. `"Admins read every booking"` was
 * added later for the admin queues — permissive, as every Postgres policy is —
 * and from that day `listBookings` returned EVERY customer's bookings to an
 * admin, on the customer's own dashboard, because it named nobody in the
 * query. Nothing failed. It was found by a person looking at the screen.
 *
 * So the rule, and it is in `SECURITY.md` now: a read for a screen that
 * belongs to one person names that person. The policy is the floor that stops
 * a stranger; the predicate is what makes the answer the right one. That is
 * not a second source of truth — the two answer different questions.
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
  /**
   * Which product inside the trade, and how long it is expected to take.
   *
   * Three figures and they never collapse into one: `estimated*` is ours from
   * the sub-band, `providerEstimated*` is theirs after they saw the job, and
   * `actualWorkingMinutes` is what happened. Keeping all three is the only
   * path the researched durations have to getting better.
   */
  bandSlug: string | null;
  bandSource: string | null;
  estimatedWorkingMinutes: number | null;
  estimatedElapsedDays: number | null;
  providerEstimatedWorkingMinutes: number | null;
  providerEstimatedElapsedDays: number | null;
  actualWorkingMinutes: number | null;
  providerId: string | null;
  addressId: string;
  status: BookingStatus;
  urgency: Urgency;
  description: string;
  photoUrl: string | null;
  /** Null means as soon as possible — the default and the common case. */
  scheduledFor: string | null;
  /**
   * NULL ON A SURVEY BOOKING THAT NOBODY HAS PRICED YET, and typed that way on
   * purpose: making these nullable is what forces every money surface to decide
   * what it does with a job whose band does not exist, instead of coercing it
   * to zero and carrying on. `Number(null)` is 0, and a 2x ceiling measured off
   * zero is no ceiling at all.
   */
  quotedMin: number | null;
  quotedMax: number | null;
  /** `band` from the moment it was made, or `survey` — priced after a visit. */
  quoteModel: QuoteModel;
  surveyedAt: string | null;
  /** When the surveyed price stops being honourable. */
  quoteExpiresAt: string | null;
  quoteApprovedAt: string | null;
  quoteDeclinedAt: string | null;
  /**
   * The professional says the job is a different product from the one booked.
   *
   * SEPARATE FROM `bandSlug`, NEVER OVERWRITING IT. `bandSlug` is what the
   * customer said when the triage card asked, and their answer set the price;
   * these columns are what somebody who actually saw the job says instead. Both
   * are kept because the disagreement is the record — the customer agreed to a
   * change or they did not, and the money moved on that answer.
   *
   * `providerBandAt` is the existence test rather than the slug: the foreign
   * key is `on delete set null`, so retiring a product from the catalogue
   * months later must not turn an answered correction back into "none". See
   * `correctionState` in lib/booking.
   */
  providerBandSlug: string | null;
  /** Why, in their own words. The customer reads this, not a new number. */
  providerBandReason: string | null;
  providerBandAt: string | null;
  bandChangeApprovedAt: string | null;
  bandChangeDeclinedAt: string | null;
  /** The listing that offered to fit this job in beside one they already held. */
  overbookOfferedBy: string | null;
  finalAmount: number | null;
  /** Why the professional went over the band, in their own words. */
  finalAmountReason: string | null;
  /** Set when the figure is agreed — automatically inside the band, by the
   * customer above it. Null with a final amount set means "waiting on you". */
  finalAmountApprovedAt: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: string;
  /** Set when the customer's figure and the professional's disagreed. */
  amountMismatchAt: string | null;
  customerReportedAmount: number | null;
  createdAt: string;
  acceptedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  /**
   * Protect the trip, not the booking.
   *
   * True while this is going to an address nobody has ever been to. Dispatch
   * holds until `confirmedAt` is set, so the booking screen has to be able to
   * ask — a gate the customer cannot see is a booking that silently never
   * happens.
   */
  confirmationRequired: boolean;
  confirmedAt: string | null;
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
  /**
   * Which product inside the trade, as the triage named it. Null when nobody
   * could tell, which is the ordinary case for anything the customer typed
   * freehand — and what the booking's duration then is, is nothing.
   */
  band?: string | null;
  /**
   * Which path named the product: the model, or the keyword matcher.
   *
   * A HINT, NOT A CLAIM, and it exists so a matcher rule found wrong later can
   * be cleaned up at all. Three of the five band rules shipped in the matcher
   * were wrong, and `no-water` from the defective `dhara` match is the same
   * three bytes as `no-water` from the model reading a whole sentence — so
   * without this, "clear the rows the bad rule touched" is not a query
   * anybody can write. See `rebandBookings`.
   */
  bandSource?: string | null;
  asked?: string;
};

/**
 * Exported so a test can assert the values the PRODUCT emits are values the
 * BOOKING accepts. They live in different files and nothing else makes them
 * agree — which is how `bandSource=customer` shipped into the query string
 * while this refused it.
 */
export const bookingInputSchema = z.object({
  category: z.string().min(1),
  provider: z.string().uuid().nullish(),
  urgency: z.enum(["emergency", "soon", "routine"]).default("routine"),
  addressId: z.string().uuid(),
  description: z.string().trim().min(4).max(1000),
  photoUrl: z.string().url().max(2000).nullish(),
  paymentMethod: z.enum(["cash", "esewa", "khalti"]).default("cash"),
  triageLogId: z.string().uuid().nullish(),
  /*
   * Loosely shaped on purpose, and NOT trusted. A slug arriving from a browser
   * could name any product in any trade, so the composite foreign key
   * `bookings_band_slug_fkey` is what actually holds — it refuses a slug this
   * category does not sell, and `checkBandSlug` below turns that refusal into
   * a null rather than a failed booking. Somebody tampering with this field
   * gains a wrong duration on their own job and nothing else; it moves no
   * money and it is refused to browsers on every subsequent update.
   */
  band: z.string().trim().min(1).max(40).nullish(),
  /*
   * Deliberately not trusted, and worth being exact about why that is fine.
   * It arrives in the same query string as the band, so somebody could set
   * `model` on their own booking — and what that buys them is protection from
   * a cleanup sweep on their own job's duration. It moves no money, every
   * later update is refused by `enforce_booking_immutability`, and
   * `rebandBookings` can ignore the column and clear by product and date
   * instead. `triage_logs` is the authoritative record of what each path
   * produced; this is the fast copy on the customer path.
   */
  /*
   * `customer` WAS MISSING AND THAT WAS A LIVE BUG. The sub-band ask shipped
   * writing `bandSource=customer` into this query string, and this enum
   * refused it — so the whole parse failed and the booking came back as a
   * validation error on the one path the ask exists to improve. Every other
   * guard around the band held; the schema that decides whether the booking
   * happens at all did not know the value existed.
   */
  bandSource: z.enum(BAND_SOURCES).nullish(),
  /*
   * Whether the card PUT the question, which is not the same fact as whether
   * anybody answered. "Never asked" and "I am not sure" both arrive here with
   * no band; without this they are the same row and `band_ask_signals` has no
   * denominator.
   */
  asked: z.string().optional(),
});

const COLUMNS =
  "id, reference, category_slug, band_slug, band_source, estimated_working_minutes, estimated_elapsed_days, provider_estimated_working_minutes, provider_estimated_elapsed_days, actual_working_minutes, provider_id, address_id, status, urgency, description, photo_url, scheduled_for, quoted_min, quoted_max, quote_model, surveyed_at, quote_expires_at, quote_approved_at, quote_declined_at, provider_band_slug, provider_band_reason, provider_band_at, band_change_approved_at, band_change_declined_at, overbook_offered_by, final_amount, final_amount_reason, final_amount_approved_at, payment_method, payment_status, amount_mismatch_at, customer_reported_amount, created_at, accepted_at, completed_at, cancelled_at, confirmation_required, confirmed_at";

function rowToBooking(row: Record<string, unknown>): Booking {
  const status = row.status as string;
  return {
    id: row.id as string,
    reference: row.reference as string,
    categorySlug: row.category_slug as string,
    bandSlug: (row.band_slug as string | null) ?? null,
    bandSource: (row.band_source as string | null) ?? null,
    estimatedWorkingMinutes:
      (row.estimated_working_minutes as number | null) ?? null,
    estimatedElapsedDays:
      (row.estimated_elapsed_days as number | null) ?? null,
    providerEstimatedWorkingMinutes:
      (row.provider_estimated_working_minutes as number | null) ?? null,
    providerEstimatedElapsedDays:
      (row.provider_estimated_elapsed_days as number | null) ?? null,
    actualWorkingMinutes:
      (row.actual_working_minutes as number | null) ?? null,
    providerId: (row.provider_id as string | null) ?? null,
    addressId: row.address_id as string,
    status: isBookingStatus(status) ? status : "pending",
    urgency: row.urgency as Urgency,
    confirmationRequired: Boolean(row.confirmation_required),
    confirmedAt: (row.confirmed_at as string | null) ?? null,
    description: row.description as string,
    photoUrl: (row.photo_url as string | null) ?? null,
    scheduledFor: (row.scheduled_for as string | null) ?? null,
    quotedMin: (row.quoted_min as number | null) ?? null,
    quotedMax: (row.quoted_max as number | null) ?? null,
    quoteModel: (row.quote_model as QuoteModel | null) ?? "band",
    surveyedAt: (row.surveyed_at as string | null) ?? null,
    quoteExpiresAt: (row.quote_expires_at as string | null) ?? null,
    quoteApprovedAt: (row.quote_approved_at as string | null) ?? null,
    quoteDeclinedAt: (row.quote_declined_at as string | null) ?? null,
    providerBandSlug: (row.provider_band_slug as string | null) ?? null,
    providerBandReason: (row.provider_band_reason as string | null) ?? null,
    providerBandAt: (row.provider_band_at as string | null) ?? null,
    bandChangeApprovedAt:
      (row.band_change_approved_at as string | null) ?? null,
    bandChangeDeclinedAt:
      (row.band_change_declined_at as string | null) ?? null,
    overbookOfferedBy: (row.overbook_offered_by as string | null) ?? null,
    finalAmount: (row.final_amount as number | null) ?? null,
    finalAmountReason: (row.final_amount_reason as string | null) ?? null,
    finalAmountApprovedAt:
      (row.final_amount_approved_at as string | null) ?? null,
    paymentMethod: row.payment_method as PaymentMethod,
    paymentStatus: row.payment_status as string,
    amountMismatchAt: (row.amount_mismatch_at as string | null) ?? null,
    customerReportedAmount:
      (row.customer_reported_amount as number | null) ?? null,
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

  const parsed = bookingInputSchema.safeParse(input);
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

  /*
   * The product, verified against the ones this trade actually sells.
   *
   * A NULL RATHER THAN A REFUSAL, deliberately. The composite foreign key
   * would reject the whole INSERT for a slug that does not belong to this
   * category — and losing a booking somebody spent five screens on, over a
   * hint that only affects how much of a calendar to reserve, is a much worse
   * failure than scheduling it the way every booking was scheduled before
   * duration existed. Null flows into `UNESTIMATED_HOLD_MINUTES` and the
   * customer is told nothing about length, which is the honest answer when we
   * do not know the product.
   */
  const subBand = parsed.data.band
    ? (await getSubBands()).find(
        (band) =>
          band.categorySlug === category.slug && band.slug === parsed.data.band,
      ) ?? null
    : null;
  const bandSlug = subBand?.slug ?? null;
  /*
   * How long this booking will hold, for the capacity check below. The trigger
   * writes the same figure onto the row from the same sub-band — this is the
   * screen's copy so a full window can be refused with a sentence rather than
   * a raised exception.
   */
  const bandMinutes = subBand?.typicalWorkingMinutes ?? null;

  /*
   * Is the chosen professional still taking work?
   *
   * This comment has been here since Phase 6 and only the category was ever
   * checked. The rest of it is now true: `canServeAt` decides, against the
   * time the customer actually wants somebody.
   *
   * ONLY AN EMERGENCY IS REFUSED. A scheduled job against somebody who is on
   * another job right now is a perfectly good booking — they will have
   * finished — and refusing it would take work from the busiest professionals.
   * An emergency is different: the customer has already told us they need
   * somebody now, and holding it for five minutes for somebody demonstrably in
   * another house spends the one window that matters.
   *
   * THE SCREEN CHECKS THIS TOO, and both are needed. The screen can explain and
   * offer alternatives; this one holds whatever the browser did — including the
   * case that is not an attack at all: a customer who picked somebody free,
   * filled in an address slowly, and confirmed after that professional set off.
   */
  /*
   * THE FLOOR OF THE QUOTE IS THE CHOSEN PROFESSIONAL'S OWN STARTING PRICE,
   * clamped into this category's band — see `quoteFloor`. Nobody chosen leaves
   * it at ours. The ceiling is always ours.
   *
   * Read from the same fetch as the availability check above, so the honesty
   * costs no extra round trip. After this insert the floor is maintained by
   * `bookings_sync_quote_floor`, because a job can change hands four different
   * ways and writing the recompute at each is four chances to forget.
   */
  /*
   * A SURVEY TRADE CARRIES NO BAND AT ALL, not even the numbers sitting in its
   * category row. Movers still has a stored 5,000-20,000 from before the
   * research found that nobody in the market quotes one — writing it here would
   * put the invented figure straight back on the booking, where the 2x ceiling
   * and the commission floor would both then be built from it.
   */
  const survey = isSurveyPriced(category);

  /*
   * THE BAND THE CUSTOMER NAMED IS THE PRICE, not just the calendar entry.
   *
   * This froze `category.basePriceMax` until the sub-band ask shipped and made
   * that wrong: the card shows the product's published range and the booking
   * has to carry the same number, or "no surprises" is true on one screen and
   * false on the next. `bandBounds` is the rule and `booking_band_bounds` in
   * Postgres is the same rule where it actually holds — this is the copy the
   * screens and the insert read.
   */
  const bounds = survey
    ? null
    : bandBounds({
        category: { low: category.basePriceMin, high: category.basePriceMax },
        stated: subBand
          ? { slug: subBand.slug, low: subBand.low, high: subBand.high }
          : null,
        statedSource: (parsed.data.bandSource as BandSource | undefined) ?? null,
      });

  let floor: number | null = bounds ? bounds.low : null;

  if (parsed.data.provider) {
    const provider = await getProvider(parsed.data.provider);
    if (!provider || !provider.categories.includes(category.slug)) {
      return { ok: false, errors: { provider: "providerUnavailable" } };
    }

    /*
     * IS THAT WINDOW ALREADY SPOKEN FOR? `enforce_slot_capacity` refuses the
     * insert either way, so this exists to return an error the flow can render
     * rather than a raised exception the customer reads as "something went
     * wrong". The database is the rule; this is the sentence.
     */
    const capacity = (await providerCapacity([provider.id], category.slug))[
      provider.id
    ];
    const when = servingWhen({ urgency: parsed.data.urgency, scheduledFor });

    const verdict = canServeAt({
      state: provider.availability,
      busyUntil: provider.busyUntil,
      when,
      windowFull: capacity
        ? !hasRoom({
            jobs: capacity.held,
            scheduledFor: when,
            // The job being booked holds its own length, not everybody's.
            workingMinutes: bandMinutes,
            capacity: capacity.capacity,
          })
        : false,
    });

    if (blocksBooking({ urgency: parsed.data.urgency, verdict })) {
      return {
        ok: false,
        errors: {
          provider:
            !verdict.ok && verdict.reason === "full"
              ? "providerFull"
              : "providerBusyNow",
        },
      };
    }

    // Their dashboard rate is a starting price for a trade that HAS a band. A
    // surveyed job's floor comes from the survey, not from a number set before
    // anybody saw how much furniture there is.
    if (!survey && bounds) {
      /*
       * Clamped into the band IN FORCE, not the trade's whole range. On a
       * customer-stated product that is the product's own range, so a
       * professional whose dashboard rate sits below it is floored at what the
       * customer was actually quoted rather than at the cheapest thing the
       * trade does. `statedLow` is the same number here — nothing has been
       * corrected yet at insert — and the max is what keeps it true later.
       */
      floor = Math.max(
        bounds.statedLow,
        quoteFloor({
          providerRate: provider.baseRate,
          band: { low: bounds.low, high: bounds.high },
        }),
      );
    }
  }

  if (!hasSupabaseConfig()) {
    console.warn("[bookings] no Supabase config — booking not stored");
    return { ok: true, reference: makeReference(), id: "local-preview" };
  }

  const supabase = createClient();

  /*
   * IS THIS ADDRESS THEIRS?
   *
   * The id arrives from the browser and nothing used to check whose it was.
   * The insert policy validated `customer_id` and stopped there, so a booking
   * could be made at any address whose uuid somebody had — and a booking
   * carries its address to the professional who accepts it, which means a
   * stranger at that door.
   *
   * The read is RLS-scoped, so "not yours" and "does not exist" are the same
   * empty answer, which is the right answer to both. The database refuses it
   * too (`enforce_booking_address_ownership`), for every caller including the
   * service role; this check is here so the customer gets a sentence rather
   * than a constraint error.
   */
  const { data: address } = await supabase
    .from("addresses")
    .select("id")
    .eq("id", parsed.data.addressId)
    .maybeSingle();

  if (!address) return { ok: false, errors: { address: "pickAddress" } };

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
          // Both null on a survey trade, which `bookings_band_only_null_for_survey`
          // is what makes impossible anywhere else.
          quoted_min: floor,
          quoted_max: bounds ? bounds.high : null,
          quote_model: survey ? "survey" : "band",
          payment_method: parsed.data.paymentMethod,
          // The customer's actual choice, kept separately so it survives the
          // job being widened to other professionals. See lib/booking/dispatch.
          first_choice_provider_id: parsed.data.provider ?? null,
          triage_log_id: parsed.data.triageLogId || null,
          /*
           * The product, which is where the duration comes from — a trigger
           * copies the sub-band's researched length onto the row rather than
           * this call site doing it, so the three other paths that will create
           * bookings cannot forget to.
           *
           * Verified against this category's own sub-bands first: the foreign
           * key would otherwise refuse the INSERT outright, and losing a whole
           * booking over a scheduling hint is a far worse outcome than
           * scheduling it the way every booking was scheduled before duration
           * existed.
           */
          band_slug: bandSlug,
          // Only meaningful when a product was actually named. Recording a
          // source for a null band would be a fact about nothing.
          band_source: bandSlug ? (parsed.data.bandSource ?? null) : null,
          // Set on ASKING, not on answering. A customer who looked at the
          // products and could not say is the measurement that matters most.
          band_asked_at: parsed.data.asked === "1" ? new Date().toISOString() : null,
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
 * One customer's bookings, newest first.
 *
 * TAKES THE CUSTOMER RATHER THAN ASSUMING THEM. It used to take nothing and
 * let RLS decide, which is how an admin came to see fourteen jobs belonging to
 * somebody else on their own `/bookings`. See the note at the top of the file.
 *
 * No seed fallback, unlike categories and providers: an empty list is a real
 * and correct answer for a new customer.
 */
export async function listBookings(customerId: string): Promise<Booking[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { data, error } = await createClient()
      .from("bookings")
      .select(COLUMNS)
      .eq("customer_id", customerId)
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

/**
 * One booking, by id or by the reference a customer reads off a screen.
 *
 * `customerId` IS HOW A PERSONAL SCREEN ASKS. Pass it from a customer surface
 * and "not found" and "not yours" become the same answer, which is the right
 * answer to give. Leave it out only where reading any booking is the point —
 * the dispatch sweep, the admin queues — and the call site then says so in one
 * word rather than by omission.
 */
export async function getBooking(
  idOrReference: string,
  options?: { customerId?: string },
): Promise<Booking | null> {
  if (!hasSupabaseConfig()) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrReference,
    );

  try {
    let query = createClient()
      .from("bookings")
      .select(COLUMNS)
      .eq(isUuid ? "id" : "reference", idOrReference);

    if (options?.customerId) {
      query = query.eq("customer_id", options.customerId);
    }

    const { data, error } = await query.maybeSingle();

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
 * THE CALLER PASSES A BOOKING ID ALREADY PROVEN TO BE THE ACTOR'S, and
 * `getBooking({ customerId })` is what proves it. `booking_refusals` carries
 * no customer column, so there is nothing here to filter on — and the RLS
 * policy is a floor rather than the whole answer, because
 * `"Admins read every refusal"` widens it. Used for two things that must
 * agree: the screen that says a professional pulled out, and the suggestion
 * list that must not offer that professional back.
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

  /*
   * A REPLACEMENT WHO ALSO CANNOT COME IS NOT A REPLACEMENT. This path is
   * reached from the withdrawal panel, which is the moment a customer is
   * already waiting and already let down once; handing them somebody
   * demonstrably in another house would spend their patience on a second
   * failure. Same rule, same function, same single stop: only an emergency.
   */
  const replacementWhen = servingWhen({
    urgency: booking.urgency,
    scheduledFor: booking.scheduledFor,
  });
  const replacementCapacity = (
    await providerCapacity([provider.id], booking.categorySlug)
  )[provider.id];

  const verdict = canServeAt({
    state: provider.availability,
    busyUntil: provider.busyUntil,
    when: replacementWhen,
    // Nor is somebody whose window is already promised to another customer.
    // The trigger would refuse this update; saying so here is what lets the
    // panel offer the next name instead of showing a raised exception.
    windowFull: replacementCapacity
      ? !hasRoom({
          jobs: replacementCapacity.held,
          scheduledFor: replacementWhen,
          // The booking's own length, the professional's figure first — the
          // same precedence `workingMinutes` applies and the trigger mirrors.
          workingMinutes:
            booking.providerEstimatedWorkingMinutes ??
            booking.estimatedWorkingMinutes,
          capacity: replacementCapacity.capacity,
          excludeId: booking.id,
        })
      : false,
  });
  if (blocksBooking({ urgency: booking.urgency, verdict })) {
    return {
      ok: false,
      reason:
        !verdict.ok && verdict.reason === "full"
          ? "providerFull"
          : "providerBusyNow",
    };
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

/**
 * Clear the product from bookings a band rule got wrong.
 *
 * WHY THIS EXISTS. Three of the five sub-band rules in the keyword matcher
 * were wrong when they shipped: a gas leak filed as a burst pipe, a dripping
 * tap filed as "no water" because the bare `dhara` just means TAP, and every
 * appliance fault filed as a labour-only repair. They were caught before any
 * real booking carried one, so nothing needed cleaning up — but the attempt to
 * write that cleanup is what found the real gap. `no-water` from the defective
 * match and `no-water` from the model reading a whole sentence are the same
 * three bytes, so without `band_source` there was no query to write at all.
 *
 * IT CLEARS RATHER THAN RE-DERIVES, and that is the considered half. The
 * original text is still on the booking, so re-running today's matcher over it
 * is possible — and it would produce today's answer with no more evidence
 * behind it than the wrong one had, while looking like a correction. A null is
 * recoverable and says plainly that nobody knows; a second guess dressed as a
 * fix is the thing rule 6 exists to stop. `sync_booking_duration` nulls the
 * estimate along with the slug, so the booking falls back to the hold every
 * unbanded booking already uses.
 *
 * `source` IS OPTIONAL BECAUSE THE STORED VALUE IS A HINT. It comes off a
 * query string, so a sweep that has to be certain omits it and clears every
 * booking of that product in the window instead. Over-clearing costs a
 * scheduling estimate; under-clearing leaves a wrong one in the evidence.
 *
 * Service role, because no policy grants a customer or a professional the
 * right to edit these columns and none should. Admin-only, and every run is
 * written to `security_events` — see SECURITY.md.
 */
export async function rebandBookings(input: {
  categorySlug: string;
  bandSlug: string;
  /** ISO instant. Only bookings created at or after this are touched. */
  since: string;
  /** Omit to clear regardless of which path named the product. */
  source?: "model" | "matcher";
  actorId: string;
}): Promise<{ ok: true; cleared: number } | { ok: false; reason: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  let query = createAdminClient()
    .from("bookings")
    .update({ band_slug: null, band_source: null })
    .eq("category_slug", input.categorySlug)
    .eq("band_slug", input.bandSlug)
    .gte("created_at", input.since);

  if (input.source) query = query.eq("band_source", input.source);

  const { data, error } = await query.select("id");

  if (error) {
    console.error(`[bookings] reband failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }

  const cleared = (data ?? []).length;

  /*
   * Logged even when it cleared nothing. "Somebody ran the sweep and it found
   * none" and "nobody ran the sweep" are different facts, and only one of them
   * means the wrong bands are still out there.
   */
  await recordSecurityEvent({
    kind: "admin.action",
    actorId: input.actorId,
    actorRole: "admin",
    subjectType: "booking",
    detail: {
      action: "rebandBookings",
      categorySlug: input.categorySlug,
      bandSlug: input.bandSlug,
      since: input.since,
      source: input.source ?? "any",
      cleared,
    },
  });

  return { ok: true, cleared };
}

/**
 * The customer answers the professional's correction.
 *
 * NOTHING STARTS UNTIL THEY DO — `enforce_price_correction` refuses
 * `in_progress` while the question is open, so this is a gate rather than a
 * notification somebody can ignore. That is what "the price is agreed before
 * work starts" means once the product itself can turn out wrong.
 *
 * APPROVING MOVES THE MONEY NUMBERS, and not from here.
 * `sync_booking_quote_floor` recomputes `quoted_min`, `quoted_max` and
 * `band_min` from the band now in force, because a job changes hands four ways
 * and a fifth writer is a fifth chance to forget. This function writes one
 * timestamp and lets the database do the arithmetic.
 *
 * DECLINING EARNS THE PROFESSIONAL A TRIP FEE. Cancelling is free until work
 * begins, so an honest correction would otherwise cost them the journey — and
 * the lesson everybody would learn is to start the work first and correct at
 * settlement, which is the exact thing this prevents. `survey_visit_fees` is
 * already the right shape and the row is born `pending`: a person decides, and
 * no trip means no fee whatever this function writes.
 *
 * The write is server-side and the read is not, the same shape `declineJob`
 * uses: `enforce_booking_immutability` refuses these columns to any caller with
 * a session, because a professional must not be able to stamp the customer's
 * approval.
 */
export async function answerBandCorrection(input: {
  bookingId: string;
  agreed: boolean;
  actorId: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  // Through RLS, so the policy is what proves this is their booking rather
  // than the id they handed us.
  const { data: booking, error: readError } = await createClient()
    .from("bookings")
    .select(
      "id, reference, customer_id, provider_id, status, provider_band_at, band_change_approved_at, band_change_declined_at, guarantee_claim_id",
    )
    .eq("id", input.bookingId)
    .maybeSingle();

  if (readError || !booking) return { ok: false, reason: "notFound" };
  if (booking.customer_id !== input.actorId) {
    return { ok: false, reason: "notYours" };
  }
  // Nothing to answer. Not an error a customer caused, so it is its own reason
  // rather than a generic failure.
  if (!booking.provider_band_at) return { ok: false, reason: "noCorrection" };
  if (booking.band_change_approved_at || booking.band_change_declined_at) {
    return { ok: false, reason: "alreadyAnswered" };
  }

  const now = new Date().toISOString();
  const admin = createAdminClient();
  const isGuaranteeVisit = booking.guarantee_claim_id != null;

  /*
   * ON A GUARANTEE RETURN VISIT, AGREEING IS WHAT MAKES IT CHARGEABLE.
   *
   * The visit was created free — the guarantee promises a redo, not a bill —
   * and `billable` turns on the customer's own agreement to the different
   * problem, in the same statement that records it. Not on the professional's
   * proposal, and NOT on the verdict: the verdict is written when the claim
   * resolves, which is after the work, and a charge decided then is precisely
   * the "billed at settlement" outcome this gate exists to prevent.
   *
   * `enforce_guarantee_visit` refuses the flip without the approval and once
   * `started_at` is stamped, so the ordering here is checked rather than
   * trusted.
   */
  const { error } = await admin
    .from("bookings")
    .update(
      input.agreed
        ? isGuaranteeVisit
          ? { band_change_approved_at: now, billable: true }
          : { band_change_approved_at: now }
        : { band_change_declined_at: now },
    )
    .eq("id", input.bookingId);

  if (error) {
    console.error(`[bookings] correction answer failed — ${describeError(error)}`);
    return { ok: false, reason: "saveFailed" };
  }

  if (!input.agreed) {
    /*
     * THE JOB IS OVER. A customer who will not pay for the product it turned
     * out to be is not a customer with a booking — leaving it `accepted` would
     * hold a professional's afternoon for work nobody is going to do. Written
     * through the same path a customer cancellation takes, so the status
     * machine and `cancelled_by_role` stay the one account of who ended it.
     */
    await admin
      .from("bookings")
      .update({
        status: "cancelled",
        cancelled_at: now,
        cancelled_by_role: "customer",
      })
      .eq("id", input.bookingId);

    await recordCorrectionVisitFee({
      bookingId: input.bookingId,
      providerId: (booking.provider_id as string | null) ?? null,
      /*
       * COUNTED AS ITS OWN OUTCOME. A declined redo earns the same trip fee as
       * a declined correction — the travel and the diagnosis were real work
       * whoever turned out to be right, and unpaid callbacks are callbacks
       * that stop being accepted. But a run of declined "different problem"
       * claims by one professional is the pattern that matters while leakage
       * scoring does not exist, and folded in with `band-declined` it would be
       * invisible.
       */
      outcome: isGuaranteeVisit ? "redo-declined" : "band-declined",
    });
  }

  if (booking.provider_id) {
    await notify({
      recipientId: booking.provider_id as string,
      kind: input.agreed
        ? "booking.priceCorrectionApproved"
        : "booking.priceCorrectionDeclined",
      params: { reference: booking.reference as string },
      bookingId: input.bookingId,
    });
  }

  return { ok: true };
}

/**
 * The trip the professional made before the customer said no.
 *
 * NEVER THROWS, the same rule `recordVisitFee` keeps in lib/data/survey.ts: the
 * decline has already happened and the booking has already ended, so a fee row
 * that cannot be written must not roll either back. The database refuses it
 * outright when no arrival was recorded — no trip, no fee — and that refusal is
 * a normal outcome here rather than an error worth alarming anybody about.
 *
 * Born `pending`. Nothing pays itself; a person decides, which is what stops a
 * fee that pays automatically becoming a route to free money for anybody
 * willing to propose a correction they know will be refused.
 */
async function recordCorrectionVisitFee(input: {
  bookingId: string;
  providerId: string | null;
  outcome: "band-declined" | "redo-declined";
}): Promise<void> {
  if (!input.providerId) return;

  try {
    const { error } = await createAdminClient()
      .from("survey_visit_fees")
      .insert({
        booking_id: input.bookingId,
        provider_id: input.providerId,
        outcome: input.outcome,
        amount: PAYOUT_RULES.surveyVisitFeeNpr,
      });

    // 23505 is one booking answered once — the unique constraint doing its
    // job, not a failure.
    if (error && error.code !== "23505") {
      console.warn(`[bookings] no visit fee recorded — ${describeError(error)}`);
    }
  } catch (thrown) {
    console.warn(`[bookings] visit fee write threw — ${describeError(thrown)}`);
  }
}
