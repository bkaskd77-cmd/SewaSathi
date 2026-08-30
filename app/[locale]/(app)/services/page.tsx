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
import { openGraphFor } from "@/lib/seo";
import { getCategories } from "@/lib/data/categories";
import { getCategoryCounts } from "@/lib/data/providers";
import { matchCategories } from "@/lib/data/synonyms";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    title: t("servicesTitle"),
    description: t("servicesDescription"),
    // og:url has to be this page, not the site root — a shared catalogue link
    // that previews the homepage is a link nobody clicks twice.
    openGraph: openGraphFor({
      locale,
      href: "/services",
      title: t("servicesTitle"),
      description: t("servicesDescription"),
    }),
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
    <div className="mx-auto w-full max-w-6xl">
      {/*
        Heading and search share a row on desktop.
        Stacked, they cost about 490px before the first card, which on a laptop
        left four of ten services visible — a catalogue you have to scroll to
        discover is a catalogue people give up on.
      */}
      <div className="animate-rise flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
        <header className="max-w-xl">
          <p className="text-overline uppercase text-gold-ink">{t("eyebrow")}</p>
          {/* One step down on a phone: at display-md this ran to two lines
              and pushed a whole service card below the fold. */}
          <h1 className="mt-2 text-balance font-display text-display-sm sm:text-display-md">
            {t("catalogueTitle")}
          </h1>
          <p className="mt-2 text-pretty text-body-sm text-muted-foreground">
            {t("catalogueLead")}
          </p>
        </header>

        <div className="w-full shrink-0 lg:w-80">
          <CategorySearch query={query || null} />
        </div>
      </div>

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
                href="/#hero"
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

      {/*
        Horizontal cards, three across.
        The tall vertical card was ~310px, so ten of them ran to four screens.
        Laid on its side with the short descriptor rather than the full
        description, a card is ~100px and the whole catalogue fits one view —
        which is the entire job of a catalogue page.
      */}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                  className="flex h-full items-start gap-3 p-3.5 focus-visible:outline-none"
                >
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/[0.08] text-primary transition-colors group-hover:bg-primary/[0.14]"
                  >
                    <Icon className="size-[18px]" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <h2 className="font-display text-body-lg leading-tight">
                      {copy.name}
                    </h2>
                    {/* The short descriptor, not the full description: one
                        line that says what the trade covers is what somebody
                        scanning ten of these actually reads.

                        Hidden on a phone. There the screen is the constraint,
                        not the reading — name, price and availability are what
                        a choice is made on, and dropping this line takes the
                        card from 140px to about 90, which is three more
                        services in view. */}
                    <p className="mt-0.5 hidden truncate text-body-sm text-muted-foreground sm:block">
                      {copy.descriptor}
                    </p>

                    <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-display text-body-md font-bold tabular-nums">
                        {formatNpr(category.basePriceMin, { locale })} –{" "}
                        {formatNpr(category.basePriceMax, { locale })}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {t("available", { count, n: String(count) })}
                      </span>
                    </span>
                  </span>

                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
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
