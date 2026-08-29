import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";

import {
  DataSourceBadge,
  dataDebugEnabled,
} from "@/components/services/data-source-badge";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { categoryCopy, categoryIcon } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { getCategoryCounts } from "@/lib/data/providers";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return {
    title: t("servicesTitle"),
    description: t("servicesDescription"),
  };
}

/**
 * The catalogue.
 *
 * Reads the `categories` table, so the prices here are the same numbers the
 * landing page quotes and the same ones Claude is given for triage. The
 * provider count is the honest bit: a category with three professionals says
 * three, because "we have everything" is exactly the claim this market has
 * heard too many times.
 */
export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [categories, counts, locale, t] = await Promise.all([
    getCategories(),
    getCategoryCounts(),
    getLocale() as Promise<Locale>,
    getTranslations("services"),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="animate-rise max-w-2xl">
        <p className="text-overline uppercase text-gold-ink">{t("eyebrow")}</p>
        <h1 className="mt-2 text-balance font-display text-display-md">
          {t("catalogueTitle")}
        </h1>
        <p className="mt-3 text-pretty text-body-md text-muted-foreground">
          {t("catalogueLead")}
        </p>
      </header>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category, index) => {
          const Icon = categoryIcon(category.icon);
          const count = counts[category.slug] ?? 0;
          const copy = categoryCopy(category, locale);

          return (
            <li key={category.slug}>
              <Card
                className="animate-rise group h-full transition-shadow focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background hover:shadow-md"
                style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
              >
                <Link
                  href={`/services/${category.slug}`}
                  className="flex h-full flex-col p-5 focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-11 place-items-center rounded-lg bg-primary/[0.08] text-primary transition-colors group-hover:bg-primary/[0.14]"
                  >
                    <Icon className="size-5" />
                  </span>

                  <h2 className="mt-4 font-display text-display-sm">
                    {copy.name}
                  </h2>
                  <p className="mt-1.5 flex-1 text-pretty text-body-sm text-muted-foreground">
                    {copy.description}
                  </p>

                  <p className="mt-4 font-display text-body-md font-bold tabular-nums">
                    {formatNpr(category.basePriceMin, { locale })} –{" "}
                    {formatNpr(category.basePriceMax, { locale })}
                  </p>

                  <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
                    {t("available", { count, n: String(count) })}
                    <ArrowRight
                      aria-hidden="true"
                      className="size-3.5 transition-transform group-hover:translate-x-0.5"
                    />
                  </p>
                </Link>
              </Card>
            </li>
          );
        })}
      </ul>

      <DataSourceBadge enabled={dataDebugEnabled(searchParams)} />
    </div>
  );
}
