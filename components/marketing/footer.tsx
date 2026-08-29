import { useLocale, useTranslations } from "next-intl";

import { Wordmark } from "@/components/marketing/wordmark";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import { site } from "@/lib/config/site";

/**
 * `soon` marks a page that has not shipped yet.
 *
 * The link stays — the footer is the site map and these are real destinations —
 * but Next must not prefetch it, or every page carrying the footer fires a
 * dozen 404s into the console before anyone clicks anything. Delete the flag
 * in the phase that adds the page.
 *
 * Labels are keys into the `footer` namespace rather than strings, so the same
 * structure renders in both languages and a new locale is a catalogue file
 * rather than a second copy of this array.
 */
const COLUMNS = [
  {
    heading: "company",
    links: [
      { key: "about", href: "/about", soon: true },
      { key: "careers", href: "/careers", soon: true },
      { key: "contact", href: "/contact", soon: true },
    ],
  },
  {
    heading: "support",
    links: [
      { key: "help", href: "/help", soon: true },
      { key: "trackBooking", href: "/bookings" },
      { key: "reportProblem", href: "/help/complaint", soon: true },
    ],
  },
  {
    heading: "legal",
    links: [
      { key: "terms", href: "/legal/terms", soon: true },
      { key: "privacy", href: "/legal/privacy", soon: true },
      { key: "refunds", href: "/legal/refunds", soon: true },
    ],
  },
] as const;

const linkClass =
  "rounded-sm text-body-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** The three highest-intent categories, named from the catalogue not here. */
const FOOTER_SERVICE_SLUGS = ["plumbing", "electrical", "home-cleaning"];

export function SiteFooter() {
  const t = useTranslations("footer");
  const locale = useLocale() as Locale;

  // Plain labels rather than brand logos — we use the real marks once eSewa
  // and Khalti have approved their usage. The first two are brand names and
  // stay as they are written in both languages.
  const payments = ["eSewa", "Khalti", t("cashOnCompletion")];

  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="container py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-3 text-pretty text-body-sm text-muted-foreground">
              {locale === "ne" ? site.taglineNe : site.tagline}
            </p>
          </div>

          {/*
            The services column is built from the category list rather than
            written out, so its labels are the same words the catalogue uses
            and a rename happens in one place.
          */}
          <div>
            <h3 className="text-overline uppercase">{t("services")}</h3>
            <ul className="mt-3 flex flex-col gap-2">
              {FOOTER_SERVICE_SLUGS.map((slug) => {
                const category = SERVICE_CATEGORIES.find(
                  (c) => c.slug === slug,
                );
                if (!category) return null;
                return (
                  <li key={slug}>
                    <Link href={`/services/${slug}`} className={linkClass}>
                      {categoryCopy(category, locale).name}
                    </Link>
                  </li>
                );
              })}
              <li>
                <Link href="/services" className={linkClass}>
                  {t("allServices")}
                </Link>
              </li>
            </ul>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h3 className="text-overline uppercase">{t(column.heading)}</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      prefetch={"soon" in link ? false : undefined}
                      className={linkClass}
                    >
                      {t(link.key)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-muted-foreground">
              {t("payWith")}
            </span>
            {payments.map((method) => (
              <span
                key={method}
                className="rounded-md border border-border bg-card px-2.5 py-1 text-caption font-medium"
              >
                {method}
              </span>
            ))}
          </div>
          <p className="text-caption text-muted-foreground">
            {t("copyright", {
              // A plain string, so the year is not rendered in Devanagari
              // digits on /ne while every price on the page is Latin.
              year: String(new Date().getFullYear()),
              name: site.name,
            })}
          </p>
        </div>
      </div>
    </footer>
  );
}
