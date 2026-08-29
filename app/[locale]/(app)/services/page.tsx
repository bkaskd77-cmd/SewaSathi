import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowRight, SearchX } from "lucide-react";

import { CategorySearch } from "@/components/services/category-search";
import {
  DataSourceBadge,
  dataDebugEnabled,
} from "@/components/services/data-source-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { categoryCopy, categoryIcon } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { getCategoryCounts } from "@/lib/data/providers";
import { matchCategories } from "@/lib/data/synonyms";
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
  const [all, counts, locale, t] = await Promise.all([
    getCategories(),
    getCategoryCounts(),
    getLocale() as Promise<Locale>,
    getTranslations("services"),
  ]);

  const raw = searchParams.q;
  const query = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim().slice(0, 80);

  /*
    Two ways to match, because people arrive with two different words.

    The alias table covers what they call the trade — मिस्त्री, plumber,
    फर्निचर मर्मत. The display copy covers what we call it, which is what
    somebody types after reading the page. Neither alone is enough: our own
    formal names are not what anyone searches for, and the alias table would
    otherwise have to repeat every category name in both languages.
  */
  const matched = query ? matchCategories(query) : [];
  const needle = query.toLowerCase();

  const copyMatches = (category: (typeof all)[number]) => {
    const copy = categoryCopy(category, locale);
    return (
      category.slug.includes(needle) ||
      copy.name.toLowerCase().includes(needle) ||
      copy.descriptor.toLowerCase().includes(needle) ||
      copy.description.toLowerCase().includes(needle)
    );
  };

  /*
    Results are ordered by relevance, not by the catalogue's own sort order.
    `matchCategories` already ranks by how specific the matched word was, so
    "फर्निचर मर्मत" leads with carpentry rather than with whichever of the
    ambiguous "मर्मत" categories happens to sort first. A copy-only match sorts
    after every alias match, and keeps the catalogue order among themselves.
  */
  const categories = query
    ? all
        .filter(
          (category) =>
            matched.includes(category.slug) || copyMatches(category),
        )
        .map((category, index) => {
          const rank = matched.indexOf(category.slug);
          return {
            category,
            rank: rank === -1 ? matched.length + index : rank,
          };
        })
        .sort((a, b) => a.rank - b.rank)
        .map(({ category }) => category)
    : all;

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

      <CategorySearch query={query || null} />

      {query ? (
        <p
          aria-live="polite"
          className="mt-3 text-caption text-muted-foreground"
        >
          {t("searchResults", {
            n: String(categories.length),
            total: String(all.length),
            query,
          })}
        </p>
      ) : null}

      {query && categories.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={SearchX}
            title={t("searchEmptyTitle", { query })}
            description={t("searchEmptyBody")}
            action={
              <Link
                href="/#hero-search"
                className={buttonVariants({
                  variant: "gold",
                  className: "btn-tactile",
                })}
              >
                {t("searchEmptyAction")}
              </Link>
            }
          />
        </div>
      ) : null}

      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
