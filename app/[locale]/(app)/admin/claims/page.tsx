import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { MapPin, MapPinOff, Phone } from "lucide-react";

import { ClaimDecision } from "@/components/admin/claim-decision";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { openNoShowClaims } from "@/lib/data/review";
import { formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Wasted trips waiting on a person.
 *
 * WHAT THIS SCREEN IS ACTUALLY DECIDING. Not whether to pay the professional —
 * that has usually already happened, or will regardless. It is deciding who
 * ends up carrying the Rs 350: the customer, through their next bill, or us.
 * Saying that out loud at the top matters, because a reviewer who thinks they
 * are deciding a professional's wages reads the evidence very differently from
 * one who knows they are deciding a write-off.
 *
 * THE EVIDENCE IS THE PAGE. How long they waited, how many times they rang,
 * whether the phone gave a location, whether the customer had confirmed, and
 * whether that door has ever worked before. Each one is a sentence rather than
 * a flag, because a reviewer acts on sentences.
 */
export default async function ClaimsQueuePage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.claims");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=/admin/claims", locale });
  }
  if (profile!.role !== "admin") notFound();

  const [claims, messages] = await Promise.all([
    openNoShowClaims(),
    getMessages(),
  ]);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {claims.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {claims.map((claim, index) => (
            <li
              key={claim.id}
              className="animate-rise rounded-lg border border-border p-5"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {claim.providerName ?? "—"}
                </span>
                <span className="text-caption text-muted-foreground">
                  {claim.reference}
                </span>
              </div>

              <p className="mt-2 text-body-sm">
                {t("waited", {
                  minutes: String(claim.waitedMinutes),
                  calls: String(claim.contactAttempts),
                })}
              </p>

              <ul className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  {claim.hasLocation ? (
                    <MapPin aria-hidden="true" className="size-4" />
                  ) : (
                    <MapPinOff aria-hidden="true" className="size-4" />
                  )}
                  {claim.hasLocation ? t("located") : t("noLocation")}
                </li>
                {claim.customerConfirmed ? (
                  <li className="flex items-center gap-1.5 text-warning-ink">
                    <Phone aria-hidden="true" className="size-4" />
                    {t("customerConfirmed")}
                  </li>
                ) : null}
                {claim.addressProven ? (
                  <li className="text-warning-ink">{t("addressProven")}</li>
                ) : null}
                {claim.customerDisputed ? (
                  <li className="text-warning-ink">{t("disputed")}</li>
                ) : null}
              </ul>

              {claim.customerNote ? (
                <p className="mt-3 rounded-md border border-border p-3 text-body-sm">
                  {claim.customerNote}
                </p>
              ) : null}

              <p className="mt-3 text-caption text-muted-foreground">
                {claim.wouldBeAbsorbed
                  ? t("absorbed")
                  : t("recovered")}
                {" · "}
                {t("paid", { amount: formatNpr(claim.tripRupees, { locale }) })}
              </p>

              <NextIntlClientProvider
                locale={locale}
                messages={{ admin: messages.admin }}
              >
                <ClaimDecision bookingId={claim.bookingId} />
              </NextIntlClientProvider>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
