import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import {
  DOCUMENT_SLUGS,
  documentVersions,
  liveDocument,
  workingCopy,
} from "@/lib/content/documents";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The eight long-form documents.
 *
 * WHY THESE ARE VERSIONED AND THE INTERFACE STRINGS ARE NOT. A button label is just its
 * current wording; nobody needs to know what it said last March. The terms are different in
 * kind — a customer agreed to a specific text on a specific day, and in a dispute the only
 * answer that means anything is what it said then. So each publish is an append-only row and
 * `bookings.terms_version` points at the one in force when the booking was made.
 *
 * NOTHING IS PUBLISHED TODAY AND THAT IS THE NORMAL STATE. Every document falls back to its
 * file in the repository, so a fresh clone renders all eight and an unreachable database
 * shows the words rather than a blank page — on the pages somebody agrees to before booking,
 * where a blank render is least acceptable.
 */
export default async function DocumentsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.content.documents");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/content/documents", locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/content/documents", locale });
  }

  const rows = await Promise.all(
    DOCUMENT_SLUGS.map(async (slug) => ({
      slug,
      live: await liveDocument(slug, "en"),
      versions: await documentVersions(slug),
      pending: await workingCopy(slug),
    })),
  );

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-10">
      <p className="animate-rise text-caption text-muted-foreground">
        <Link href="/admin/content" className="underline underline-offset-4">
          {t("backToStrings")}
        </Link>
      </p>

      <h1 className="animate-rise mt-2 font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      <ul className="mt-8 space-y-3">
        {rows.map((row, index) => (
          <li
            key={row.slug}
            className="animate-rise rounded-lg border border-border p-4"
            style={{ animationDelay: `${Math.min(index * 0.03, 0.2)}s` }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/admin/content/documents/${row.slug}`}
                className="font-display text-body-lg underline-offset-4 hover:underline"
              >
                {row.live.document.title}
              </Link>
              <code className="text-caption font-mono text-muted-foreground">
                {row.slug}
              </code>
            </div>

            <p className="mt-1.5 text-caption text-muted-foreground">
              {/*
                NOTHING PUBLISHED IS SAID PLAINLY RATHER THAN SHOWN AS VERSION ZERO. The
                file in the repository is what renders, and calling that "version 0" would
                invent a row nobody wrote — rule 6 in the shape it takes for a pointer.
              */}
              {row.live.version === null
                ? t("fromTheRepository")
                : t("liveVersion", {
                    n: String(row.live.version),
                    date: (row.live.effectiveFrom ?? "").slice(0, 10),
                  })}
              {row.versions === null
                ? ` · ${t("historyUnread")}`
                : row.versions.length > 0
                  ? ` · ${t("published", { n: String(row.versions.length), count: row.versions.length })}`
                  : ""}
            </p>

            {row.pending === undefined ? (
              <p className="mt-2 text-caption text-warning-ink">{t("pendingUnread")}</p>
            ) : row.pending ? (
              <p className="mt-2 text-caption text-warning-ink">
                {t("pendingEdit", { date: row.pending.updatedAt.slice(0, 10) })}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
