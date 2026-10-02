import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { BandActions } from "@/components/admin/band-actions";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { MAX_REVISION_MOVE, PROPOSAL_WINDOW_DAYS } from "@/lib/data/band-proposal";
import { bandRows, type BandRow } from "@/lib/data/bands";
import { formatNpr } from "@/lib/utils/format";

import { approveBandAction, rejectBandAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * What we publish, where it came from, and what our own jobs say instead.
 *
 * THE SYSTEM PROPOSES AND A PERSON DECIDES, which is `docs/PRICING-BANDS.md`'s
 * authority rule and the reason this is a screen rather than a cron job. The band
 * sets the quote, the quote anchors what gets agreed, and those agreed figures are
 * the rows the next proposal reads — a band that moved itself would be measuring
 * its own shadow.
 *
 * THE EVIDENCE IS SHOWN BESIDE THE NUMBER, ALWAYS. Sample, quartiles, how many
 * jobs were capped at the fence, and whether the 20% movement cap bound the
 * result. That last one matters most and is the easiest to leave out: a proposal
 * the cap held back is a proposal whose data asked for more, and an owner
 * approving it should know they are approving a step rather than the answer.
 *
 * NO PROPOSAL IS NOT A PROPOSAL OF THE CURRENT BAND. Below the minimum sample the
 * row shows the count so far and nothing to press — rule 6: not enough evidence is
 * not an endorsement of what is published. The spread still shows whenever there
 * are any settled jobs, because watching p25/p75 drift for two quarters is how
 * somebody builds the judgement the button needs.
 *
 * A SUPPRESSED PROPOSAL SAYS SO. A proposal somebody already rejected is not shown
 * as approvable, and it is not hidden either: the row names the pair, the reason
 * and what would bring it back. A hidden proposal and no proposal must not look
 * alike — the `/services` rule, on the screen that prices ten trades.
 *
 * A FAILED READ IS NOT AN EMPTY CATALOGUE, same rule again.
 */
export default async function BandsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.bands");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/bands", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about what
    // exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/bands", locale });
  }

  const [read, messages] = await Promise.all([bandRows(), getMessages()]);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("forwardOnly")}
        </p>
      </header>

      {read.rows === null ? (
        <p className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-md">
          {t("unreadable")}
        </p>
      ) : (
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ul className="mt-8 space-y-4">
            {read.rows.map((row, index) => (
              <li
                key={row.slug}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
              >
                <Row row={row} locale={locale} />
              </li>
            ))}
          </ul>
        </NextIntlClientProvider>
      )}
    </section>
  );
}

async function Row({ row, locale }: { row: BandRow; locale: Locale }) {
  const t = await getTranslations("admin.bands");
  const money = (amount: number) => formatNpr(amount, { locale });
  const band = (low: number, high: number) => `${money(low)} – ${money(high)}`;

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-body-md font-medium">{row.name}</h2>
        <p className="text-body-sm text-muted-foreground">
          {t(`sources.${row.source}` as "sources.researched")}
          {row.checkedAt ? ` · ${formatInstant(row.checkedAt, locale)}` : ""}
        </p>
      </div>

      <dl className="mt-3 space-y-1 text-body-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <dt className="text-muted-foreground">{t("published")}</dt>
          <dd className="tabular-nums">{band(row.current.low, row.current.high)}</dd>
        </div>
      </dl>

      {row.note ? (
        <p className="text-caption mt-1 text-muted-foreground">{row.note}</p>
      ) : null}

      {/*
        WHO LAST CHANGED IT. Null before the editor existed — every band published
        today came from the launch research, which `pricing_source` and the note
        above already say. The line is absent rather than reading "nobody".
      */}
      {row.lastDecision ? (
        <p className="text-caption mt-1 text-muted-foreground">
          {t(
            row.lastDecision.decision === "approved"
              ? "lastApproved"
              : "lastRejected",
            {
              who: row.lastDecision.actorName ?? t("unnamed"),
              when: formatInstant(row.lastDecision.decidedAt.toISOString(), locale),
              why: row.lastDecision.reason,
            },
          )}
        </p>
      ) : null}

      {/* The observed spread, whenever there is anything at all to show. */}
      {row.spread ? (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-body-sm font-semibold">{t("observed")}</h3>
          <p className="text-caption mt-1 text-muted-foreground">
            {t("window", { days: String(PROPOSAL_WINDOW_DAYS) })}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-body-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">{t("jobs")}</dt>
              <dd className="tabular-nums">{row.spread.sample}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("q1")}</dt>
              <dd className="tabular-nums">{money(row.spread.q1)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("median")}</dt>
              <dd className="tabular-nums">{money(row.spread.median)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{t("q3")}</dt>
              <dd className="tabular-nums">{money(row.spread.q3)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {row.proposal === null ? (
        /*
          NOT ENOUGH EVIDENCE, SAID AS A COUNT. The row is honest about why it is
          quiet rather than looking broken, and it offers nothing to press — a
          proposal of the current band would be a recommendation nobody computed.
        */
        <p className="mt-4 border-t border-border pt-3 text-body-sm text-muted-foreground">
          {t("tooFew", {
            have: String(row.sample.have),
            needed: String(row.sample.needed),
          })}
        </p>
      ) : row.suppressed ? (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-body-sm font-semibold">{t("suppressedTitle")}</h3>
          <p className="mt-1 text-body-sm">
            {t("suppressedBody", {
              band: band(row.suppressed.proposedLow, row.suppressed.proposedHigh),
              when: formatInstant(row.suppressed.decidedAt.toISOString(), locale),
              why: row.suppressed.reason,
            })}
          </p>
          <p className="text-caption mt-1 text-muted-foreground">
            {t("suppressedReturns", {
              n: String(Math.ceil(row.suppressed.sample * 1.5)),
            })}
          </p>
        </div>
      ) : (
        <div className="mt-4 border-t border-border pt-3">
          <h3 className="text-body-sm font-semibold">{t("proposed")}</h3>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 text-body-md">
            <span className="text-muted-foreground tabular-nums">
              {band(row.current.low, row.current.high)}
            </span>
            <span aria-hidden className="text-muted-foreground">
              →
            </span>
            <span className="font-medium tabular-nums">
              {band(row.proposal.low, row.proposal.high)}
            </span>
          </div>
          <p className="text-caption mt-2 text-muted-foreground">
            {t("evidence", {
              n: String(row.proposal.sample),
              capped: String(row.proposal.winsorised),
            })}
          </p>
          {/*
            THE CAP IS NEVER SILENT. A proposal the 20% limit held back is one whose
            data asked for a bigger move, and `uncapped` is what the sample actually
            said — hiding it would hide the one signal that says "this may be two
            products, not one price".
          */}
          {row.proposal.capped ? (
            <p className="mt-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-body-sm">
              {t("cappedNote", {
                pct: String(Math.round(MAX_REVISION_MOVE * 100)),
                band: band(row.proposal.uncapped.low, row.proposal.uncapped.high),
              })}
            </p>
          ) : null}

          <BandActions
            slug={row.slug}
            low={row.proposal.low}
            high={row.proposal.high}
            sample={row.proposal.sample}
            winsorised={row.proposal.winsorised}
            capped={row.proposal.capped}
            approve={approveBandAction}
            reject={rejectBandAction}
          />
        </div>
      )}
    </>
  );
}
