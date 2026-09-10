import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight } from "lucide-react";

import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { areaShortLabel } from "@/lib/config/areas";
import { reviewQueue } from "@/lib/data/verification";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "admin.meta",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * The queue.
 *
 * SORTED BY WAITING, NOT BY RISK, and that is the decision this screen
 * encodes. A queue ordered by suspicion puts the quiet, complete applications
 * at the bottom — and those are the ones the platform actually needs, because
 * a flagged application at least gets opened. A good plumber who waits three
 * weeks has already signed up with somebody else, and that loss shows up in no
 * metric anybody looks at.
 *
 * THE FLAG IS A SENTENCE, NOT A SCORE. "Matches a removed applicant" is
 * something a reviewer can act on. A number is something they learn to trust,
 * and the day the number is wrong nobody notices.
 */
export default async function ApplicationQueuePage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.queue");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=/admin/applications", locale });
  }
  // Route-level gating is not the boundary — every table below is admin-only
  // under RLS — but a non-admin should meet a 404 rather than a shell.
  if (profile!.role !== "admin") notFound();

  const rows = await reviewQueue();

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {rows.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {rows.map((row, index) => (
            <li
              key={row.applicationId}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <Link
                href={`/admin/applications/${row.applicationId}`}
                className="block rounded-lg border border-border p-4 transition-colors hover:border-primary/50"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-display text-heading-sm">
                    {row.fullName ?? t("unnamed")}
                  </span>
                  {/* Waiting is the number that leads, because it is the one
                      that costs us supply. */}
                  <span className="text-caption text-muted-foreground">
                    {row.waitingDays > 0
                      ? t("waitingDays", { days: String(row.waitingDays) })
                      : t("waitingToday")}
                  </span>
                </div>

                <p className="mt-1 text-body-sm text-muted-foreground">
                  {row.trades.join(", ") || "—"}
                  {row.serviceAreas.length > 0
                    ? ` · ${row.serviceAreas
                        .map((key) => areaShortLabel(key, locale))
                        .join(", ")}`
                    : ""}
                </p>

                {row.riskScore >= 55 ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 text-body-sm text-warning-ink">
                    <AlertTriangle aria-hidden="true" className="size-4" />
                    {t("flagged")}
                  </p>
                ) : null}

                <span className="mt-3 inline-flex items-center gap-1 text-body-sm text-primary">
                  {t("open")}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
