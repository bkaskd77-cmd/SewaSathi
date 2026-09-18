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
import { notify } from "@/lib/notify";
import {
  blocksBooking,
  canServeAt,
  quoteFloor,
  servingWhen,
} from "@/lib/provider";
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
  bandSource: z.enum(["model", "matcher"]).nullish(),
});

const COLUMNS =
  "id, reference, category_slug, provider_id, address_id, status, urgency, description, photo_url, scheduled_for, quoted_min, quoted_max, quote_model, surveyed_at, quote_expires_at, quote_approved_at, quote_declined_at, overbook_offered_by, final_amount, final_amount_reason, final_amount_approved_at, payment_method, payment_status, amount_mismatch_at, customer_reported_amount, created_at, accepted_at, completed_at, cancelled_at, confirmation_required, confirmed_at";

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
  const bandSlug = parsed.data.band
    ? ((await getSubBands()).some(
        (band) =>
          band.categorySlug === category.slug && band.slug === parsed.data.band,
      )
        ? parsed.data.band
        : null)
    : null;

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
  let floor: number | null = survey ? null : category.basePriceMin;

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
    if (!survey) {
      floor = quoteFloor({
        providerRate: provider.baseRate,
        band: { low: category.basePriceMin, high: category.basePriceMax },
      });
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
          quoted_max: survey ? null : category.basePriceMax,
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
