import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronRight, Sparkles } from "lucide-react";

import { dataDebugEnabled } from "@/components/services/data-source-badge";
import { ProviderFilters } from "@/components/services/provider-filters";
import {
  ProviderList,
  ProviderListSkeleton,
} from "@/components/services/provider-list";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { areaShortLabel } from "@/lib/config/areas";
import { areasByCity } from "@/lib/config/areas";
import { categoryCopy, categoryQuote } from "@/lib/config/services";
import { allAreas, bookableAreas, openAreas } from "@/lib/data/areas";
import { openGraphFor } from "@/lib/seo";
import { getSubBands, openCategory } from "@/lib/data/categories";
import { bandBounds, type BandSource } from "@/lib/booking";
import type { SortOption } from "@/lib/data/ranking";
import { formatNpr } from "@/lib/utils";

/**
 * One category, with the professionals in it.
 *
 * The filters live in the URL and this page renders whatever the URL says, so
 * the list itself needs no client JavaScript and a filtered view is a link
 * somebody can send to their landlord.
 *
 * `?q=` and `?urgency=` arrive from the triage card. They are reflected at the
 * top rather than silently dropped: somebody who has just typed "AC not
 * cooling, needed today" should not land on a page that acts like they said
 * nothing.
 */

type SearchParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined): string | null =>
  Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

/**
 * Filters and the triage context both live in the query string, so this page
 * is per-request by definition. Prerendering the ten slugs looked appealing
 * until you notice a prerendered page cannot read `?availability=now`.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: "meta" });
  const category = await openCategory(params.slug);
  if (!category) return { title: t("categoryNotFound") };

  const copy = categoryCopy(category, locale);
  const title = t("categoryTitle", { category: copy.name });
  /*
   * The search snippet is the one place a price gets quoted with nobody
   * around to qualify it, so a survey trade must not carry one here either.
   * Google caches this; an invented range would outlive the fix.
   */
  /*
   * AN UNREADABLE BAND GETS THE SAME SENTENCE AS A SURVEY TRADE HERE, and only
   * here, which is the one place `categoryQuote`'s third answer is allowed to
   * collapse into its second. This string is a meta description: Google caches
   * it, so a range quoted off a figure nobody could vouch for would outlive the
   * blip that caused it by weeks, and there is nobody around to qualify it. The
   * survey wording ("priced after a visit") is the closest true thing to say
   * about a trade whose price we cannot currently state — and unlike the card,
   * no reader of it is about to be sent into a surveyor flow.
   */
  const quote = categoryQuote(category);
  const description =
    quote.kind === "band"
      ? t("categoryDescription", {
          description: copy.description,
          low: formatNpr(quote.low, { locale }),
          high: formatNpr(quote.high, { locale }),
        })
      : t("categoryDescriptionSurvey", { description: copy.description });

  return {
    title,
    description,
    openGraph: openGraphFor({
      locale,
      href: `/services/${category.slug}`,
      title,
      description,
    }),
  };
}

export default async function CategoryPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const category = await openCategory(params.slug);
  if (!category) notFound();

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("services");
  const copy = categoryCopy(category, locale);

  const area = first(searchParams.area);
  const availability = first(searchParams.availability);
  const rating = first(searchParams.rating);
  const maxRate = first(searchParams.maxRate);
  const sort = (first(searchParams.sort) ?? "relevance") as SortOption;
  const verified = first(searchParams.verified) === "1";
  const urgency = first(searchParams.urgency);
  const q = first(searchParams.q);
  // Triage context, like `q` and `urgency` beside it — never a filter.
  const band = first(searchParams.band);
  const bandSource = first(searchParams.bandSource);
  // Whether the card put its product question, carried through so the booking
  // can tell "never asked" from "I am not sure". See band_ask_signals.
  const asked = first(searchParams.asked) === "1";
  // The triage row this journey started from. Carried, never read here: it
  // changes nothing on this page and exists only so the booking can point back
  // at the triage that produced it.
  const triageLogId = first(searchParams.triage);

  const listParams = {
    category: category.slug,
    area,
    availability,
    verified,
    rating: rating ? Number(rating) : null,
    maxRate: maxRate ? Number(maxRate) : null,
    sort,
    urgency,
    q,
    band,
    bandSource,
    asked,
    triageLogId,
  };

  /*
   * THE NUMBER THE CUSTOMER WAS SHOWN, CARRIED THROUGH.
   *
   * This rendered the CATEGORY band whatever `?band=` said, so the product the
   * triage card asked about — and the published range it printed — were lost
   * at the first link. A customer who answered "AC repair" read 500-1,500 and
   * then 500-12,000 one tap later. `createBooking` freezes the same bounds, so
   * the figure is the same on all three screens now.
   *
   * Only a customer-stated band narrows it, which is the rule `bandBounds`
   * owns and `booking_band_bounds` enforces in Postgres.
   */
  /*
   * NO PRODUCTS EITHER WHEN THE BAND IS UNREADABLE, which keeps one screen
   * saying one thing. `getSubBands` is its OWN query and may well have
   * succeeded, so the seed's product prices would render perfectly well
   * underneath a line saying we cannot state a price — a contradiction in one
   * header, and the same staleness one level down.
   */
  const quote = categoryQuote(category);
  const subBands = quote.kind === "band" ? await getSubBands() : [];
  /*
   * TWO READS, TWO QUESTIONS — the split `lib/data/areas.ts` is built around.
   * `areaRows` LABELS the ward in the filter heading, so it includes retired
   * ones: a shared link to a withdrawn ward still has to say which one it was.
   * `bookable` is what the filter may OFFER, so it does not — filtering for a
   * ward we withdrew searches for coverage we no longer have. One wave.
   */
  const [areaRows, open] = await Promise.all([allAreas(), openAreas()]);
  /*
   * AN UNREADABLE SCOPE FALLS BACK TO EVERY LIVE WARD, because this is a filter
   * rather than a booking: `openAreas()` already returns null when the AREA
   * read failed too, and `bookableAreas()` would return null for that same
   * failure, so the fallback cannot widen past what we serve. `/book` is where
   * refusing is right.
   */
  const bookable = open ?? (await bookableAreas());
  const statedBand =
    band && bandSource === "customer"
      ? (subBands.find(
          (sub) => sub.categorySlug === category.slug && sub.slug === band,
        ) ?? null)
      : null;
  const bounds =
    quote.kind === "band"
      ? bandBounds({
          category: { low: quote.low, high: quote.high },
          stated: statedBand
            ? { slug: statedBand.slug, low: statedBand.low, high: statedBand.high }
            : null,
          statedSource: (bandSource as BandSource | null) ?? null,
        })
      : null;

  // Keep the triage context when filters are cleared — it is not a filter.
  const contextParams = new URLSearchParams();
  if (q) contextParams.set("q", q);
  if (urgency) contextParams.set("urgency", urgency);
  const clearHref = contextParams.toString()
    ? `/services/${category.slug}?${contextParams.toString()}`
    : `/services/${category.slug}`;

  // A new key remounts the Suspense boundary, so changing a filter shows the
  // skeletons again instead of freezing the old list until the new one lands.
  const listKey = JSON.stringify(listParams);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label={t("breadcrumb")} className="animate-rise">
        <ol className="flex items-center gap-1 text-caption text-muted-foreground">
          <li>
            {/* `inline-flex min-h-6` is the tap target — a breadcrumb line is 16px tall,
                under WCAG 2.2's 24x24 minimum, and it is not a link inside a sentence so
                the inline exception does not cover it. */}
            <Link
              href="/services"
              className="inline-flex min-h-6 min-w-6 items-center justify-center hover:text-foreground"
            >
              {t("eyebrow")}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="text-foreground">
            {copy.name}
          </li>
        </ol>
      </nav>

      <header className="animate-rise mt-4" style={{ animationDelay: "60ms" }}>
        <h1 className="text-balance font-display text-display-md">
          {copy.name}
        </h1>

        {q || urgency ? (
          // What they told us, said back to them.
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-body-sm">
            <Sparkles aria-hidden="true" className="size-4 text-gold-ink" />
            <span>
              {t("showingFor", {
                category: copy.ctaLabel,
                where: area
                  ? t("inArea", { area: areaShortLabel(areaRows, area, locale) })
                  : t("nearYou"),
              })}
            </span>
            {urgency ? (
              <Badge variant={urgency === "emergency" ? "urgent" : "info"}>
                {t.has(`urgency.${urgency}`)
                  ? t(`urgency.${urgency}`)
                  : urgency}
              </Badge>
            ) : null}
            {q ? (
              <span className="text-muted-foreground">
                &ldquo;{q.slice(0, 80)}&rdquo;
              </span>
            ) : null}
          </p>
        ) : (
          <p className="mt-3 text-pretty text-body-md text-muted-foreground">
            {copy.description}
          </p>
        )}

        {quote.kind === "survey" ? (
          /*
             NO RANGE, AND A REASON RATHER THAN AN APOLOGY. "Priced after a
             free survey" on its own reads as a product that will not say; the
             second line says why nobody in this trade says, which is the
             honest and more reassuring version.
           */
          <p className="mt-3 text-body-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {t("surveyPriced")}
            </span>{" "}
            · {t("surveyPricedBody")}
          </p>
        ) : quote.kind === "unreadable" || bounds === null ? (
          /*
             AND A THIRD SENTENCE, because the other two are both promises about
             the TRADE and this is a fact about us. Printing the survey line here
             would tell somebody plumbing is quoted after a visit, which is false
             and sends them looking for a surveyor; printing a range would be the
             seed's figure, which `/admin/bands` may have moved months ago.
           */
          <p className="mt-3 text-body-sm text-muted-foreground">
            {t("priceAtBooking")}
          </p>
        ) : (
          <p className="mt-3 text-body-sm text-muted-foreground">
            {t("typicalRangeLabel")}{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {formatNpr(bounds.low, { locale })} –{" "}
              {formatNpr(bounds.high, { locale })}
            </span>{" "}
            · {t("priceConfirmedAfter")}
          </p>
        )}
      </header>

      <div className="animate-rise mt-6" style={{ animationDelay: "120ms" }}>
        {/* The rate filter still spans the trade. Narrowing it to the product
            would hide professionals whose dashboard rate sits below the band
            they are perfectly able to work in, which is a different question
            from what this job costs. */}
        {/*
          THE RATE FILTER NEEDS A BAND TO SPAN, so an unreadable one renders no
          filter rather than one bounded by the seed. A slider whose ends are
          wrong silently excludes professionals, which is the `/services` rule
          again: a failed read must not look like a measured answer.
        */}
        {quote.kind === "band" ? (
          <ProviderFilters
            priceBand={{ low: quote.low, high: quote.high }}
            /* The filter offers LIVE wards: filtering for a ward we withdrew
               would quietly search for coverage we no longer have. Labelling
               elsewhere on this page uses `areaRows`, which includes retired
               ones — two reads, two questions. */
            areas={areasByCity(bookable ?? [], locale)}
          />
        ) : null}
      </div>

      <Suspense key={listKey} fallback={<ProviderListSkeleton />}>
        <ProviderList
          params={listParams}
          clearHref={clearHref}
          debug={dataDebugEnabled(searchParams)}
        />
      </Suspense>
    </div>
  );
}
