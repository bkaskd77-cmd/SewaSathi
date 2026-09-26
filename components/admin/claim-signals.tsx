import { AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/routing";
import {
  claimRateWorthReading,
  CLAIM_RATE_MIN_JOBS,
  type ClaimSignals,
} from "@/lib/data/claim-signals";
import { formatNpr } from "@/lib/utils";

/**
 * What is already on the record about the two people in this claim.
 *
 * SIGNALS, NEVER A DECISION, AND THE SCREEN SAYS SO IN WORDS. Nothing here is
 * read by `refundCeiling`, `judgeRefund` or `enforce_claim_refund` — the
 * ceiling is arithmetic on one booking and no number on this panel can move
 * it. The panel exists because the reviewer was deciding blind: they could see
 * one claim and nothing about whether this professional has three refunds
 * already, whether the debt from those is being recovered at all, or whether
 * this customer claims on everything.
 *
 * REVIEW, NOT PUNISHMENT — the customer half especially, and the sentence is
 * on the screen rather than in a comment. A claim rate read the wrong way is a
 * list of people to refuse money to, which is the same misreading
 * `category_pricing_signals` is never grouped by person to avoid. Somebody who
 * claims often may be unlucky, may live somewhere with old pipes, or may have
 * had three genuinely bad jobs.
 *
 * NO NUMBER WITHOUT ITS DENOMINATOR. "Two prior refunds" out of two jobs and
 * out of two hundred are different facts. A missing denominator is printed as
 * missing (rule 6): not looking must never render as measured, and this is the
 * screen where that costs the most.
 */
export async function ClaimSignalsPanel({
  signals,
  locale,
}: {
  signals: ClaimSignals;
  locale: Locale;
}) {
  const t = await getTranslations("admin.guaranteeClaims.signals");

  // A missing customer half is "no rate", the same answer as too few jobs —
  // the rule takes the numbers, so the absence is handled here rather than by
  // widening a pure signature to accept null.
  const rate = signals.customer
    ? claimRateWorthReading(signals.customer)
    : { rate: null, worthReading: false };
  if (!signals.provider && !signals.customer) return null;

  return (
    <section className="animate-pop-in mt-4 rounded-lg border border-border bg-muted/30 p-4">
      <h3 className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        {t("heading")}
      </h3>

      <dl className="mt-3 space-y-2 text-body-sm">
        {signals.provider ? (
          <>
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <dt className="text-muted-foreground">{t("priorRefunds")}</dt>
              <dd className="tabular-nums">
                {/* The denominator is half the fact. Without it, "2 refunds"
                    reads the same for somebody on their third job and
                    somebody on their three hundredth. */}
                {signals.provider.jobsCompleted === null
                  ? t("priorRefundsNoJobs", {
                      n: String(signals.provider.priorRefunds),
                      count: signals.provider.priorRefunds,
                      amount: formatNpr(signals.provider.priorRefundRupees, {
                        locale,
                      }),
                    })
                  : t("priorRefundsValue", {
                      n: String(signals.provider.priorRefunds),
                      count: signals.provider.priorRefunds,
                      jobs: String(signals.provider.jobsCompleted),
                      amount: formatNpr(signals.provider.priorRefundRupees, {
                        locale,
                      }),
                    })}
              </dd>
            </div>

            <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
              <dt className="text-muted-foreground">{t("outstanding")}</dt>
              <dd className="tabular-nums">
                {/*
                    THE NUMBER THAT SAYS WHETHER ANY OF THIS IS RECOVERABLE.
                    A refund agreed here becomes debt netted off future payouts
                    at a quarter of each one. Somebody already carrying a large
                    balance is somebody the netting is not reaching — which is
                    a fact about our exposure, not a reason to refuse a
                    customer their money.
                 */}
                {signals.provider.outstandingRupees === null
                  ? t("unknown")
                  : formatNpr(signals.provider.outstandingRupees, { locale })}
              </dd>
            </div>
          </>
        ) : null}

        {signals.customer ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5">
            <dt className="text-muted-foreground">{t("claimRate")}</dt>
            <dd className="tabular-nums">
              {signals.customer.completedBookings === null
                ? t("claimRateNoJobs", {
                    n: String(signals.customer.claims),
                    count: signals.customer.claims,
                  })
                : t("claimRateValue", {
                    n: String(signals.customer.claims),
                    count: signals.customer.claims,
                    jobs: String(signals.customer.completedBookings),
                  })}
            </dd>
          </div>
        ) : null}
      </dl>

      {/*
          SAID ONLY WHEN THE NUMBER IS WORTH READING, and even then it asks for
          a person rather than suggesting an outcome. Below three finished jobs
          there is no rate at all — a first-ever job that went wrong is a 100%
          claim rate and means nothing.
       */}
      {rate.worthReading ? (
        <p className="mt-3 flex items-start gap-2 rounded-md border border-info/30 bg-info/10 p-2.5 text-caption text-info-ink">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{t("reviewNotPunishment")}</span>
        </p>
      ) : null}

      <p className="mt-3 text-caption text-muted-foreground">
        {t("footnote")}
        {/*
            THE SMALL-SAMPLE SENTENCE ONLY WHERE IT IS TRUE. It used to render
            unconditionally, so a screen showing a rate read off six finished
            jobs also said "below 3 finished jobs there is no rate to read" —
            a sentence about the row above it that the row above it disproved.
            A footnote that contradicts its own panel teaches a reader to skip
            footnotes, which is the opposite of what this one is for.
         */}
        {signals.customer && rate.rate === null ? (
          <> {t("smallSample", { min: String(CLAIM_RATE_MIN_JOBS) })}</>
        ) : null}
      </p>
    </section>
  );
}
