import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ShieldAlert, Wallet } from "lucide-react";

import { AvailabilityToggle } from "@/components/provider/availability-toggle";
import { ClaimCard } from "@/components/provider/claim-card";
import { RateField } from "@/components/provider/rate-field";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { claimsForProvider } from "@/lib/data/claims";
import { getProviderDashboard } from "@/lib/data/provider-profile";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "provider.dashboard",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * The professional's own page: what they charge, whether they are free, what
 * has come back, and what they are owed.
 *
 * FOUR THINGS, AND NO FIFTH. Everything here is either something only they can
 * answer or money that is theirs. Notably absent is a response time field —
 * `avg_response_minutes` is COMPUTED, never typed, because it carries 0.325 of
 * an emergency search between it and availability, and a number worth that much
 * to a ranking is a number that gets typed optimistically by everybody. Phase
 * 12 makes it real from the booking timestamps.
 *
 * `/provider/jobs` stays the place work is done. This page is the listing and
 * the ledger; mixing them would make the busiest screen in the product the one
 * with the settings on it.
 */
export default async function ProviderDashboardPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("provider.dashboard");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Fprovider", locale });
  }

  const messages = await getMessages();
  const dashboard = await getProviderDashboard(profile!.id);

  // Not linked to a listing. `/provider/jobs` already answers this case with
  // the statement that links an account, so this page points there rather than
  // printing a second copy of it — two places explaining the same fix is how
  // they drift apart.
  if (!dashboard) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="animate-rise font-display text-display-md">
          {t("title")}
        </h1>
        <p className="animate-rise mt-4 text-body-md text-muted-foreground">
          {t("unlinked")}
        </p>
        <Button className="animate-rise mt-4" asChild>
          <Link href="/provider/jobs">{t("toJobs")}</Link>
        </Button>
      </div>
    );
  }

  const claims = await claimsForProvider(dashboard.providerId);
  const live = claims.filter((claim) =>
    ["open", "dispatched", "attended"].includes(claim.status),
  );
  const settled = claims.filter((claim) => claim.status === "resolved");

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {dashboard.displayName}
        </p>
      </header>

      {/* Availability first: it is the only thing on this page that is true
          for a few hours rather than for months. */}
      <section className="animate-rise mt-6 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-body-sm font-semibold text-foreground">
          {t("availability.heading")}
        </h2>
        <div className="mt-3">
          <NextIntlClientProvider
            locale={locale}
            messages={{ provider: messages.provider }}
          >
            <AvailabilityToggle
              on={dashboard.availability === "now"}
              minutesLeft={dashboard.availableFor}
            />
          </NextIntlClientProvider>
        </div>
      </section>

      <section className="animate-rise mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-body-sm font-semibold text-foreground">
          {t("rate.heading")}
        </h2>
        <div className="mt-3">
          {dashboard.band ? (
            <NextIntlClientProvider
              locale={locale}
              messages={{ provider: messages.provider }}
            >
              <RateField
                rate={dashboard.baseRate}
                low={dashboard.band.low}
                high={dashboard.band.high}
                currency={locale === "ne" ? "रु" : "Rs"}
              />
            </NextIntlClientProvider>
          ) : (
            <p className="text-caption text-muted-foreground">
              {t("rate.noTrade")}
            </p>
          )}
        </div>
      </section>

      {/* Money. Two numbers, and the second one is a deduction, so it is
          explained rather than printed on its own. */}
      <section className="animate-rise mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
        <h2 className="text-body-sm flex items-center gap-2 font-semibold text-foreground">
          <Wallet aria-hidden="true" className="size-4 text-primary" />
          {t("money.heading")}
        </h2>
        <dl className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-caption text-muted-foreground">
              {t("money.owed")}
            </dt>
            <dd className="text-body-sm font-semibold text-foreground">
              {formatNpr(dashboard.owedRupees, { locale })}
            </dd>
          </div>
          {dashboard.outstandingRupees > 0 ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-caption text-muted-foreground">
                {t("money.outstanding")}
              </dt>
              <dd className="text-body-sm font-semibold text-foreground">
                {formatNpr(dashboard.outstandingRupees, { locale })}
              </dd>
            </div>
          ) : null}
        </dl>
        {dashboard.outstandingRupees > 0 ? (
          <p className="text-caption mt-3 text-muted-foreground">
            {t("money.outstandingExplained")}
          </p>
        ) : null}
      </section>

      <section className="animate-rise mt-4">
        <h2 className="text-body-sm flex items-center gap-2 font-semibold text-foreground">
          <ShieldAlert aria-hidden="true" className="size-4 text-primary" />
          {t("claims.heading")}
        </h2>

        {claims.length === 0 ? (
          <p className="text-caption mt-2 text-muted-foreground">
            {t("claims.none")}
          </p>
        ) : (
          <NextIntlClientProvider
            locale={locale}
            messages={{ provider: messages.provider }}
          >
            <ul className="mt-3 space-y-3">
              {[...live, ...settled].map((claim) => (
                <ClaimCard
                  key={claim.id}
                  claim={{
                    id: claim.id,
                    reference: claim.bookingReference,
                    status: claim.status,
                    description: claim.description,
                    mine: claim.providerId === dashboard.providerId,
                    attending:
                      claim.attendingProviderId === dashboard.providerId,
                    verdict: claim.verdict,
                  }}
                />
              ))}
            </ul>
          </NextIntlClientProvider>
        )}
      </section>
    </div>
  );
}
