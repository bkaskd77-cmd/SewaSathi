import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { Wallet } from "lucide-react";

import { DestinationForm } from "@/components/provider/destination-form";
import { MoneyView } from "@/components/provider/money";
import { SuspensionNotice } from "@/components/shared/suspension-notice";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { site, supportPhoneDisplay } from "@/lib/config/site";
import {
  currentDestination,
  lastChangedAt,
} from "@/lib/data/payout-destinations";
import { providerStandingFor } from "@/lib/data/enforcement";
import { providerMoney, waitFor } from "@/lib/data/payouts";
import { getMyProvider } from "@/lib/data/provider-jobs";
import { formatInstant } from "@/lib/booking";

import { changeDestinationAction } from "../actions";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const t = await getTranslations({
    locale: params.locale,
    namespace: "provider.payouts",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

/**
 * Where a professional's money goes — their own view of it.
 *
 * SERVER-RENDERED, AND THE NUMBER IS NEVER WHOLE. `currentDestination` masks
 * before anything leaves the data layer, so there is no response, cache or
 * screenshot carrying an account number. Showing somebody their own number in
 * full tells them nothing they do not already know.
 *
 * THE CHANGE NOTICE IS READ FROM THE TABLE, NOT FROM A NOTIFICATION. A
 * `payout.destinationChanged` row exists and has no surface — the in-app channel
 * has no delivery address and the SMS channel does not exist yet — so a screen
 * waiting on it would show nothing at the moment it matters most. The retired
 * row's `retired_at` is the same fact and is already durable.
 *
 * THE RULES ARE STATED, NOT LEFT TO BE INFERRED. A first destination is usable
 * at once and still unpayable until a person checks it; a changed one waits three
 * days. Those are the same `usable_from` field with opposite meanings for the
 * reader, which is why `changeDestination` returns `isFirst` rather than leaving
 * a screen to work it out by comparing timestamps.
 */
export default async function PayoutsPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const params = await props.params;
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: "provider.payouts" });

  const profile = await getSessionProfile();
  if (!profile) redirect({ href: "/login?next=/provider/payouts", locale });

  const me = await getMyProvider(profile!.id);
  if (!me) redirect({ href: "/provider", locale });

  /*
   * ONE WAVE. Three reads, none depending on another — the standing latency rule,
   * and this screen is opened from Kathmandu against a database in Singapore.
   */
  const [read, changedAt, money, standing] = await Promise.all([
    currentDestination(me!.providerId),
    lastChangedAt(me!.providerId),
    providerMoney(me!.providerId),
    /*
     * WHETHER THE LISTING IS UNDER ENFORCEMENT, in the same wave because nothing
     * here depends on it. It belongs on THIS screen above all others: step 4 of
     * the published ladder HOLDS EARNINGS, so a professional under it comes
     * looking exactly here, finds a balance that is not moving, and would
     * otherwise have no sentence anywhere telling them why or how to appeal.
     * `whyWaiting` says what a held payout is waiting on and deliberately does
     * not say "you are under review" — that is this notice's job.
     */
    providerStandingFor(profile!.id),
  ]);

  const destination = read.ok ? read.destination : null;
  const messages = await getMessages();

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="animate-rise">
        <p className="text-body-sm text-muted-foreground">
          <Link href="/provider" className="underline-offset-4 hover:underline">
            {site.name}
          </Link>
        </p>
        <h1 className="text-heading-lg mt-1 flex items-center gap-2 font-display">
          <Wallet className="size-6 text-primary" aria-hidden />
          {t("title")}
        </h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      {/*
        THE ENFORCEMENT NOTICE ABOVE THE MONEY, and that ordering is the point.
        Step 4 holds earnings, so the figure below this is the thing the reader
        came for and the thing the step has stopped — a balance that will not move
        with no explanation anywhere is how a working process comes to feel
        arbitrary. `instead`'s rule from the triage ceilings: a limit goes above
        the answer it refused. Null is "we could not tell" and renders nothing.
      */}
      {standing?.step != null ? (
        <div className="mt-6">
          <SuspensionNotice audience="provider" reason={standing.reason} />
        </div>
      ) : null}

      {/*
        THE MONEY FIRST, THE ADDRESS SECOND. Somebody opening this screen is asking
        "where is my money", not "what account is on file" — the address is how the
        answer gets delivered, not the answer. It was the whole page until now
        because there was nothing to pay out; there is now.
      */}
      <MoneyView money={money} wait={waitFor(money)} locale={locale} />

      {!read.ok ? (
        /*
         * A FAILED READ IS NOT AN EMPTY ONE. "You have not told us where to send
         * your earnings" is the wrong sentence for a database that did not
         * answer — it asks somebody to re-enter a bank account over a blip.
         */
        <p className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-md">
          {t("unreadable")}
        </p>
      ) : destination === null ? (
        <p className="animate-rise mt-6 rounded-lg border border-border bg-muted/30 p-4 text-body-md">
          {t("none")}
        </p>
      ) : (
        <dl className="animate-rise mt-6 space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-body-sm text-muted-foreground">
              {t("accountLabel")}
            </dt>
            <dd className="font-mono text-body-md">
              {destination.accountMasked}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-body-sm text-muted-foreground">
              {t("nameLabel")}
            </dt>
            <dd className="text-body-md">{destination.accountName}</dd>
          </div>
          {destination.bankName ? (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-body-sm text-muted-foreground">
                {t("bankLabel")}
              </dt>
              <dd className="text-body-md">{destination.bankName}</dd>
            </div>
          ) : null}

          <p className="border-t border-border pt-3 text-body-sm text-muted-foreground">
            {destination.readiness.ok
              ? t("readyOk")
              : destination.readiness.reason === "cooling"
                ? t("readyCooling", {
                    date: formatInstant(
                      destination.readiness.usableFrom!.toISOString(),
                      locale,
                    ),
                  })
                : /*
                   * `unconfirmed` reads differently depending on how it got
                   * there, which is why `changedAt` decides the sentence. A
                   * first destination is waiting on a person and nothing else;
                   * one that replaced another has already served its three days.
                   */
                  changedAt === null
                  ? t("readyFirst")
                  : t("readyUnconfirmed")}
          </p>

          {changedAt ? (
            <p className="text-body-sm">
              <span className="text-muted-foreground">
                {t("changedOn", {
                  date: formatInstant(changedAt.toISOString(), locale),
                })}
              </span>{" "}
              {/*
                THE NUMBER IS GUARDED, because `site.supportPhone` can be unset
                and "ring null now" is worse than not offering a call. The date
                still shows: knowing it changed is the half that matters, and
                telling somebody to ring a number we do not have would send them
                looking for one.
              */}
              {supportPhoneDisplay ? (
                <strong className="text-destructive-ink">
                  {t("changedNotYou", { phone: supportPhoneDisplay })}
                </strong>
              ) : null}
            </p>
          ) : null}
        </dl>
      )}

      <NextIntlClientProvider locale={locale} messages={messages}>
        <DestinationForm
          action={changeDestinationAction}
          hasDestination={destination !== null}
        />
      </NextIntlClientProvider>
    </section>
  );
}
