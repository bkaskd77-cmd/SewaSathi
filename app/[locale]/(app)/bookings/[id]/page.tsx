import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ArrowLeft, MapPin, Phone } from "lucide-react";

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
import { formatSlotInstant } from "@/lib/booking";
import { customerCanCancel } from "@/lib/booking";
import { areaLabel, findArea } from "@/lib/config/areas";
import { site } from "@/lib/config/site";
import { categoryCopy } from "@/lib/config/services";
import { getAddress } from "@/lib/data/addresses";
import { signBookingPhoto } from "@/lib/data/booking-photos";
import { getBooking } from "@/lib/data/bookings";
import { getCategory } from "@/lib/data/categories";
import { markBookingRead } from "@/lib/data/notifications";
import { listPaymentsForBooking } from "@/lib/data/payments";
import { getProviderPhone } from "@/lib/data/provider-jobs";
import { getProvider } from "@/lib/data/providers";
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

  const area = address ? findArea(address.areaKey) : null;
  const ended = booking.status === "cancelled" || booking.status === "no_provider_found";

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
  const inFlight = payments.find((p) => p.status === "initiated");
  const cashWaiting = payments.find(
    (p) => p.method === "cash" && p.status === "pending",
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
        : inFlight
          ? "processing"
          : cashWaiting
            ? "cashPending"
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
        <LiveProgress bookingId={booking.id} initialStatus={booking.status} />
      </NextIntlClientProvider>

      {provider && !ended ? (
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
            reference={(inFlight ?? cashWaiting)?.ourReference ?? null}
            receipt={
              settled
                ? {
                    reference: settled.ourReference,
                    method: settled.method,
                    amountLabel: formatNpr(settled.amount, { locale }),
                    settledAt: formatSlotInstant(
                      settled.settledAt ?? settled.createdAt,
                    ),
                    providerTxnId: settled.providerTxnId,
                  }
                : null
            }
            failureReason={lastFailed?.failureReason ?? null}
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
}: {
  i: number;
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div style={{ ["--i" as string]: i }} className="p-4">
      <dt className="text-caption uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-body-md">{value}</dd>
      {hint ? (
        <dd className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
          <MapPin aria-hidden="true" className="size-3 shrink-0" />
          {hint}
        </dd>
      ) : null}
    </div>
  );
}
