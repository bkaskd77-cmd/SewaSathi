"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { areasByCity } from "@/lib/config/areas";
import { cn, formatNpr } from "@/lib/utils";

/**
 * Filters, kept in the URL.
 *
 * Everything here writes to the query string and nothing to component state,
 * so a filtered list is a link: shareable, bookmarkable, survives a refresh
 * and a back button, and the server renders exactly what the URL asks for.
 * That also means the list itself stays a Server Component — the only
 * JavaScript on this page is the twenty lines below.
 */

const AVAILABILITY_OPTIONS = [
  { value: "", label: "Any time" },
  { value: "now", label: "Available now" },
  { value: "today", label: "Today" },
];

const RATING_OPTIONS = [
  { value: "", label: "Any rating" },
  { value: "4", label: "4.0 and up" },
  { value: "4.5", label: "4.5 and up" },
  { value: "4.8", label: "4.8 and up" },
];

const SORT_OPTIONS = [
  { value: "", label: "Best match" },
  { value: "rating", label: "Highest rated" },
  { value: "price", label: "Lowest price" },
  { value: "jobs", label: "Most jobs done" },
];

const selectClass =
  "h-10 w-full rounded-lg border border-input bg-card px-3 text-body-sm transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function ProviderFilters({
  priceBand,
}: {
  /** The category's published band — the price tiers are cut from it. */
  priceBand: { low: number; high: number };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Two tiers cut from the category's own band, so "under Rs 2,000" means
  // something for plumbing and something else for painting.
  const tiers = React.useMemo(() => {
    const span = priceBand.high - priceBand.low;
    const round = (n: number) => Math.round(n / 100) * 100;
    return [
      round(priceBand.low + span * 0.25),
      round(priceBand.low + span * 0.6),
    ];
  }, [priceBand]);

  const set = React.useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) params.set(key, value);
      else params.delete(key);
      const query = params.toString();
      // `scroll: false` — changing a filter should not throw you back to the
      // top of a list you were halfway down.
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const value = (key: string) => searchParams.get(key) ?? "";

  // `q` and `urgency` come from triage and are context, not filters — clearing
  // the filters must not lose what the person originally said.
  const activeCount = ["area", "availability", "verified", "rating", "maxRate"]
    .map((key) => (searchParams.get(key) ? 1 : 0))
    .reduce((a: number, b: number) => a + b, 0);

  const clear = () => {
    const params = new URLSearchParams(searchParams.toString());
    for (const key of [
      "area",
      "availability",
      "verified",
      "rating",
      "maxRate",
    ]) {
      params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };

  return (
    <section
      aria-label="Filter professionals"
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-body-sm font-semibold">
          <SlidersHorizontal aria-hidden="true" className="size-4" />
          Filter
          {activeCount > 0 ? (
            <span className="rounded-full bg-primary px-2 py-0.5 text-caption font-semibold text-primary-foreground">
              {activeCount}
            </span>
          ) : null}
        </p>

        {/* The count lives with the list, inside Suspense — asking for it here
            would make the page await the query and the skeletons would never
            get a chance to show. */}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <label
            htmlFor="filter-area"
            className="text-overline uppercase text-muted-foreground"
          >
            Area
          </label>
          <select
            id="filter-area"
            className={cn(selectClass, "mt-1")}
            value={value("area")}
            onChange={(event) => set("area", event.target.value)}
          >
            <option value="">Anywhere in the Valley</option>
            {areasByCity().map((group) => (
              <optgroup key={group.city} label={group.city}>
                {group.areas.map((area) => (
                  <option key={area.key} value={area.key}>
                    {area.ward} — {area.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-availability"
            className="text-overline uppercase text-muted-foreground"
          >
            Availability
          </label>
          <select
            id="filter-availability"
            className={cn(selectClass, "mt-1")}
            value={value("availability")}
            onChange={(event) => set("availability", event.target.value)}
          >
            {AVAILABILITY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-rating"
            className="text-overline uppercase text-muted-foreground"
          >
            Rating
          </label>
          <select
            id="filter-rating"
            className={cn(selectClass, "mt-1")}
            value={value("rating")}
            onChange={(event) => set("rating", event.target.value)}
          >
            {RATING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-price"
            className="text-overline uppercase text-muted-foreground"
          >
            Starting price
          </label>
          <select
            id="filter-price"
            className={cn(selectClass, "mt-1")}
            value={value("maxRate")}
            onChange={(event) => set("maxRate", event.target.value)}
          >
            <option value="">Any price</option>
            {tiers.map((tier) => (
              <option key={tier} value={String(tier)}>
                Up to {formatNpr(tier)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="filter-sort"
            className="text-overline uppercase text-muted-foreground"
          >
            Sort by
          </label>
          <select
            id="filter-sort"
            className={cn(selectClass, "mt-1")}
            value={value("sort")}
            onChange={(event) => set("sort", event.target.value)}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-3">
          <label className="flex h-10 cursor-pointer items-center gap-2 text-body-sm">
            <input
              type="checkbox"
              checked={value("verified") === "1"}
              onChange={(event) =>
                set("verified", event.target.checked ? "1" : "")
              }
              className="size-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
            Verified only
          </label>

          {activeCount > 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <X aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
