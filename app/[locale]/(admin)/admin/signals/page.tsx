import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleAlert } from "lucide-react";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { categoryCopy } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { listPaymentMix, listPricingSignals } from "@/lib/data/payments";
import {
  MIX_BASELINE_MINIMUM_JOBS,
  hasBaseline,
  mixByCategory,
  mixByWard,
  overallMix,
} from "@/lib/data/payment-mix";
import { BAND_REVIEW_THRESHOLD_PCT, needsBandReview } from "@/lib/data/pricing-signals";
import { formatBand, formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Two questions the product can already answer and nobody could read.
 *
 * WHERE OUR PRICES ARE WRONG. A professional charging under the published floor
 * is not evidence about that professional — the fee is charged on
 * `max(final_amount, quoted_min)` precisely so under-reporting earns nothing,
 * and the cost of that design is that it occasionally lands on a job which
 * genuinely was smaller than we said. One of those is an appeal. A whole
 * CATEGORY bunching under its floor is our mispricing, and
 * `category_pricing_signals` counts exactly that — per category, deliberately
 * never per person, because read the other way it becomes a list of people to
 * punish for a price we set.
 *
 * HOW MUCH IS PAID IN CASH, BY VALUE AND NOT ONLY BY COUNT. Cash tends to be
 * the big jobs, so a platform reading the job count alone would think its
 * exposure half what it is. `cashValuePct` is the number that decides a spend
 * and it is the primary sort. Never grouped by professional: the customer
 * picks the method, and a per-person cash share read as a suspicion list would
 * punish somebody for the neighbourhood they serve.
 *
 * A BASELINE BEFORE ANY MONEY IS SPENT. `hasBaseline` refuses to call 12 jobs
 * a measurement. A screen that printed a percentage off four settlements would
 * be the reason somebody spent a budget on a number that was noise.
 *
 * NOTHING HERE IS A MODEL'S SUMMARY. The numbers are the intelligence.
 */
export default async function SignalsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.signals");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") redirect({ href: "/login?next=/admin/signals", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/signals", locale });
  }

  const [pricing, mix, categories] = await Promise.all([
    listPricingSignals(),
    listPaymentMix(),
    getCategories(),
  ]);

  const tradeName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };

  const overall = mix.ok ? overallMix(mix.rows) : null;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-10 font-display text-heading-md">
        {t("pricing.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("pricing.lead", { pct: String(BAND_REVIEW_THRESHOLD_PCT) })}
      </p>

      {!pricing.ok ? (
        <Unreadable text={t("unreadable")} />
      ) : pricing.rows.length === 0 ? (
        <p className="animate-rise mt-4 text-body-md text-muted-foreground">
          {t("pricing.empty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {pricing.rows.map((signal, index) => (
            <li
              key={signal.categorySlug}
              className="animate-rise rounded-lg border border-border p-5"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {tradeName(signal.categorySlug)}
                </span>
                {/*
                  * The one judgement on this screen, and it is about OUR price
                  * rather than anybody's conduct. `needsBandReview` also
                  * requires ten settled jobs, so a trade with two does not get
                  * flagged for having one cheap one.
                  */}
                {needsBandReview(signal) ? (
                  <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-caption text-warning-ink">
                    {t("pricing.review")}
                  </span>
                ) : null}
              </div>

              <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <Row label={t("pricing.settled")} value={String(signal.settledJobs)} />
                <Row
                  label={t("pricing.belowBand")}
                  value={t("pricing.jobsAndPct", {
                    n: String(signal.belowBandJobs),
                    pct: String(Math.round(signal.belowBandPct)),
                  })}
                />
                <Row
                  label={t("pricing.published")}
                  value={
                    formatBand(
                      { min: signal.bandMin, max: signal.bandMax },
                      { locale },
                    ) ?? t("unrecorded")
                  }
                />
                <Row
                  label={t("pricing.middle")}
                  value={formatNpr(signal.medianFinal, { locale })}
                />
              </dl>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-12 font-display text-heading-md">
        {t("mix.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("mix.lead")}
      </p>

      {!mix.ok ? (
        <Unreadable text={t("unreadable")} />
      ) : mix.rows.length === 0 ? (
        <p className="animate-rise mt-4 text-body-md text-muted-foreground">
          {t("mix.empty")}
        </p>
      ) : (
        <>
          {/*
            * NOT A MEASUREMENT YET, AND IT SAYS SO. Below the minimum this is
            * a number, not a baseline, and printing it as though a spending
            * decision could rest on it is how a budget goes on noise.
            */}
          {overall && !hasBaseline(overall) ? (
            <p className="animate-rise mt-4 inline-flex items-center gap-2 text-body-sm text-warning-ink">
              <CircleAlert aria-hidden="true" className="size-4" />
              {t("mix.tooEarly", {
                n: String(overall.settledJobs),
                min: String(MIX_BASELINE_MINIMUM_JOBS),
              })}
            </p>
          ) : null}

          {overall ? (
            <div className="animate-rise mt-4 rounded-lg border border-border p-5">
              <h3 className="font-display text-heading-sm">{t("mix.everything")}</h3>
              <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <Row
                  label={t("mix.byValue")}
                  value={t("mix.pct", { pct: String(Math.round(overall.cashValuePct)) })}
                />
                <Row
                  label={t("mix.byCount")}
                  value={t("mix.pct", { pct: String(Math.round(overall.cashPct)) })}
                />
                <Row label={t("mix.settled")} value={String(overall.settledJobs)} />
              </dl>
            </div>
          ) : null}

          <MixGroup
            title={t("mix.byTrade")}
            rows={mixByCategory(mix.rows)}
            label={tradeName}
            valueLabel={t("mix.byValue")}
            countLabel={t("mix.byCount")}
            pct={(n) => t("mix.pct", { pct: String(Math.round(n)) })}
          />
          <MixGroup
            title={t("mix.byWard")}
            rows={mixByWard(mix.rows)}
            label={(key) => key}
            valueLabel={t("mix.byValue")}
            countLabel={t("mix.byCount")}
            pct={(n) => t("mix.pct", { pct: String(Math.round(n)) })}
          />
        </>
      )}
    </section>
  );
}

function MixGroup({
  title,
  rows,
  label,
  valueLabel,
  countLabel,
  pct,
}: {
  title: string;
  rows: Array<{ key: string; cashValuePct: number; cashPct: number; settledJobs: number }>;
  label: (key: string) => string;
  valueLabel: string;
  countLabel: string;
  pct: (n: number) => string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="animate-rise mt-4 rounded-lg border border-border p-5">
      <h3 className="font-display text-heading-sm">{title}</h3>
      <ul className="mt-3 space-y-2 text-body-sm text-muted-foreground">
        {rows.map((row) => (
          <li key={row.key} className="flex items-baseline justify-between gap-4">
            <span>{label(row.key)}</span>
            <span className="text-right text-foreground">
              <span className="tabular-nums">{pct(row.cashValuePct)}</span>
              <span className="ml-2 text-caption text-muted-foreground">
                {valueLabel}
              </span>
              <span className="ml-3 tabular-nums">{pct(row.cashPct)}</span>
              <span className="ml-2 text-caption text-muted-foreground">
                {countLabel}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The read failed, and that is not the same news as nothing being there.
 *
 * A broken query used to render "cash share 0%" — which reads as good news on
 * the one screen built to decide whether to spend money reducing cash.
 */
function Unreadable({ text }: { text: string }) {
  return (
    <p
      role="alert"
      className="animate-rise mt-4 inline-flex items-center gap-2 text-body-sm text-warning-ink"
    >
      <CircleAlert aria-hidden="true" className="size-4" />
      {text}
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
