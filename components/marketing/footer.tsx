import Link from "next/link";

import { Wordmark } from "@/components/marketing/wordmark";
import { site } from "@/lib/config/site";

/**
 * `soon` marks a page that has not shipped yet.
 *
 * The link stays — the footer is the site map and these are real destinations —
 * but Next must not prefetch it, or every page carrying the footer fires a
 * dozen 404s into the console before anyone clicks anything. Delete the flag
 * in the phase that adds the page.
 */
const COLUMNS = [
  {
    heading: "Company",
    links: [
      { label: "About us", href: "/about", soon: true },
      { label: "Careers", href: "/careers", soon: true },
      { label: "Contact", href: "/contact", soon: true },
    ],
  },
  {
    heading: "Services",
    links: [
      { label: "Plumbing", href: "/services/plumbing" },
      { label: "Electrical", href: "/services/electrical" },
      { label: "Home cleaning", href: "/services/home-cleaning" },
      { label: "All services", href: "/services" },
    ],
  },
  {
    heading: "Support",
    links: [
      { label: "Help centre", href: "/help", soon: true },
      { label: "Track a booking", href: "/bookings" },
      { label: "Report a problem", href: "/help/complaint", soon: true },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms of service", href: "/legal/terms", soon: true },
      { label: "Privacy policy", href: "/legal/privacy", soon: true },
      { label: "Refund policy", href: "/legal/refunds", soon: true },
    ],
  },
];

// Plain labels rather than brand logos — we use the real marks once eSewa and
// Khalti have approved their usage.
const PAYMENTS = ["eSewa", "Khalti", "Cash on completion"];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="container py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Wordmark />
            <p className="mt-3 text-pretty text-body-sm text-muted-foreground">
              {site.tagline}
            </p>
            <p className="mt-1 text-body-sm text-muted-foreground" lang="ne">
              {site.taglineNe}
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <h3 className="text-overline uppercase">{column.heading}</h3>
              <ul className="mt-3 flex flex-col gap-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      prefetch={"soon" in link ? false : undefined}
                      className="rounded-sm text-body-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-caption text-muted-foreground">Pay with</span>
            {PAYMENTS.map((method) => (
              <span
                key={method}
                className="rounded-md border border-border bg-card px-2.5 py-1 text-caption font-medium"
              >
                {method}
              </span>
            ))}
          </div>
          <p className="text-caption text-muted-foreground">
            © {new Date().getFullYear()} {site.name}. Kathmandu, Nepal.
          </p>
        </div>
      </div>
    </footer>
  );
}
