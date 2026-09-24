import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { AlertTriangle, Clock } from "lucide-react";

import { RefundDecision } from "@/components/admin/refund-decision";
import { RefundPayment } from "@/components/admin/refund-payment";
import { QueueExtent } from "@/components/admin/queue-extent";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { refundQueue } from "@/lib/data/claims";
import { REFUND_PAYMENT_DAYS } from "@/lib/payments/client";
import { formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Guarantee money waiting on a person — in the order the customer feels it.
 *
 * THE OWED MONEY IS AT THE TOP AND THE DECISIONS ARE UNDERNEATH, which is the
 * whole ordering. An unpaid approved refund is the worst thing this product
 * can leave quiet: the customer has been told yes, and from their side a
 * refund that never arrives is indistinguishable from one that was refused
 * without being said. A queue that put the interesting judgements first and
 * the money owed below them would be arranged for the reviewer.
 *
 * WHY THERE ARE TWO STEPS AT ALL. Two of our three rails cannot move money
 * from inside this product — eSewa has no merchant-initiated refund on ePay
 * v2, cash comes back the way it went out — so approving a refund and sending
 * it are genuinely two events with two different people's hands on them. Every
 * row says which rail it is on, in the copy rather than in the terms, because
 * a reviewer who thinks the money went automatically will not go and send it.
 *
 * NOT GENERALISED WITH `/admin/survey-fees` AND `/admin/claims`, deliberately.
 * Three queues that look alike are three different decisions — reimbursing a
 * trip, absorbing a wasted call-out, paying a customer back — and a shared
 * "decision queue" component would make them read as one kind of thing. The
 * repetition is cheap; a reviewer unsure which question is in front of them is
 * not.
 */
export default async function GuaranteeClaimsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.guaranteeClaims");

  /*
   * ROLE AND SECOND FACTOR IN ONE PLACE. Six pages and eight actions
   * each re-read the role; adding a second condition to all fourteen by
   * hand is how one of them ends up without it, and that one is the hole.
   */
  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") redirect({ href: "/login?next=/admin/guarantee-claims", locale });
    // A 404 rather than a refusal: a signed-in customer learns nothing
    // about what exists here, which is what notFound() has always been for.
    if (gate.reason === "notAdmin") notFound();
    // An admin who has to set up or use their code first. They come back.
    redirect({ href: "/account/security?next=/admin/guarantee-claims", locale });
  }

  const [queue, categories, messages] = await Promise.all([
    refundQueue(),
    getCategories(),
    getMessages(),
  ]);

  const tradeName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };

  const staleCount = queue.awaitingPayment.rows.filter((r) => r.stale).length;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {/* ------------------------------------------------------------ *
          Owed and not sent. First, always.
       * ------------------------------------------------------------ */}
      <h2 className="animate-rise mt-10 font-display text-heading-sm">
        {t("owedHeading", { n: String(queue.awaitingPayment.rows.length) })}
      </h2>
      <QueueExtent page={queue.awaitingPayment} />

      {staleCount > 0 ? (
        <p className="animate-pop-in mt-2 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-body-sm text-warning-ink">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("stale", {
              n: String(staleCount),
              days: String(REFUND_PAYMENT_DAYS),
            })}
          </span>
        </p>
      ) : null}

      {queue.awaitingPayment.rows.length === 0 ? (
        <p className="animate-rise mt-4 text-body-md text-muted-foreground">
          {t("owedEmpty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {queue.awaitingPayment.rows.map((refund, index) => (
            <li
              key={refund.refundId}
              className={`animate-rise rounded-lg border p-5 ${
                refund.stale ? "border-warning/40 bg-warning/5" : "border-border"
              }`}
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {formatNpr(refund.amount, { locale })}
                </span>
                <span className="text-caption text-muted-foreground">
                  {refund.bookingReference}
                </span>
              </div>

              <p className="mt-2 flex items-center gap-1.5 text-body-sm text-muted-foreground">
                <Clock aria-hidden="true" className="size-4" />
                {t("approvedOn", {
                  when: formatInstant(refund.requestedAt, locale),
                })}
              </p>

              <p className="mt-2 text-body-sm">{refund.reason}</p>

              {/* WHICH RAIL, IN THE COPY. A reviewer who assumes the money
                  went automatically is a reviewer who never sends it. */}
              <p className="mt-3 text-caption text-muted-foreground">
                {refund.automatic
                  ? t("rail.automatic")
                  : t(`rail.${refund.railReason ?? "cashByHand"}`)}
              </p>

              <NextIntlClientProvider
                locale={locale}
                messages={{ admin: messages.admin }}
              >
                <RefundPayment
                  refundId={refund.refundId}
                  automatic={refund.automatic}
                />
              </NextIntlClientProvider>
            </li>
          ))}
        </ul>
      )}

      {/* ------------------------------------------------------------ *
          Claims where money back is still a decision.
       * ------------------------------------------------------------ */}
      <h2 className="animate-rise mt-12 font-display text-heading-sm">
        {t("decideHeading")}
      </h2>
      <p className="animate-rise mt-2 max-w-2xl text-body-sm text-muted-foreground">
        {t("decideLead")}
      </p>
      <QueueExtent page={queue.decidable} />

      {queue.decidable.rows.length === 0 ? (
        <p className="animate-rise mt-4 text-body-md text-muted-foreground">
          {t("decideEmpty")}
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {queue.decidable.rows.map((claim, index) => (
            <li
              key={claim.claimId}
              className="animate-rise rounded-lg border border-border p-5"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {claim.providerName ?? "—"}
                </span>
                <span className="text-caption text-muted-foreground">
                  {claim.bookingReference}
                </span>
              </div>

              <p className="mt-2 text-body-sm">
                {t("sameFault", { trade: tradeName(claim.categorySlug) })}
              </p>
              <p className="mt-2 rounded-md border border-border p-3 text-body-sm">
                {claim.description}
              </p>
              {claim.verdictNote ? (
                <p className="mt-2 text-body-sm text-muted-foreground">
                  {t("found", { note: claim.verdictNote })}
                </p>
              ) : null}

              <ul className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                {/* THE CEILING IS PRINTED BEFORE THE FIELD. The database
                    refuses a rupee over it whatever this screen sends, and a
                    reviewer should meet that as a rule here rather than as a
                    failed save. */}
                <li>
                  {claim.ceiling === null
                    ? t(`blocked.${claim.blocked ?? "no-amount"}`)
                    : t("ceiling", {
                        amount: formatNpr(claim.ceiling, { locale }),
                      })}
                </li>
                {claim.daysLeft !== null ? (
                  <li className={claim.daysLeft < 0 ? "text-warning-ink" : undefined}>
                    {claim.daysLeft < 0
                      ? t("windowClosed", { days: String(-claim.daysLeft) })
                      : t("windowOpen", { days: String(claim.daysLeft) })}
                  </li>
                ) : null}
              </ul>

              <NextIntlClientProvider
                locale={locale}
                messages={{ admin: messages.admin }}
              >
                <RefundDecision
                  claimId={claim.claimId}
                  ceiling={claim.ceiling}
                />
              </NextIntlClientProvider>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
