import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { AppealDecision } from "@/components/admin/appeal-decision";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { formatInstant } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { openCommissionAppeals } from "@/lib/data/payments";
import { formatBand, formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * "This job really was smaller than the band."
 *
 * WHY THE FLOOR EXISTS, because a reviewer needs it in front of them. The fee
 * is charged on `max(final_amount, quoted_min)`, and that is the whole answer
 * to under-reporting: a professional who takes Rs 2,000 in cash and records
 * 1,000 satisfies every validation in the product, so the payoff is removed
 * rather than the number policed. The cost of that design is that it
 * occasionally lands on a job which genuinely was a five-minute washer. This
 * queue is where that gets put right.
 *
 * THE EVIDENCE IS THE ARITHMETIC — what was collected, what the fee was charged
 * on, and what the band said. The question is not whether this person is
 * honest. It is whether this job was genuinely smaller than the price we
 * published, and only the second question is answerable from a screen.
 *
 * ONE APPEAL AT A TIME, NEVER A PATTERN ABOUT A PERSON. A whole category
 * bunching under its floor is OUR mispricing, and `category_pricing_signals`
 * counts exactly that — per category, deliberately never per professional.
 */
export default async function AppealsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.appeals");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=/admin/appeals", locale });
  }
  if (profile!.role !== "admin") notFound();

  const [appeals, categories, messages] = await Promise.all([
    openCommissionAppeals(),
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

      {appeals.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {appeals.map((appeal, index) => (
            <li
              key={appeal.id}
              className="animate-rise rounded-lg border border-border p-5"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-display text-heading-sm">
                  {appeal.providerName ?? "—"}
                </span>
                <span className="text-caption text-muted-foreground">
                  {appeal.reference}
                </span>
              </div>

              <p className="mt-2 text-body-sm text-muted-foreground">
                {t("trade", { trade: tradeName(appeal.categorySlug) })}
                {" · "}
                {t("when", { when: formatInstant(appeal.createdAt, locale) })}
              </p>

              {/* THEIR OWN WORDS, ABOVE THE NUMBERS. The arithmetic says how
                  much; only the sentence says why. */}
              <p className="mt-3 rounded-md border border-border p-3 text-body-sm">
                {appeal.reason}
              </p>

              <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <Row
                  label={t("collected")}
                  value={
                    appeal.finalAmount === null
                      ? t("unrecorded")
                      : formatNpr(appeal.finalAmount, { locale })
                  }
                />
                <Row
                  label={t("chargedOn")}
                  value={
                    appeal.commissionBasis === null
                      ? t("unrecorded")
                      : formatNpr(appeal.commissionBasis, { locale })
                  }
                />
                <Row
                  label={t("published")}
                  value={
                    formatBand(
                      { min: appeal.quotedMin, max: appeal.quotedMax },
                      { locale },
                    ) ?? t("unrecorded")
                  }
                />
              </dl>

              <NextIntlClientProvider
                locale={locale}
                messages={{ admin: messages.admin }}
              >
                <AppealDecision appealId={appeal.id} />
              </NextIntlClientProvider>
            </li>
          ))}
        </ul>
      )}
    </section>
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
