import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { SurveyFeeDecision } from "@/components/admin/survey-fee-decision";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { pendingSurveyFees } from "@/lib/data/survey";
import { PAYOUT_RULES } from "@/lib/payments/client";
import { formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Survey trips waiting on a person.
 *
 * WHY THERE IS A QUEUE AT ALL. Movers is the one trade where every job starts
 * with somebody crossing the Valley to look at a flat, and that happens whether
 * or not the customer accepts the price. A fee that paid itself would be
 * farmable — quote absurdly high, get declined, collect — so every row is born
 * `pending` and the default is NOT PAID. This screen is the only thing that
 * changes that, four times a month per professional at most.
 *
 * WHAT IS BEING DECIDED IS WHETHER WE COVER THIS TRIP, not whether anybody did
 * anything wrong. The customer declined or let the quote lapse; neither is a
 * fault, and a reviewer who thinks they are judging conduct reads the evidence
 * very differently from one who knows they are deciding a reimbursement.
 *
 * THE TRADE'S DECLINE RATE IS ON THE CARD AND THE PERSON'S IS NOT. A high rate
 * has three readings and only one is about somebody: quoting high, a ward where
 * customers shop around, or our whole proposition for that trade being
 * mispriced. Read the wrong way round, a per-person rate is a list of people to
 * punish for a price we set — which is exactly why `survey_decline_signals` is
 * grouped by category, and why the number appears here and nowhere else.
 */
export default async function SurveyFeesPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.surveyFees");

  /*
   * ROLE AND SECOND FACTOR IN ONE PLACE. Six pages and eight actions
   * each re-read the role; adding a second condition to all fourteen by
   * hand is how one of them ends up without it, and that one is the hole.
   */
  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") redirect({ href: "/login?next=/admin/survey-fees", locale });
    // A 404 rather than a refusal: a signed-in customer learns nothing
    // about what exists here, which is what notFound() has always been for.
    if (gate.reason === "notAdmin") notFound();
    // An admin who has to set up or use their code first. They come back.
    redirect({ href: "/account/security?next=/admin/survey-fees", locale });
  }

  const [fees, categories, messages] = await Promise.all([
    pendingSurveyFees(),
    getCategories(),
    getMessages(),
  ]);

  const tradeName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {fees.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {fees.map((fee, index) => (
            <li
              key={fee.id}
              className="animate-rise rounded-lg border border-border p-5"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {fee.providerName ?? "—"}
                </span>
                <span className="text-caption text-muted-foreground">
                  {fee.reference}
                </span>
              </div>

              <p className="mt-2 text-body-sm">
                {t(`outcome.${fee.outcome === "expired" ? "expired" : "declined"}`, {
                  trade: tradeName(fee.categorySlug),
                })}
              </p>

              <ul className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <li>
                  {t("when", { when: formatInstant(fee.createdAt, locale) })}
                </li>
                {/* The cap is the trigger's and it counts APPROVED rows only.
                    Shown before the decision because the fifth is refused by
                    the database, and a reviewer should meet that as a policy
                    here rather than as a failed save. */}
                <li
                  className={
                    fee.approvedThisMonth >= PAYOUT_RULES.surveyVisitFeeMonthlyCap
                      ? "text-warning-ink"
                      : undefined
                  }
                >
                  {t("thisMonth", {
                    n: String(fee.approvedThisMonth),
                    cap: String(PAYOUT_RULES.surveyVisitFeeMonthlyCap),
                  })}
                </li>
                {/* Unmeasured is not zero. A trade nobody has surveyed prints
                    no rate rather than a 0% that would read as evidence. */}
                <li>
                  {fee.tradeDeclineRate === null
                    ? t("tradeRateUnknown", { trade: tradeName(fee.categorySlug) })
                    : t("tradeRate", {
                        trade: tradeName(fee.categorySlug),
                        pct: String(fee.tradeDeclineRate),
                      })}
                </li>
              </ul>

              <p className="mt-3 text-caption text-muted-foreground">
                {t("pays", { amount: formatNpr(fee.amount, { locale }) })}
              </p>

              <NextIntlClientProvider
                locale={locale}
                messages={{ admin: messages.admin }}
              >
                <SurveyFeeDecision feeId={fee.id} />
              </NextIntlClientProvider>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
