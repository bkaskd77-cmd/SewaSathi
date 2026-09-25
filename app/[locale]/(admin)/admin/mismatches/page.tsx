import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { MismatchDecision } from "@/components/admin/mismatch-decision";
import { QueueExtent } from "@/components/admin/queue-extent";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { openAmountMismatches } from "@/lib/data/payments";
import { formatBand, formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * "The two amounts do not match — we are looking at it."
 *
 * THIS SCREEN IS THAT SENTENCE BECOMING TRUE. For cash the customer types what
 * they handed over without being shown the professional's figure, because that
 * independent number is the only witness a cash handover has. When the two
 * disagree nothing settles: both are kept, both sides are told, and a person
 * decides. Until this page existed there was no person — the stamp was never
 * cleared by anything, so the booking sat unpaid for ever, the professional was
 * never paid, and every guarantee claim on that job was blocked.
 *
 * OLDEST FIRST, AND THAT IS NOT A DETAIL. The row at the top has kept somebody
 * unpaid the longest.
 *
 * WHAT IS ON SCREEN IS BOTH FIGURES AND THE BAND WE PUBLISHED, and nothing
 * about either person's history. The question is what was actually handed over
 * in that kitchen, and a reliability score cannot answer it — it can only make
 * the reviewer feel entitled to guess.
 *
 * NO MODEL READS ANY OF THIS. The signals we already have are the intelligence,
 * and a model call from the highest-privilege screen in the product would send
 * addresses and phone numbers out of it.
 */
export default async function MismatchesPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.mismatches");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/mismatches", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about
    // what exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/mismatches", locale });
  }

  const [queue, categories, messages] = await Promise.all([
    openAmountMismatches(),
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
      <QueueExtent page={queue} />

      {queue.rows.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-4">
          {queue.rows.map((job, index) => {
            const recordedLabel =
              job.recorded === null
                ? t("unrecorded")
                : formatNpr(job.recorded, { locale });
            const reportedLabel =
              job.reported === null
                ? t("saidNothing")
                : formatNpr(job.reported, { locale });

            return (
              <li
                key={job.bookingId}
                className="animate-rise rounded-lg border border-border p-5"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-heading-sm">
                    {job.providerName ?? "—"}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {job.reference}
                  </span>
                </div>

                <p className="mt-2 text-body-sm text-muted-foreground">
                  {t("trade", { trade: tradeName(job.categorySlug) })}
                  {" · "}
                  {t("since", { when: formatInstant(job.flaggedAt, locale) })}
                </p>

                {/* THE TWO FIGURES, SIDE BY SIDE AND EQUALLY WEIGHTED. Neither
                    is the default: a screen that made one of them look like
                    the answer would be deciding the case in its layout. */}
                <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                  <Row label={t("customerSaid")} value={reportedLabel} />
                  <Row label={t("professionalSaid")} value={recordedLabel} />
                  <Row
                    label={t("published")}
                    value={
                      formatBand(
                        { min: job.quotedMin, max: job.quotedMax },
                        { locale },
                      ) ?? t("unrecorded")
                    }
                  />
                </dl>

                <NextIntlClientProvider
                  locale={locale}
                  messages={{ admin: messages.admin }}
                >
                  <MismatchDecision
                    bookingId={job.bookingId}
                    recordedLabel={recordedLabel}
                    reportedLabel={reportedLabel}
                    canTakeReported={job.reported !== null}
                  />
                </NextIntlClientProvider>
              </li>
            );
          })}
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
