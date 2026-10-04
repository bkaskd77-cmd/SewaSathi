import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { CategoryEditor } from "@/components/admin/category-editor";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { getCategories } from "@/lib/data/categories";
import { readDataSources } from "@/lib/data/source";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The ten services, editable.
 *
 * WHY STRAIGHT TO `categories` AND NOT AN OVERRIDE TABLE. The interface strings get an
 * override because `messages/*.json` is the source of truth and has to stay that way —
 * three guards read it. Category copy is the opposite: the table is already the live
 * source, `lib/data/seed/categories.json` is already its fallback, and adding a layer on
 * top of something already editable would be two places to look for one answer.
 *
 * A FALLBACK IS NAMED RATHER THAN HIDDEN. If this render came from the seed, the table
 * was unreachable — so an edit would write somewhere nobody is reading from and appear to
 * do nothing. The screen says so and does not offer the forms, which is the `/services`
 * rule: a failed read must never look like a measured zero, and here it must not look
 * like a working editor either.
 *
 * NO PRICES. The band is `/admin/bands`.
 */
export default async function CategoriesPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.content.categories");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/content/categories", locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/content/categories", locale });
  }

  const [categories, messages] = await Promise.all([getCategories(), getMessages()]);
  /* Read AFTER the query — `markDataSource` is what the query writes into. */
  const reading = readDataSources().categories;

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="animate-rise text-caption text-muted-foreground">
        <Link href="/admin/content" className="underline underline-offset-4">
          {t("backToStrings")}
        </Link>
      </p>

      <h1 className="animate-rise mt-2 font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {reading.source === "database" ? (
        <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
          <ul className="mt-8 space-y-4">
            {categories.map((category, index) => (
              <li
                key={category.slug}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.04, 0.25)}s` }}
              >
                <CategoryEditor category={category} />
              </li>
            ))}
          </ul>
        </NextIntlClientProvider>
      ) : (
        <p
          role="status"
          className="animate-rise mt-8 rounded-lg border border-warning/30 bg-warning/[0.07] p-4 text-body-sm text-warning-ink"
        >
          {t("notEditable")}
        </p>
      )}
    </section>
  );
}
