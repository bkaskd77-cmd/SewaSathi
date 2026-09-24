import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, CircleAlert, CircleCheck } from "lucide-react";

import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { adminQueueCounts } from "@/lib/data/admin-queues";
import { queuesState } from "@/lib/data/queue";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "admin.index",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * The front door, which did not exist.
 *
 * FIVE SCREENS AND NO WAY IN. `/admin` had no page, so an admin who typed it
 * met the catch-all 404, and nothing anywhere in the product linked to
 * `/admin/applications`, `/admin/claims`, `/admin/guarantee-claims`,
 * `/admin/survey-fees` or `/admin/appeals`. You reached them by already
 * knowing the URL. Work accumulated in queues nobody opened, because nothing
 * told anybody they had filled up — which is the same failure the cap silence
 * produced one level down, and the reason both were fixed together.
 *
 * COUNTS ARE THE WHOLE CONTENT. Not a dashboard: six numbers and six links,
 * ordered so the thing that costs us most if ignored sits at the top.
 * Applications lead for the reason the queue itself is sorted by waiting — a
 * good tradesperson who waits three weeks has already signed up elsewhere, and
 * that loss appears in no metric anybody looks at.
 *
 * NO CLIENT JAVASCRIPT. It is six links and a heading. That also means it is
 * correct on a connection that never finishes loading a bundle, which is the
 * state somebody is in when they are checking on a phone whether anything
 * needs them.
 *
 * NOTHING IS SUMMARISED BY A MODEL. The counts are the intelligence, and a
 * model call from the highest-privilege screen in the product would put
 * addresses, names and phone numbers into a request that leaves the building
 * for no gain a number does not already give.
 */
export default async function AdminIndexPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.index");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about
    // what exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin", locale });
  }

  const queues = await adminQueueCounts();
  const state = queuesState(queues);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {/* The one-line answer to "does anything need me", before the list.
          `unknown` is its own state and is never folded into "all clear" —
          not looking must not read as nothing waiting. */}
      {state === "clear" ? (
        <p className="animate-rise mt-4 inline-flex items-center gap-2 text-body-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-4 text-success-ink" />
          {t("allClear")}
        </p>
      ) : null}
      {state === "unknown" ? (
        <p
          role="alert"
          className="animate-rise mt-4 inline-flex items-center gap-2 text-body-sm text-warning-ink"
        >
          <CircleAlert aria-hidden="true" className="size-4" />
          {t("noneReadable")}
        </p>
      ) : null}

      <ul className="mt-8 space-y-3">
        {queues.map((queue, index) => (
          <li
            key={queue.key}
            className="animate-rise"
            style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
          >
            <Link
              href={queue.href}
              className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 transition-colors hover:border-primary/50"
            >
              <span>
                <span className="font-display text-heading-sm">
                  {t(`queues.${queue.key}.name`)}
                </span>
                <span className="mt-1 block text-body-sm text-muted-foreground">
                  {t(`queues.${queue.key}.what`)}
                </span>
              </span>

              <span className="flex shrink-0 items-center gap-2">
                {/*
                 * The count, or a dash. A failed read prints neither a number
                 * nor a zero: "0 waiting" from a broken query is the sentence
                 * that tells somebody to go home.
                 */}
                <span
                  className={
                    queue.total === null
                      ? "text-body-md text-warning-ink"
                      : queue.total > 0
                        ? "font-display text-heading-sm text-foreground"
                        : "text-body-md text-muted-foreground"
                  }
                >
                  {queue.total === null ? t("unreadable") : String(queue.total)}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-4 text-muted-foreground"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {/* Said once here rather than repeated on six cards. The per-queue line
          on each screen carries the exact numbers. */}
      <p className="animate-rise mt-6 text-caption text-muted-foreground">
        {t("capNote")}
      </p>
    </section>
  );
}
