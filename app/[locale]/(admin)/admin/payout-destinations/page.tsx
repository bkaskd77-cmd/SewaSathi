import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { ConfirmDestination } from "@/components/admin/confirm-destination";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import {
  destinationsNeedingAttention,
  type WatchedDestination,
} from "@/lib/data/payout-destinations";

import { confirmDestinationAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where money is about to go, and whether anybody has checked.
 *
 * WHY A PERSON IS THE CONTROL HERE. A professional whose payout account is
 * changed is supposed to be told, so that if it was not them they can object
 * inside the three-day window. The notice has no delivery channel: the in-app
 * row has no address and the SMS channel does not exist, so the only place it
 * can be read is a screen somebody has to be signed in to open — which, in the
 * case the notice exists for, is the attacker. `LAUNCH-BLOCKERS.md §
 * payout-notice-undeliverable` says payouts cannot go live on that basis, and
 * until then this card is the warning.
 *
 * TWO GROUPS, ONE READ. "Changed and still cooling" and "waiting to be checked"
 * are the same question at two moments — is money about to go somewhere nobody
 * has looked at. One query, split on screen; two queries could disagree about
 * which row belongs where.
 *
 * NOTHING SHOWS AN ACCOUNT NUMBER **ON THIS SCREEN**, and that is now a statement
 * about this screen rather than about the product. It used to say the reveal path
 * was reached from nowhere "because until a payout run exists nobody on this screen
 * is sending money" — true when it was written and untrue the moment `/admin/payouts`
 * shipped, which is the class of comment this repository keeps paying for. The
 * reveal lives there, beside the payout it is for, where the reason given for it is
 * "I am typing this into a bank". Here there is no payment in hand, so a reveal
 * would be curiosity, and it is still deliberately absent.
 *
 * A FAILED READ IS NOT AN EMPTY QUEUE. "Nothing is waiting" from a broken query
 * is the sentence that tells somebody to go home while an account is being
 * redirected.
 */
export default async function PayoutDestinationsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.payoutDestinations");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/payout-destinations", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about
    // what exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({
      href: "/account/security?next=/admin/payout-destinations",
      locale,
    });
  }

  const [read, messages] = await Promise.all([
    destinationsNeedingAttention(),
    getMessages(),
  ]);

  const rows = read.ok ? read.rows : [];
  /*
   * `readiness` is a discriminated union, so the narrowing is the type system
   * doing the splitting rather than a string compare that can go stale if a
   * fourth reason is ever added — it would fail to compile here instead.
   */
  const cooling = rows.filter(
    (row) => !row.readiness.ok && row.readiness.reason === "cooling",
  );
  const awaiting = rows.filter(
    (row) => !row.readiness.ok && row.readiness.reason === "unconfirmed",
  );

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="text-heading-lg font-display">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      {!read.ok ? (
        <p className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-md">
          {t("unreadable")}
        </p>
      ) : rows.length === 0 ? (
        <p className="animate-rise mt-6 rounded-lg border border-border bg-muted/30 p-4 text-body-md">
          {t("empty")}
        </p>
      ) : (
        <NextIntlClientProvider locale={locale} messages={messages}>
          {cooling.length > 0 ? (
            <section className="animate-rise mt-8">
              <h2 className="text-heading-sm font-display">
                {t("coolingTitle")}
              </h2>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("coolingWhat")}
              </p>
              <ul className="mt-4 space-y-3">
                {cooling.map((row) => (
                  <Row key={row.id} row={row} locale={locale} />
                ))}
              </ul>
            </section>
          ) : null}

          {awaiting.length > 0 ? (
            <section className="animate-rise mt-8">
              <h2 className="text-heading-sm font-display">
                {t("confirmTitle")}
              </h2>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("confirmWhat")}
              </p>
              <ul className="mt-4 space-y-3">
                {awaiting.map((row) => (
                  <Row key={row.id} row={row} locale={locale} confirmable />
                ))}
              </ul>
            </section>
          ) : null}
        </NextIntlClientProvider>
      )}
    </section>
  );
}

async function Row({
  row,
  locale,
  confirmable,
}: {
  row: WatchedDestination;
  locale: Locale;
  confirmable?: boolean;
}) {
  const t = await getTranslations("admin.payoutDestinations");

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body-md font-medium">{row.displayName}</p>
        <p className="font-mono text-body-sm">{row.accountMasked}</p>
      </div>
      <p className="mt-1 text-body-sm text-muted-foreground">
        {row.accountName}
        {row.bankName ? ` · ${row.bankName}` : ""}
      </p>
      <p className="mt-2 text-body-sm">
        {/*
          WHICH OF THE TWO THIS IS, said rather than inferred from a date. A row
          that replaced an earlier account is the one somebody may need to ring
          about; a professional's first account has nobody to warn.
        */}
        <span
          className={
            row.replacedAnother
              ? "text-destructive-ink"
              : "text-muted-foreground"
          }
        >
          {row.replacedAnother ? t("replaced") : t("firstEver")}
        </span>
        {!row.readiness.ok &&
        row.readiness.reason === "cooling" &&
        row.readiness.usableFrom ? (
          <span className="text-muted-foreground">
            {" · "}
            {t("usableFrom", {
              date: formatInstant(
                row.readiness.usableFrom.toISOString(),
                locale,
              ),
            })}
          </span>
        ) : null}
      </p>

      {confirmable ? (
        <ConfirmDestination
          destinationId={row.id}
          action={confirmDestinationAction}
        />
      ) : null}
    </li>
  );
}
