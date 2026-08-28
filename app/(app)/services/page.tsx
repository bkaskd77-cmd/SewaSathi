import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { categoryIcon } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { getCategoryCounts } from "@/lib/data/providers";
import { getLocale } from "@/lib/i18n/server";
import { formatNpr } from "@/lib/utils";

export const metadata: Metadata = {
  title: "All services",
  description:
    "Plumbers, electricians, cleaners and more across Kathmandu, Lalitpur and Bhaktapur — with published price bands and verified professionals.",
};

/**
 * The catalogue.
 *
 * Reads the `categories` table, so the prices here are the same numbers the
 * landing page quotes and the same ones Claude is given for triage. The
 * provider count is the honest bit: a category with three professionals says
 * three, because "we have everything" is exactly the claim this market has
 * heard too many times.
 */
export default async function ServicesPage() {
  const [categories, counts, locale] = await Promise.all([
    getCategories(),
    getCategoryCounts(),
    Promise.resolve(getLocale()),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <header className="animate-rise max-w-2xl">
        <p className="text-overline uppercase text-gold-ink">Services</p>
        <h1 className="mt-2 text-balance font-display text-display-md">
          Everything we send someone for
        </h1>
        <p className="mt-3 text-pretty text-body-md text-muted-foreground">
          Ten trades across Kathmandu, Lalitpur and Bhaktapur. Every price below
          is the band our professionals actually quote inside — the exact figure
          comes after they have seen the job.
        </p>
      </header>

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category, index) => {
          const Icon = categoryIcon(category.icon);
          const count = counts[category.slug] ?? 0;

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
                    {locale === "ne" ? (
                      <span lang="ne">{category.nameNe}</span>
                    ) : (
                      category.nameEn
                    )}
                  </h2>
                  <p className="mt-1.5 flex-1 text-pretty text-body-sm text-muted-foreground">
                    {category.description}
                  </p>

                  <p className="mt-4 font-display text-body-md font-bold tabular-nums">
                    {formatNpr(category.basePriceMin)} –{" "}
                    {formatNpr(category.basePriceMax)}
                  </p>

                  <p className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
                    {count > 0
                      ? `${count} ${count === 1 ? "professional" : "professionals"} available`
                      : "Coming to your area soon"}
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
    </div>
  );
}
