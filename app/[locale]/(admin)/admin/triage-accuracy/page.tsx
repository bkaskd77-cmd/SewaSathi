import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CircleAlert } from "lucide-react";

import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import {
  triageAccuracy,
  type Counted,
  type Middle,
  type TriageSourceKey,
} from "@/lib/data/triage-accuracy";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "admin.triageAccuracy",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * Was the triage right? The first screen in this product that can ask.
 *
 * WHY THIS IS THE ONE THAT MATTERED. Pricing has had a feedback loop for
 * phases. The product's single AI capability had none: every `triage_logs` row
 * was written and never read back against what the customer went on to do, so
 * the one thing here that makes a judgement could not be told right from wrong,
 * and therefore could not be improved except by taste.
 *
 * IT MEASURES AND IT DOES NOT TUNE. There is no threshold on this screen, no
 * grade, no colour for bad, no badge and no sentence proposing a change.
 * `/admin/signals` has one judgement — `needsBandReview` — because a published
 * band has a floor to be wrong against. Nothing here has an equivalent: nobody
 * knows what a good category-agreement rate looks like on this product yet, and
 * a constant would freeze a guess into the codebase as a standard. The proposal
 * comes when there are rows to make it from, and it comes as a proposal.
 *
 * EVERY RATE PRINTS ITS DENOMINATOR, without exception. "62%" over thirteen
 * bookings and "62%" over nine hundred are different facts and the same three
 * characters, so the count is never rendered without the `n` it came out of.
 * That is `claimRateWorthReading`'s rule on the refund screen, minus the
 * judgement — that one decides whether a rate is worth reading at all, and this
 * decides nothing.
 *
 * THE FIRST NUMBER IS HOW MUCH OF THIS IS MEASURABLE AT ALL, because for the
 * entire life of the product it was none of it. `bookings.triage_log_id` had a
 * column, a zod field, a flow-state slot, an insert that wrote it and a page
 * that read it — and nothing ever produced the value, so every booking ever
 * taken carries a null. A screen that opened with an accuracy percentage over
 * that would have been reporting on an empty set with a straight face.
 *
 * NOTHING HERE IS A MODEL'S SUMMARY. The counts are the intelligence. Sending
 * what customers typed about their homes to a model to be summarised for an
 * admin would move personal text out of the building for no gain a number does
 * not already give.
 */
export default async function TriageAccuracyPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.triageAccuracy");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/triage-accuracy", locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/triage-accuracy", locale });
  }

  const accuracy = await triageAccuracy();

  const SOURCES: TriageSourceKey[] = ["claude", "cache", "fallback"];
  const pathName = (key: TriageSourceKey) => t(`paths.${key}`);

  /**
   * A count and the total it came out of, as one string.
   *
   * ONE FUNCTION SO THE RULE CANNOT BE FORGOTTEN ON ONE ROW. A bare percentage
   * anywhere on this screen would be the bug, so no caller is given the option
   * of producing one, and an empty denominator prints as "nothing to read"
   * rather than as 0% — which reads as total failure rather than as no data.
   */
  const rate = (matched: number, total: number) =>
    total === 0
      ? t("noSample")
      : t("ofTotal", {
          pct: String(Math.round((matched / total) * 100)),
          n: String(matched),
          count: total,
          total: String(total),
        });

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>
      {/*
        * SAID ONCE, UNCONDITIONALLY, AND NOT BEHIND A THRESHOLD. The tempting
        * version is a warning that appears below some minimum sample — but
        * picking that minimum is exactly the claim about "good" this screen
        * refuses to make. So the sentence is always here, and the denominators
        * beside every number are what let a reader decide for themselves.
        */}
      <p className="animate-rise mt-3 max-w-2xl rounded-lg border border-border bg-muted/30 p-4 text-body-sm text-muted-foreground">
        {t("notAFinding")}
      </p>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-10 font-display text-heading-md">
        {t("coverage.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("coverage.lead")}
      </p>
      <Panel counted={accuracy.coverage} unreadable={t("unreadable")}>
        {(value) => (
          <dl className="space-y-1.5 text-body-sm text-muted-foreground">
            <Row
              label={t("coverage.attributed")}
              value={rate(value.attributed, value.bookings)}
            />
            <Row label={t("coverage.bookings")} value={String(value.bookings)} />
          </dl>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-12 font-display text-heading-md">
        {t("category.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("category.lead")}
      </p>
      <Panel counted={accuracy.category} unreadable={t("unreadable")}>
        {(value) => (
          <dl className="space-y-1.5 text-body-sm text-muted-foreground">
            {SOURCES.map((key) => (
              <Row
                key={key}
                label={pathName(key)}
                value={rate(value[key].matched, value[key].total)}
              />
            ))}
          </dl>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-12 font-display text-heading-md">
        {t("band.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("band.lead")}
      </p>
      <Panel counted={accuracy.band} unreadable={t("unreadable")}>
        {(value) => (
          <div className="space-y-4">
            {SOURCES.map((key) => (
              <div key={key}>
                <h3 className="font-display text-heading-sm">{pathName(key)}</h3>
                <dl className="mt-2 space-y-1.5 text-body-sm text-muted-foreground">
                  <Row
                    label={t("band.inside")}
                    value={rate(value[key].inside, value[key].total)}
                  />
                  {/* Above and below are separated because they are different
                      failures: above is a customer surprised by a bill, below
                      is a quote that put somebody off for no reason. */}
                  <Row
                    label={t("band.above")}
                    value={rate(value[key].above, value[key].total)}
                  />
                  <Row
                    label={t("band.below")}
                    value={rate(value[key].below, value[key].total)}
                  />
                </dl>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-12 font-display text-heading-md">
        {t("hazard.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("hazard.lead")}
      </p>
      <Panel counted={accuracy.hazard} unreadable={t("unreadable")}>
        {(value) => (
          <dl className="space-y-1.5 text-body-sm text-muted-foreground">
            <Row
              label={t("hazard.agreed")}
              value={rate(value.agreed, value.total)}
            />
            {/* The count that has never existed. `hazard` records the winner —
                the text guard beats vision whenever both fire — so from that
                column alone agreement and disagreement are both invisible. */}
            <Row
              label={t("hazard.disagreed")}
              value={rate(value.disagreed, value.total)}
            />
            <Row
              label={t("hazard.textOnly")}
              value={rate(value.textOnly, value.total)}
            />
            <Row
              label={t("hazard.visionOnly")}
              value={rate(value.visionOnly, value.total)}
            />
            <Row
              label={t("hazard.neither")}
              value={rate(value.neither, value.total)}
            />
            <Row
              label={t("hazard.unseenPhoto")}
              value={rate(value.unseenPhoto, value.total)}
            />
            {/*
              * RULE 6, AND IT IS THE MAJORITY OF ROWS TODAY. A log written
              * before those two columns existed is silent about what the
              * detectors saw. Folding it into "neither found anything" would
              * manufacture a clean safety record out of an absent one, which is
              * the worst direction for this particular number to be wrong in.
              */}
            <Row
              label={t("hazard.notRecorded")}
              value={rate(value.notRecorded, value.total)}
            />
          </dl>
        )}
      </Panel>

      {/* ---------------------------------------------------------------- */}
      <h2 className="animate-rise mt-12 font-display text-heading-md">
        {t("mix.title")}
      </h2>
      <p className="animate-rise mt-1 max-w-2xl text-body-sm text-muted-foreground">
        {t("mix.lead")}
      </p>
      <Panel counted={accuracy.mix} unreadable={t("unreadable")}>
        {(value) => {
          const all = value.claude + value.cache + value.fallback;
          return (
            <dl className="space-y-1.5 text-body-sm text-muted-foreground">
              {SOURCES.map((key) => (
                <Row key={key} label={pathName(key)} value={rate(value[key], all)} />
              ))}
            </dl>
          );
        }}
      </Panel>

      <Panel counted={accuracy.latency} unreadable={t("unreadable")}>
        {(value) => (
          <dl className="space-y-1.5 text-body-sm text-muted-foreground">
            {SOURCES.map((key) => (
              <Row
                key={key}
                label={t("latency.path", { path: pathName(key) })}
                value={middle(value[key], t)}
              />
            ))}
          </dl>
        )}
      </Panel>
    </section>
  );
}

/** A median with its sample, or the honest absence of one. */
function middle(
  value: Middle,
  t: (key: string, values?: Record<string, string | number>) => string,
): string {
  if (value.medianMs === null) return t("noSample");
  return t("latency.ms", {
    ms: String(value.medianMs),
    count: value.total,
    n: String(value.total),
  });
}

/**
 * A count that may not have been readable, and the difference is the point.
 *
 * A BROKEN QUERY MUST NOT RENDER AS ZERO. "0% agreement" is not a shrug, it is
 * the worst news this screen could carry, and printing it because a read failed
 * is how somebody rewrites a prompt that was working. Same rule as the
 * unreadable line on `/admin/signals`, one arity down: `Counted<T>` is a single
 * aggregate where `Readable<T>` is a list.
 */
function Panel<T>({
  counted,
  unreadable,
  children,
}: {
  counted: Counted<T>;
  unreadable: string;
  children: (value: T) => React.ReactNode;
}) {
  if (!counted.ok) {
    return (
      <p
        role="alert"
        className="animate-rise mt-4 inline-flex items-center gap-2 text-body-sm text-warning-ink"
      >
        <CircleAlert aria-hidden="true" className="size-4" />
        {unreadable}
      </p>
    );
  }
  return (
    <div className="animate-rise mt-4 rounded-lg border border-border p-5">
      {children(counted.value)}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
