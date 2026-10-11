import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleAlert } from "lucide-react";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant, MIN_DURATION_SAMPLE } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategories, getSubBands } from "@/lib/data/categories";
import {
  durationEvidence,
  durationReadings,
  type DurationView,
} from "@/lib/data/duration-loop";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * What the duration loop has seen, what it has done, and what it would do.
 *
 * WHY THIS SCREEN EXISTS. The loop acts without a person — defensibly, because
 * a published duration changes what the scheduler reserves and not how long the
 * work takes, so it cannot measure its own shadow the way a band proposal
 * would, and because no duration touches a rupee. The price of acting
 * unattended is that its reasoning has to be readable afterwards: "why is this
 * published as 90 minutes?" is answered here, with the sample it came out of.
 *
 * AND IT IS THE SHADOW VIEW. Every sub-band below its floor shows the figure
 * the loop WOULD publish and how many more completions it needs, so a number
 * can be watched converging for months before anything uses it. That is the
 * half that makes an automatic loop safe to leave running.
 *
 * NOTHING HERE GRADES, the posture `/admin/triage-accuracy` and
 * `/admin/signals` already hold: no target, no colour for bad, no proposal to
 * approve. The floors are stated because a threshold people can only find by
 * tripping it is a trap — the sentence `/providers/standards` settled.
 */
export default async function DurationPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.duration");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut")
      redirect({ href: "/login?next=/admin/duration", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/duration", locale });
  }

  const [evidence, readings, categories, subBands] = await Promise.all([
    durationEvidence(),
    durationReadings(),
    getCategories(),
    getSubBands(),
  ]);

  const tradeName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };
  const productName = (categorySlug: string, bandSlug: string) => {
    const band = subBands.find(
      (b) => b.categorySlug === categorySlug && b.slug === bandSlug,
    );
    if (!band) return bandSlug;
    return locale === "ne" ? band.labelNe : band.labelEn;
  };

  /*
   * THE ONES WITH ANYTHING TO SAY FIRST. Thirty-six rows of "nothing measured"
   * would bury the one sub-band that has four completions, which is the row
   * worth looking at today.
   */
  const ranked = [...(evidence ?? [])].sort(
    (a, b) => measured(b) - measured(a),
  );
  const withEvidence = ranked.filter((row) => measured(row) > 0);
  const silent = ranked.length - withEvidence.length;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      <dl className="animate-rise mt-6 space-y-1 rounded-lg border border-border p-4 text-body-sm text-muted-foreground">
        <Row
          label={t("floors.minutes")}
          value={t("floors.jobs", { n: String(MIN_DURATION_SAMPLE.minutes) })}
        />
        <Row
          label={t("floors.span")}
          value={t("floors.jobs", { n: String(MIN_DURATION_SAMPLE.span) })}
        />
      </dl>
      <p className="animate-rise mt-2 max-w-2xl text-caption text-muted-foreground">
        {t("floors.why")}
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-10 font-display text-heading-md">
        {t("products.title")}
      </h2>

      {evidence === null ? (
        <Unreadable text={t("unreadable")} />
      ) : withEvidence.length === 0 ? (
        /*
         * NO EVIDENCE IS NOT A FAILURE AND IS NOT ZERO, so it says which it is:
         * nothing has been measured yet, and how many sub-bands are waiting.
         */
        <p className="animate-rise mt-4 max-w-2xl text-body-sm text-muted-foreground">
          {t("products.none", { n: String(silent), count: silent })}
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-4">
            {withEvidence.map((row, index) => (
              <li
                key={`${row.categorySlug}/${row.bandSlug}`}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
              >
                <p className="text-body-md text-foreground">
                  {productName(row.categorySlug, row.bandSlug)}
                </p>
                <p className="mt-0.5 text-caption text-muted-foreground">
                  {tradeName(row.categorySlug)}
                </p>

                <dl className="mt-3 space-y-1 text-body-sm text-muted-foreground">
                  <Kind
                    label={t("kind.minutes")}
                    unit={t("unit.minutes")}
                    view={row.minutes}
                    t={t}
                  />
                  <Kind
                    label={t("kind.span")}
                    unit={t("unit.days")}
                    view={row.span}
                    t={t}
                  />
                </dl>
              </li>
            ))}
          </ul>
          {silent > 0 ? (
            <p className="animate-rise mt-4 text-caption text-muted-foreground">
              {t("products.rest", { n: String(silent), count: silent })}
            </p>
          ) : null}
        </>
      )}

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-10 font-display text-heading-md">
        {t("log.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("log.lead")}
      </p>

      {readings === null ? (
        <Unreadable text={t("log.unreadable")} />
      ) : readings.length === 0 ? (
        <p className="animate-rise mt-4 text-body-sm text-muted-foreground">
          {t("log.none")}
        </p>
      ) : (
        <ul className="mt-4 space-y-2 text-body-sm">
          {readings.map((row, index) => (
            <li
              key={`${row.observedAt}-${row.categorySlug}-${row.bandSlug}-${row.kind}`}
              className="animate-rise flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-2"
              style={{ animationDelay: `${Math.min(index * 0.03, 0.25)}s` }}
            >
              <span className="text-foreground">
                {productName(row.categorySlug, row.bandSlug)} ·{" "}
                {row.kind === "span" ? t("kind.span") : t("kind.minutes")}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {t(`log.outcome.${row.outcome === "below-floor" ? "belowFloor" : row.outcome}`, {
                  observed: String(row.observed),
                  published: String(row.published),
                  n: String(row.sample),
                  count: row.sample,
                })}
              </span>
              <span className="w-full text-caption text-muted-foreground">
                {formatInstant(row.observedAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** How much has been measured about this sub-band, either kind. */
function measured(row: DurationView): number {
  return row.minutes.sample + row.span.sample;
}

/**
 * One number's line: what is published, what the data says, and what happens
 * next — which is the sentence a shadow screen exists to print.
 */
function Kind({
  label,
  unit,
  view,
  t,
}: {
  label: string;
  unit: string;
  view: DurationView["minutes"];
  t: Awaited<ReturnType<typeof getTranslations<"admin.duration">>>;
}) {
  const decision = view.decision;
  const next =
    decision.act === true
      ? t("next.willPublish", { n: String(decision.to), unit })
      : decision.why === "below-floor"
        ? t("next.needsMore", { n: String(decision.need) })
        : decision.why === "settled"
          ? t("next.settled")
          : t("next.nothing");

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <dt>{label}</dt>
        <dd className="tabular-nums text-foreground">
          {t("published", {
            n: String(view.published),
            unit,
            source: t(`source.${view.source}`),
          })}
        </dd>
      </div>
      <p className="mt-0.5 text-caption">
        {/* THE SAMPLE IS NEVER OMITTED. A median of three jobs and a median of
            three hundred are different facts, and a bare figure invites the
            wrong one — `claimRateWorthReading`'s rule minus the judgement. */}
        {view.observed === null
          ? t("observed.none")
          : t("observed.median", {
              n: String(view.observed),
              unit,
              count: view.sample,
              sample: String(view.sample),
            })}
        {view.unusual > 0
          ? ` ${t("observed.unusual", { n: String(view.unusual) })}`
          : ""}
        {` ${next}`}
      </p>
    </div>
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
