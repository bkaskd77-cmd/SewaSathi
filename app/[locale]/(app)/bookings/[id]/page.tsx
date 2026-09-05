import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ArrowLeft, MapPin, Phone, ShieldCheck } from "lucide-react";

import {
  Alternatives,
  type AlternativeOption,
} from "@/components/booking/alternatives";
import { CancelBooking } from "@/components/booking/cancel-booking";
import { LiveProgress } from "@/components/booking/live-progress";
import { ProviderCard } from "@/components/booking/provider-card";
import {
  PaymentPanel,
  type PaymentStage,
} from "@/components/booking/payment-panel";
import { StatusBadge } from "@/components/booking/status-badge";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { formatInstant, formatSlotInstant } from "@/lib/booking";
import { customerCanCancel } from "@/lib/booking";
import { areaLabel, findArea } from "@/lib/config/areas";
import { site } from "@/lib/config/site";
import { categoryCopy } from "@/lib/config/services";
import { getAddress } from "@/lib/data/addresses";
import { signBookingPhoto } from "@/lib/data/booking-photos";
import { getBooking, listRefusals } from "@/lib/data/bookings";
import { getCategory } from "@/lib/data/categories";
import { markBookingRead } from "@/lib/data/notifications";
import { listPaymentsForBooking } from "@/lib/data/payments";
import { getProviderPhone } from "@/lib/data/provider-jobs";
import { getProvider, listAlternatives } from "@/lib/data/providers";
import { availableMethods, judgeFinalAmount } from "@/lib/payments";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return {
    title: t("bookingsTitle"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";



/**
 * One booking.
 *
 * Live tracking is Phase 8. What this page owes the customer now is the two
 * things they actually came back for: where their job has got to, and what
 * happens next — stated in words, not implied by a badge.
 */
export default async function BookingDetailPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.detail");
  const tServices = await getTranslations("services");
  const tAlternatives = await getTranslations("booking.alternatives");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({
      href: `/login?next=${encodeURIComponent(`/bookings/${params.id}`)}`,
      locale,
    });
  }

  const messages = await getMessages();
  const booking = await getBooking(params.id);
  // RLS already limits this to the customer's own rows, so "not found" and
  // "not yours" are the same answer here — which is the right answer to give.
  if (!booking) notFound();

  const [category, address, provider, photoUrl, payments] = await Promise.all([
    getCategory(booking.categorySlug),
    getAddress(booking.addressId),
    booking.providerId ? getProvider(booking.providerId) : Promise.resolve(null),
    signBookingPhoto(booking.photoUrl),
    listPaymentsForBooking(booking.id),
  ]);

  // RLS releases this only while the job is accepted, on the way or under way,
  // so an unassigned or finished booking simply gets null and the card falls
  // back to the support line.
  // Looking at the booking is reading the notifications about it. Guarded on
  // `read_at is null`, so it is a no-op on every render after the first.
  await markBookingRead(profile!.id, booking.id);

  const providerPhone = booking.providerId
    ? await getProviderPhone(booking.providerId)
    : null;

  /*
   * DID SOMEBODY WALK AWAY FROM THIS JOB?
   *
   * `pending` on its own means "waiting", and that is what the page said in
   * both cases — the ordinary wait after booking, and the very different one
   * where the professional the customer chose has just pulled out. The second
   * is not a wait at all: it is a decision the customer has to make again, and
   * they can only make it if we hand them somebody to make it about.
   */
  const refusals = booking.status === "pending" ? await listRefusals(booking.id) : [];
  const released = refusals.length > 0;

  /*
   * The replacements.
   *
   * Whoever refused is excluded — offering somebody back the job they just
   * turned down is the one thing this list must never do — and so is the
   * customer's original choice if they are the one who refused. The widening
   * from ward to city to anywhere is `pickAlternatives`; the empty case is
   * handled inside the component, because "nobody is free" needs a phone
   * number rather than a blank space.
   */
  const alternatives = released
    ? await listAlternatives({
        category: booking.categorySlug,
        area: address?.areaKey ?? null,
        urgency: booking.urgency,
        exclude: refusals.map((refusal) => refusal.providerId),
      })
    : [];

  const options: AlternativeOption[] = alternatives.map((option) => ({
    id: option.provider.id,
    name: option.provider.displayName,
    photoUrl: option.provider.photoUrl,
    verified: option.provider.isVerified,
    reach: option.reach,
    ratingLabel: `${option.provider.stats.ratingAvg.toFixed(1)} (${option.provider.stats.ratingCount})`,
    jobsLabel: tAlternatives("jobsDone", {
      n: String(option.provider.stats.jobsCompleted),
    }),
    rateLabel: tAlternatives("from", {
      amount: formatNpr(option.provider.baseRate, { locale }),
    }),
    availability: option.provider.availability,
  }));

  const area = address ? findArea(address.areaKey) : null;
  const ended = booking.status === "cancelled" || booking.status === "no_provider_found";

  // The contact card's window, and it mirrors the RLS policy on
  // provider_contacts exactly: the phone is released while a job is live and
  // taken back when it is over.
  const showsProvider =
    booking.status === "accepted" ||
    booking.status === "en_route" ||
    booking.status === "in_progress";

  /*
   * Which of the payment stages this booking is at.
   *
   * Worked out here rather than in the panel so the screen and the server
   * agree on one judgement — `startPayment` re-checks all of it before any
   * money moves, and a second implementation in the browser could only drift.
   * Order matters: settled wins over everything, and an unapproved amount
   * blocks the pay button rather than sitting alongside it.
   */
  const settled = payments.find(
    (p) => p.status === "paid" || p.status === "partially_refunded",
  );
  // "In flight" means a gateway is holding the customer's money in limbo, and
  // that is the ONLY thing "Checking your payment" should ever describe. Cash
  // is excluded explicitly: there is no service to confirm with, so a cash row
  // shown as processing tells somebody to wait for an answer that will never
  // come. It is the customer confirming that settles it, and until they do,
  // whatever status the row happens to hold, the screen owes them that button.
  const inFlight = payments.find(
    (p) => p.method !== "cash" && p.status === "initiated",
  );
  const cashWaiting = payments.find(
    (p) => p.method === "cash" && (p.status === "pending" || p.status === "initiated"),
  );
  const lastFailed = payments.find((p) => p.status === "failed");

  const stage: PaymentStage = settled
    ? "paid"
    : booking.finalAmount === null
      ? booking.status === "completed"
        ? "awaitingAmount"
        : "notYet"
      : !booking.finalAmountApprovedAt
        ? "needsApproval"
        : cashWaiting
          ? "cashPending"
          : inFlight
            ? "processing"
            : "ready";

  const verdict =
    booking.finalAmount !== null
      ? judgeFinalAmount(booking.finalAmount, {
          min: booking.quotedMin,
          max: booking.quotedMax,
        })
      : null;

  const quoteLabel = `${formatNpr(booking.quotedMin, { locale })}–${formatNpr(booking.quotedMax, { locale })}`;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Button variant="ghost" size="sm" asChild className="animate-rise -ml-2">
        <Link href="/bookings">
          <ArrowLeft aria-hidden="true" />
          {t("back")}
        </Link>
      </Button>

      <header className="animate-rise mt-3" style={{ animationDelay: "40ms" }}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-display-md">
            {category ? categoryCopy(category, locale).name : booking.categorySlug}
          </h1>
          <StatusBadge status={booking.status} />
        </div>
        <p className="mt-2 font-display text-display-sm tracking-wide tabular-nums text-muted-foreground">
          {booking.reference}
        </p>
      </header>

      {/* Status and progress, live. Scoped provider: `booking` is server-only
          in the root layout, and this is the Client Component that needs it. */}
      <NextIntlClientProvider
        locale={locale}
        messages={{ booking: messages.booking }}
      >
        {/* The banner reads the booking status AND the payment status. It used
            to read only the first, so a settled job still told the customer to
            "pay the agreed amount directly to your professional" — two
            sentences on one screen contradicting each other, about money. */}
        <LiveProgress
          bookingId={booking.id}
          initialStatus={booking.status}
          settled={Boolean(settled)}
          released={released}
        />
      </NextIntlClientProvider>

      {/* Somebody said no. This is the answer to it, and it sits directly
          under the banner that delivered the news rather than at the bottom of
          the page: the customer's next action should be the next thing they
          see. */}
      {released ? (
        <NextIntlClientProvider
          locale={locale}
          messages={{ booking: messages.booking }}
        >
          <Alternatives
            bookingId={booking.id}
            options={options}
            categoryHref={`/services/${booking.categorySlug}`}
            supportPhone={site.supportPhone}
          />
        </NextIntlClientProvider>
      ) : null}

      {/* Only from acceptance onward. Before that nobody has agreed to the job,
          and showing the card at `pending` said "we do not have a number for
          them yet" — which reads as a missing record when in fact the policy
          is deliberately withholding it until someone accepts. The status card
          above already says a professional is being found. */}
      {provider && showsProvider ? (
        <ProviderCard
          name={provider.displayName}
          photoUrl={provider.photoUrl}
          phone={providerPhone}
          verified={provider.isVerified}
          labels={{
            heading: t("providerCard.heading"),
            call: t("providerCard.call", { name: provider.displayName }),
            callSupport: t("callSupport"),
            verified: t("providerVerified"),
            noPhone: t("providerCard.noPhone"),
            supportPhone: site.supportPhone,
          }}
        />
      ) : null}

      <dl className="assemble mt-6 divide-y divide-border rounded-xl border border-border">
        <Row i={0} label={t("problem")} value={booking.description} />

        {photoUrl ? (
          <div style={{ ["--i" as string]: 1 }} className="p-4">
            <dt className="text-caption uppercase text-muted-foreground">
              {t("photo")}
            </dt>
            <dd className="mt-2">
              {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL from private storage; next/image would need it allow-listed and it expires. */}
              <img
                src={photoUrl}
                alt={t("photoAlt")}
                className="max-h-64 rounded-lg border border-border object-cover"
              />
            </dd>
          </div>
        ) : null}

        <Row
          i={2}
          label={t("address")}
          value={
            address
              ? `${address.tole} · ${
                  area
                    ? areaLabel(
                        area,
                        locale,
                        tServices("ward", { n: String(area.wardNumber) }),
                      )
                    : address.city
                }`
              : t("addressMissing")
          }
          hint={address ? t("landmarkHint", { landmark: address.landmark }) : null}
          hintIcon={MapPin}
        />

        <Row
          i={3}
          label={t("when")}
          value={
            booking.scheduledFor
              ? formatSlotInstant(booking.scheduledFor)
              : t("asap")
          }
        />

        <Row
          i={4}
          label={t("provider")}
          value={provider ? provider.displayName : t("providerPending")}
          hint={
            provider && provider.isVerified ? t("providerVerified") : null
          }
          hintIcon={ShieldCheck}
        />

        <Row
          i={5}
          label={t("price")}
          value={
            booking.finalAmount !== null
              ? formatNpr(booking.finalAmount, { locale })
              : `${formatNpr(booking.quotedMin, { locale })}–${formatNpr(booking.quotedMax, { locale })}`
          }
          hint={booking.finalAmount === null ? t("priceEstimate") : t("priceFinal")}
        />

        <Row i={6} label={t("payment")} value={t(`payments.${booking.paymentMethod}`)} />
      </dl>

      {/* Money. Hidden on a booking that ended before anyone worked — there
          is nothing to pay and offering to would be alarming. */}
      {!ended ? (
        <NextIntlClientProvider
          locale={locale}
          messages={{ booking: messages.booking }}
        >
          <PaymentPanel
            bookingId={booking.id}
            stage={stage}
            quoteLabel={quoteLabel}
            finalLabel={
              booking.finalAmount !== null
                ? formatNpr(booking.finalAmount, { locale })
                : null
            }
            finalAmount={booking.finalAmount}
            overByLabel={
              verdict?.outcome === "needs-approval"
                ? formatNpr(verdict.overBy, { locale })
                : null
            }
            reason={booking.finalAmountReason}
            methods={availableMethods()}
            defaultMethod={booking.paymentMethod}
            // Same precedence as the stage above, so the reference always
            // belongs to the attempt the panel is actually showing.
            reference={(cashWaiting ?? inFlight)?.ourReference ?? null}
            receipt={
              settled
                ? {
                    reference: settled.ourReference,
                    method: settled.method,
                    amountLabel: formatNpr(settled.amount, { locale }),
                    // A payment happens at a moment. formatSlotInstant is for
                    // booking windows and rendered "2026-09-04 · 16:00 – 18:00"
                    // here — an hour it did not happen and a range that means
                    // nothing for an event.
                    settledAt: formatInstant(
                      settled.settledAt ?? settled.createdAt,
                      locale,
                    ),
                    providerTxnId: settled.providerTxnId,
                  }
                : null
            }
            failureReason={lastFailed?.failureReason ?? null}
            inFlightSince={inFlight?.initiatedAt ?? null}
            supportPhone={site.supportPhone}
          />
        </NextIntlClientProvider>
      ) : null}

      <div className="animate-rise mt-6 flex flex-wrap items-center gap-3">
        {customerCanCancel(booking.status) ? (
          // Scoped provider: `booking` is server-only in the root layout, and
          // the cancel dialog is the one Client Component here that needs it.
          <NextIntlClientProvider
            locale={locale}
            messages={{ booking: messages.booking }}
          >
            <CancelBooking bookingId={booking.id} />
          </NextIntlClientProvider>
        ) : null}
        <Button variant="ghost" size="sm" asChild>
          <a href={`tel:${site.supportPhone}`}>
            <Phone aria-hidden="true" />
            {t("callSupport")}
          </a>
        </Button>
      </div>
    </div>
  );
}

function Row({
  i,
  label,
  value,
  hint,
  hintIcon: HintIcon,
}: {
  i: number;
  label: string;
  value: string;
  hint?: string | null;
  /**
   * Opt-in, and that is the fix.
   *
   * Every hint used to get a location pin, so "ID verified" and "Final, agreed
   * on site" both rendered under a map marker. An icon that appears regardless
   * of meaning stops carrying any — and a pin in particular makes a promise
   * about a place. Only the address row asks for one now.
   */
  hintIcon?: typeof MapPin;
}) {
  return (
    <div style={{ ["--i" as string]: i }} className="p-4">
      <dt className="text-caption uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-body-md">{value}</dd>
      {hint ? (
        <dd className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
          {HintIcon ? (
            <HintIcon aria-hidden="true" className="size-3 shrink-0" />
          ) : null}
          {hint}
        </dd>
      ) : null}
    </div>
  );
}
