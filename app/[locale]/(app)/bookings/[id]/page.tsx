import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ArrowLeft, MapPin, Phone } from "lucide-react";

import { CancelBooking } from "@/components/booking/cancel-booking";
import { StatusBadge } from "@/components/booking/status-badge";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { formatSlotInstant } from "@/lib/booking/schedule";
import {
  BOOKING_PROGRESS,
  customerCanCancel,
  progressIndex,
} from "@/lib/booking/status";
import { areaLabel, findArea } from "@/lib/config/areas";
import { categoryCopy } from "@/lib/config/services";
import { getAddress } from "@/lib/data/addresses";
import { signBookingPhoto } from "@/lib/data/booking-photos";
import { getBooking } from "@/lib/data/bookings";
import { getCategory } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { cn, formatNpr } from "@/lib/utils";

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
  const tStatus = await getTranslations("booking.status");
  const tNext = await getTranslations("booking.whatNext");
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

  const [category, address, provider, photoUrl] = await Promise.all([
    getCategory(booking.categorySlug),
    getAddress(booking.addressId),
    booking.providerId ? getProvider(booking.providerId) : Promise.resolve(null),
    signBookingPhoto(booking.photoUrl),
  ]);

  const area = address ? findArea(address.areaKey) : null;
  const stepIndex = progressIndex(booking.status);
  const ended = booking.status === "cancelled" || booking.status === "no_provider_found";

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

      {/* What happens next, in words. A badge alone tells nobody what to do. */}
      <div
        className="animate-rise mt-6 rounded-xl border border-primary/25 bg-primary/[0.05] p-4"
        style={{ animationDelay: "80ms" }}
      >
        <p className="text-body-sm font-semibold text-primary">
          {tStatus(booking.status)}
        </p>
        <p className="mt-1 text-body-md">{tNext(booking.status)}</p>
      </div>

      {/* Where it has got to. Cancelled and no-provider are ends, not stages,
          so the track is hidden rather than shown frozen part-way. */}
      {!ended ? (
        <ol
          className="animate-rise mt-6 flex gap-1"
          style={{ animationDelay: "120ms" }}
          aria-label={t("progressLabel")}
        >
          {BOOKING_PROGRESS.map((step, i) => {
            const done = i <= stepIndex;
            return (
              <li key={step} className="flex-1">
                <div
                  className={cn(
                    "h-1.5 rounded-full transition-colors duration-300",
                    done ? "bg-primary" : "bg-muted",
                  )}
                />
                <p
                  className={cn(
                    "mt-1.5 truncate text-caption",
                    i === stepIndex
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {tStatus(step)}
                </p>
              </li>
            );
          })}
        </ol>
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
          <a href="tel:+9779800000000">
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
