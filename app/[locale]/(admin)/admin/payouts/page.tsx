import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { PayoutActions } from "@/components/admin/payout-actions";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { payoutsForReview, type PayoutForReview } from "@/lib/data/payouts";
import { formatNpr } from "@/lib/utils/format";

import {
  approvePayoutAction,
  markConfirmedAction,
  markFailedAction,
  markSentAction,
  revealDestinationAction,
} from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The money about to leave, and who agreed to it.
 *
 * WHY A PERSON IS THE CONTROL. `runPayouts` can only ever create drafts —
 * `payout_transition_allowed` refuses `draft -> sent` however it is called — so
 * nothing reaches a rail without somebody reading it. That is not a convenience to
 * be optimised away later: a cron that could send money is a cron whose bug sends
 * money.
 *
 * THE THREE LINES ARE SHOWN TOGETHER AND THE DIFFERENCE IS NAMED. `earnings` and
 * `commission` are what the week's own rows put into the account; `net` is the
 * whole position, so a recovery taken off a debt, a week they owed us and a payout
 * held last Tuesday all sit in `carried`. Printing the net alone would be a figure
 * somebody approves without being able to check it, and printing the two lines
 * alone would be arithmetic that does not add up.
 *
 * A HELD PAYOUT CARRIES ITS REASON AND NO BUTTONS. There is nothing for a person
 * to decide: a cooling destination, an unconfirmed one and no destination at all are
 * each resolved somewhere else, and `approvePayout` refuses a held row anyway. The
 * screen says which it is rather than offering an action that would be declined.
 *
 * `held.negative` IS DEFENSIVE AND THE RUN NO LONGER PRODUCES IT. A week they owe us
 * drafts nothing, because a payout row is an instruction to pay and there is no such
 * instruction — see `runPayouts`. The value stays in the column's check constraint
 * and the sentence stays in both catalogues, so a row written by hand or by a future
 * rule renders an explanation rather than its own key path; it is not dead copy
 * pretending to be live, which is why it is said here.
 *
 * A FAILED READ IS NOT AN EMPTY QUEUE — the `/services` rule, on the screen where
 * it decides whether anybody gets paid this week.
 */
export default async function PayoutsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.payouts");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/payouts", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about what
    // exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/payouts", locale });
  }

  const [rows, messages] = await Promise.all([payoutsForReview(), getMessages()]);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      {rows === null ? (
        <p className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-md">
          {t("unreadable")}
        </p>
      ) : rows.length === 0 ? (
        <div className="animate-rise mt-6 rounded-lg border border-border bg-muted/30 p-4">
          <p className="text-body-md">{t("empty")}</p>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {t("emptyWhen")}
          </p>
        </div>
      ) : (
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ul className="mt-8 space-y-4">
            {rows.map((row, index) => (
              <li
                key={row.id}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
              >
                <Row row={row} locale={locale} />
              </li>
            ))}
          </ul>
        </NextIntlClientProvider>
      )}

      <p className="mt-8 text-body-sm text-muted-foreground">
        {t.rich("destinationsLink", {
          link: (chunks) => (
            <Link
              href="/admin/payout-destinations"
              className="underline underline-offset-2"
            >
              {chunks}
            </Link>
          ),
        })}
      </p>
    </section>
  );
}

async function Row({ row, locale }: { row: PayoutForReview; locale: Locale }) {
  const t = await getTranslations("admin.payouts");
  const money = (amount: number) => formatNpr(amount, { locale });

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-body-md font-medium">
          {row.providerName ?? t("unnamed")}
        </p>
        <p className="text-body-md font-medium">{money(row.net)}</p>
      </div>

      <p className="mt-1 text-body-sm text-muted-foreground">
        {t("period", {
          from: formatInstant(row.periodStart.toISOString(), locale),
          to: formatInstant(row.periodEnd.toISOString(), locale),
        })}
        {" · "}
        {t(`statuses.${row.status}` as "statuses.draft")}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t("earnings")}</dt>
          <dd>{money(row.earnings)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("commission")}</dt>
          <dd>{money(row.commission)}</dd>
        </div>
        {/*
          `carried` IS PRINTED WHENEVER IT IS NOT ZERO, including when it is
          negative. Hiding a negative would make a week they owe us read as a week
          with nothing in it, which is the one case somebody most needs to see
          before they approve anything.
        */}
        {row.carried !== 0 ? (
          <div>
            <dt className="text-muted-foreground">{t("carried")}</dt>
            <dd>{money(row.carried)}</dd>
          </div>
        ) : null}
      </dl>

      {row.destination ? (
        <p className="mt-3 text-body-sm">
          <span className="font-mono">{row.destination.masked}</span>
          <span className="text-muted-foreground">
            {" · "}
            {row.destination.name}
            {" · "}
            {t(`methods.${row.destination.kind}` as "methods.bank")}
          </span>
        </p>
      ) : null}

      {row.externalReference ? (
        <p className="mt-2 text-body-sm text-muted-foreground">
          {t("sentWith", { reference: row.externalReference })}
        </p>
      ) : null}

      {row.heldReason ? (
        <p className="mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-body-sm">
          {t(`held.${row.heldReason}` as "held.cooling")}
        </p>
      ) : row.destination === null || row.destination.id !== row.destinationId ? (
        /*
          THE ACCOUNT CHANGED SINCE THIS WAS DRAFTED, and no button is offered
          because both money-moving actions refuse it server-side — the screen
          would otherwise invite somebody to press a thing that cannot work. It is
          also the shape of a takeover: a draft agreed against a confirmed account,
          then the address moved. The new row has its own 72-hour window and its own
          confirmation, and next Tuesday's run drafts against it.
        */
        <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body-sm">
          {t("destinationChanged")}
        </p>
      ) : (
        <PayoutActions
          payoutId={row.id}
          status={row.status as "draft" | "approved" | "sent"}
          destinationId={row.destinationId}
          approve={approvePayoutAction}
          markSent={markSentAction}
          markConfirmed={markConfirmedAction}
          markFailed={markFailedAction}
          reveal={revealDestinationAction}
        />
      )}
    </>
  );
}
