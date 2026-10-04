import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { revenue, type RevenueWeek } from "@/lib/data/revenue";
import { formatNpr } from "@/lib/utils/format";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * What we earned, where each figure came from, and what did not add up.
 *
 * EVERY LINE NAMES ITS SOURCE ON THE SCREEN, not only in the module. An owner
 * reading "commission earned" has to be able to tell whether it is a fee we froze at
 * settlement or a percentage somebody computed this morning, because those two
 * answers behave differently the day a rate changes. The source line under each
 * heading is the whole point of the screen's layout.
 *
 * THE RETURNED COMMISSION IS A LINE, NEVER A NETTING. A week with a large refund
 * earned less than its settlements suggest, and a single net figure would hide the
 * one event worth asking about. Same reason `/admin/payouts` prints `carried` rather
 * than quietly making its three numbers agree.
 *
 * TWO FIGURES EXIST TO BE ZERO. A settled payment with no frozen fee, and a refund
 * agreed with no date: both are reported above the table, because a filter that
 * silently drops them leaves weekly columns that look complete and are not. If
 * either is non-zero the screen says the weeks do not account for everything.
 *
 * A FAILED READ IS NOT A BAD WEEK. `ok: false` is its own sentence — a zero on this
 * screen reads as news, and the worst thing it could do is deliver that news from a
 * broken query.
 */
export default async function RevenuePage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.revenue");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/revenue", locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/revenue", locale });
  }

  const read = await revenue();
  const money = (amount: number) => formatNpr(amount, { locale });

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="text-heading-lg font-display">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      {read.data === null ? (
        <p className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-md">
          {t("unreadable")}
        </p>
      ) : (
        <>
          {/*
            THE POSITION, BEFORE THE FLOWS. "What cash professionals still owe us" is
            not a week's event — it is settled by future payouts being smaller — so it
            sits apart from the table rather than inside a column that would imply it
            arrived on a particular Monday.
          */}
          <div className="animate-rise mt-6 rounded-lg border border-border p-4">
            <h2 className="text-body-sm font-semibold">{t("owedToUs")}</h2>
            <p className="text-heading-md mt-1 font-display tabular-nums">
              {money(read.data.cashCommissionOutstanding)}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {t("owedToUsSource")}
            </p>
          </div>

          {read.data.unattributedSettlements > 0 ||
          read.data.undatedReturns > 0 ? (
            <div className="animate-rise mt-4 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-sm">
              <p>{t("notAccountedFor")}</p>
              <ul className="mt-2 space-y-1">
                {read.data.unattributedSettlements > 0 ? (
                  <li>
                    {t("unattributed", {
                      count: read.data.unattributedSettlements,
                      n: String(read.data.unattributedSettlements),
                    })}
                  </li>
                ) : null}
                {read.data.undatedReturns > 0 ? (
                  <li>
                    {t("undated", { n: money(read.data.undatedReturns) })}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {read.data.weeks.length === 0 ? (
            <div className="animate-rise mt-6 rounded-lg border border-border bg-muted/30 p-4">
              <p className="text-body-md">{t("empty")}</p>
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t("emptyWhen")}
              </p>
            </div>
          ) : (
            <>
              <h2 className="animate-rise text-heading-sm mt-10 font-display">
                {t("byWeek")}
              </h2>
              <ul className="mt-3 space-y-4">
                {read.data.weeks.map((week, index) => (
                  <li
                    key={week.weekStart.toISOString()}
                    className="animate-rise rounded-lg border border-border p-4"
                    style={{
                      animationDelay: `${Math.min(index * 0.05, 0.25)}s`,
                    }}
                  >
                    <Week week={week} locale={locale} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {read.data.categories.length > 0 ? (
            <>
              <h2 className="animate-rise text-heading-sm mt-10 font-display">
                {t("byCategory")}
              </h2>
              <ul className="mt-3 space-y-2">
                {read.data.categories.map((trade) => (
                  <li
                    key={trade.slug}
                    className="animate-rise flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg border border-border px-4 py-3 text-body-sm"
                  >
                    <span>
                      {trade.slug}
                      <span className="ml-2 text-caption text-muted-foreground">
                        {t("jobsCount", {
                          count: trade.jobs,
                          n: String(trade.jobs),
                        })}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {money(trade.commissionEarned)}
                      {trade.commissionReturned > 0 ? (
                        <span className="ml-2 text-caption text-warning-ink">
                          {t("lessReturned", {
                            n: money(trade.commissionReturned),
                          })}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          <p className="mt-8 text-caption text-muted-foreground">
            {t("sources")}
          </p>
        </>
      )}
    </section>
  );
}

async function Week({ week, locale }: { week: RevenueWeek; locale: Locale }) {
  const t = await getTranslations("admin.revenue");
  const money = (amount: number) => formatNpr(amount, { locale });

  /*
   * The difference is computed here and labelled, rather than replacing the two
   * lines it comes from. Three figures from two stored columns: an owner can check
   * the subtraction, which is the property `/admin/payouts` found worth keeping when
   * its lines did not add up to its total.
   */
  const net = week.commissionEarned - week.commissionReturned;

  const lines: { key: string; value: number; tone?: "cost" }[] = [
    { key: "earned", value: week.commissionEarned },
    { key: "returned", value: week.commissionReturned, tone: "cost" },
    { key: "cashBilled", value: week.cashCommissionBilled },
    { key: "redoCost", value: week.redoCost, tone: "cost" },
    { key: "writtenOff", value: week.redoWrittenOff, tone: "cost" },
    { key: "payoutsSent", value: week.payoutsSent },
  ];

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body-md font-medium">
          {t("weekOf", {
            date: formatInstant(week.weekStart.toISOString(), locale),
          })}
        </h3>
        <p className="text-body-md font-medium tabular-nums">{money(net)}</p>
      </div>
      <p className="mt-0.5 text-caption text-muted-foreground">
        {t("netIs", {
          count: week.jobs,
          n: String(week.jobs),
        })}
      </p>

      <dl className="mt-3 space-y-1 text-body-sm">
        {lines
          .filter((line) => line.value !== 0)
          .map((line) => (
            <div
              key={line.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4"
            >
              <dt className="text-muted-foreground">
                {t(`lines.${line.key}` as "lines.earned")}
              </dt>
              <dd
                className={`tabular-nums ${
                  line.tone === "cost" ? "text-warning-ink" : ""
                }`}
              >
                {money(line.value)}
              </dd>
            </div>
          ))}
      </dl>
    </>
  );
}
