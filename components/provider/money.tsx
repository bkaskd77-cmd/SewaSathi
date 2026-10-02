import { getTranslations } from "next-intl/server";
import { ArrowRight, Clock, Wallet } from "lucide-react";

import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { formatInstant } from "@/lib/booking";
import type { ProviderMoney } from "@/lib/data/payouts";
import type { PayoutWait } from "@/lib/payments/client";
import { formatNpr } from "@/lib/utils";

/**
 * What a professional is owed, said once.
 *
 * TWO RENDERINGS, ONE SET OF FIGURES. `/provider/payouts` owns the money view and
 * `/provider` shows a summary that links to it; both are handed the same
 * `ProviderMoney` from the same `providerMoney()` read, so they cannot disagree
 * about what somebody is owed. `tests/db/provider-money.test.ts` asserts that
 * equality against a database rather than trusting this comment.
 *
 * NO CLIENT JAVASCRIPT. Every figure here is server-rendered and nothing on the
 * screen is interactive, which matters more here than almost anywhere: a
 * professional checking whether they have been paid is often on a connection that
 * never finishes loading a bundle, and this page has to be correct in that state.
 *
 * RULE 6 RUNS THROUGH ALL OF IT. `ok: false` is its own sentence, never zeroes —
 * "you are owed nothing" from a broken query is the most expensive thing this
 * screen could print. And a professional with nothing settled yet is told there is
 * nothing to measure rather than shown Rs 0, which reads as a disappointing
 * result rather than as an empty start.
 */

async function Waiting({ wait }: { wait: PayoutWait }) {
  const t = await getTranslations("provider.money");

  if (wait.state === "nothing") return null;

  if (wait.state === "unreadable") {
    return (
      <p className="animate-rise mt-3 rounded-md border border-warning/40 bg-warning/5 p-3 text-body-sm">
        {t("unreadable")}
      </p>
    );
  }

  /*
   * THE REASON IS NEVER A WARNING COLOUR WHEN IT IS OURS TO FIX. An approval
   * waiting on us and an account the professional has not told us about are
   * different news, and colouring both as a problem would read as blaming them for
   * our queue. Only the ones they can act on are tinted.
   */
  const theirs =
    wait.state === "held" &&
    (wait.reason === "no_destination" || wait.reason === "cooling");

  return (
    <p
      className={`animate-rise mt-3 flex items-start gap-2 rounded-md border p-3 text-body-sm ${
        theirs
          ? "border-warning/40 bg-warning/5"
          : "border-border bg-muted/30 text-muted-foreground"
      }`}
    >
      <Clock aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {wait.state === "held"
          ? t(`waiting.${wait.reason}` as "waiting.cooling")
          : wait.state === "onItsWay"
            ? t("waiting.onItsWay")
            : t("waiting.approval", {
                count: wait.days,
                n: String(wait.days),
              })}
      </span>
    </p>
  );
}

/** The whole thing, for `/provider/payouts`. */
export async function MoneyView({
  money,
  wait,
  locale,
}: {
  money: ProviderMoney;
  wait: PayoutWait;
  locale: Locale;
}) {
  const t = await getTranslations("provider.money");
  const npr = (amount: number) => formatNpr(amount, { locale });

  if (!money.ok) {
    return (
      <section className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4">
        <h2 className="font-display flex items-center gap-2 text-heading-sm">
          <Wallet aria-hidden className="size-5 text-primary" />
          {t("heading")}
        </h2>
        <p className="mt-2 text-body-md">{t("unreadable")}</p>
      </section>
    );
  }

  if (!money.hasSettled) {
    return (
      <section className="animate-rise mt-6 rounded-lg border border-border bg-muted/30 p-4">
        <h2 className="font-display flex items-center gap-2 text-heading-sm">
          <Wallet aria-hidden className="size-5 text-primary" />
          {t("heading")}
        </h2>
        <p className="mt-2 text-body-md text-muted-foreground">
          {t("noEvidence")}
        </p>
      </section>
    );
  }

  /*
   * ONE FIGURE, AND ITS SIGN DECIDES THE LABEL. A negative balance is a week of
   * cash work where our fee came to more than we owed them, and printing it as
   * "we owe you -600" would be arithmetic rather than a sentence. The absolute
   * value goes under the other label, with the explanation beside it.
   */
  const theyOweUs = money.balance < 0;

  return (
    <section className="animate-rise mt-6 rounded-lg border border-border p-4">
      <h2 className="font-display flex items-center gap-2 text-heading-sm">
        <Wallet aria-hidden className="size-5 text-primary" />
        {t("heading")}
      </h2>

      <div className="mt-4 flex items-baseline justify-between gap-4">
        <span className="text-body-sm text-muted-foreground">
          {theyOweUs ? t("owing") : t("balance")}
        </span>
        <span className="font-display text-heading-md tabular-nums">
          {npr(Math.abs(money.balance))}
        </span>
      </div>

      {money.commissionDue > 0 ? (
        <p className="mt-2 text-caption text-muted-foreground">
          {t("owingWhy")}
        </p>
      ) : null}

      <p className="mt-2 text-caption text-muted-foreground">{t("nextRun")}</p>

      <Waiting wait={wait} />

      {money.debt > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-body-sm font-semibold">{t("debtTitle")}</h3>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("debtBody")}
          </p>
          <dl className="mt-3 space-y-1.5 text-body-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t("debtLeft")}</dt>
              <dd className="tabular-nums">{npr(money.debt)}</dd>
            </div>
            {/*
              WHAT HAS COME OFF, beside what is left. /providers/standards promises
              a balance "you can watch going down" — a figure that only ever shows
              the remainder is not something anybody can watch moving.
            */}
            {money.recovered > 0 ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{t("debtCleared")}</dt>
                <dd className="tabular-nums text-success-ink">
                  {npr(money.recovered)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {money.heldBack.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-body-sm font-semibold">{t("heldTitle")}</h3>
          <p className="mt-1 text-caption text-muted-foreground">
            {t("heldBody")}
          </p>
          <ul className="mt-3 space-y-2">
            {money.heldBack.map((held) => (
              <li
                key={`${held.bookingId}-${held.releasesAt.toISOString()}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 text-body-sm"
              >
                <span className="text-muted-foreground">
                  {held.reference
                    ? t("heldOn", { reference: held.reference })
                    : t("heldTitle")}
                  {" · "}
                  {t("releases", {
                    date: formatInstant(held.releasesAt.toISOString(), locale),
                  })}
                </span>
                <span className="tabular-nums">{npr(held.rupees)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-body-sm font-semibold">{t("historyTitle")}</h3>
        {money.history.length === 0 ? (
          <p className="mt-1 text-caption text-muted-foreground">
            {t("historyNone")}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {money.history.map((payout) => (
              <li key={payout.id} className="text-body-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-muted-foreground">
                    {t("historyPeriod", {
                      from: formatInstant(
                        payout.periodStart.toISOString(),
                        locale,
                      ),
                      to: formatInstant(payout.periodEnd.toISOString(), locale),
                    })}
                    {" · "}
                    {t(`statuses.${payout.status}` as "statuses.confirmed")}
                  </span>
                  <span className="tabular-nums">{npr(payout.net)}</span>
                </div>
                {payout.reference ? (
                  <p className="text-caption text-muted-foreground">
                    {t("historyReference", { reference: payout.reference })}
                  </p>
                ) : null}
                {/*
                  A FAILED PAYOUT SAYS WHERE THE MONEY WENT. The reversal put it
                  back on the balance, and without that sentence a professional
                  reads a failed row as money lost — which is the moment they stop
                  trusting the screen.
                */}
                {payout.status === "failed" ? (
                  <p className="text-caption text-warning-ink">
                    {t("historyFailed")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The dashboard's summary — the same figures, none of its own.
 *
 * IT CALLS NOTHING AND COMPUTES NOTHING. Every number here came out of
 * `providerMoney()`, which is what makes the equality test possible at all: a
 * summary doing its own arithmetic is how two screens come to tell a professional
 * two different things about one week's work, and that is the failure this file is
 * shaped to prevent.
 */
export async function MoneySummary({
  money,
  wait,
  locale,
}: {
  money: ProviderMoney;
  wait: PayoutWait;
  locale: Locale;
}) {
  const t = await getTranslations("provider.money");
  const theyOweUs = money.balance < 0;

  return (
    <section className="animate-rise mt-4 rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-body-sm flex items-center gap-2 font-semibold text-foreground">
        <Wallet aria-hidden="true" className="size-4 text-primary" />
        {t("heading")}
      </h2>

      {!money.ok ? (
        <p className="mt-3 text-body-sm">{t("unreadable")}</p>
      ) : !money.hasSettled ? (
        <p className="text-caption mt-3 text-muted-foreground">
          {t("noEvidence")}
        </p>
      ) : (
        <>
          <dl className="mt-3 space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-caption text-muted-foreground">
                {theyOweUs ? t("owing") : t("balance")}
              </dt>
              <dd className="text-body-sm font-semibold tabular-nums text-foreground">
                {formatNpr(Math.abs(money.balance), { locale })}
              </dd>
            </div>
            {money.debt > 0 ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-caption text-muted-foreground">
                  {t("debtLeft")}
                </dt>
                <dd className="text-body-sm font-semibold tabular-nums text-foreground">
                  {formatNpr(money.debt, { locale })}
                </dd>
              </div>
            ) : null}
          </dl>

          <Waiting wait={wait} />
        </>
      )}

      <Link
        href="/provider/payouts"
        className="text-caption mt-3 inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
      >
        {t("toFull")}
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </section>
  );
}
