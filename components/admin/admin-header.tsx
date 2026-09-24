"use client";

import { useTranslations } from "next-intl";
import {
  BadgeCheck,
  Banknote,
  LogOut,
  Scale,
  ShieldCheck,
  UserX,
  Wallet,
} from "lucide-react";

import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { Link, usePathname } from "@/i18n/navigation";
import { stripLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * The admin's own chrome, and why it is neither the customer's nor the
 * professional's.
 *
 * THERE ARE THREE JOBS IN THIS PRODUCT AND THEY NOW WEAR THREE SETS OF
 * CLOTHES. `(app)` is ivory, for somebody shopping. `(work)` is emerald, for
 * somebody working. This is slate, for somebody deciding — and the ground
 * colour is the first thing that says which, before a word is read. Reusing
 * the emerald would have made the two internal surfaces look like each other,
 * which is the same blur the work group was split out to remove.
 *
 * WHAT WAS WRONG BEFORE. The admin queues sat inside `(app)` and inherited the
 * customer frame: a "Book a service" button, the catalogue footer, and an
 * account menu offering Bookings and nothing else. Opening `/admin` showed the
 * customer product with a different page in the middle, and the person holding
 * the most dangerous permissions in the product had no way to tell which half
 * they were in.
 *
 * SIX DESTINATIONS, WHICH IS MORE THAN THE WORK HEADER ALLOWS ITSELF, and the
 * difference is the job. A professional between two jobs needs two tabs and no
 * reading. Working queues IS the admin's job, so the queues are the navigation;
 * hiding them behind an index would add a click to every crossing.
 *
 * NO COUNTS IN THE NAV, deliberately. `adminQueueCounts` is six `head: true`
 * queries, and putting them here would run all six on every admin page view to
 * decorate a link the person is already looking at. The index shows them, one
 * click away, and that is where the question "does anything need me" belongs.
 *
 * THE WORDMARK GOES TO THE PUBLIC SITE, the same rule the work header settled:
 * the tabs are the work, and the wordmark is the way out. Without it an admin
 * has no route back to the product they are administering.
 */
export function AdminHeader({ name }: { name: string }) {
  const t = useTranslations("admin.chrome");
  const pathname = stripLocale(usePathname());

  const tabs = [
    { href: "/admin/applications", label: t("applications"), icon: BadgeCheck },
    { href: "/admin/claims", label: t("claims"), icon: UserX },
    {
      href: "/admin/guarantee-claims",
      label: t("guaranteeClaims"),
      icon: ShieldCheck,
    },
    { href: "/admin/survey-fees", label: t("surveyFees"), icon: Wallet },
    { href: "/admin/appeals", label: t("appeals"), icon: Scale },
  ];

  return (
    <header className="bg-admin text-admin-foreground">
      <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <Link
          href="/"
          aria-label={t("home")}
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-foreground/70"
        >
          <span className="font-display text-body-md font-bold tracking-tight">
            {t("wordmark")}
          </span>
          {/* The word that settles which of the three surfaces this is. */}
          <span className="rounded-full border border-admin-muted/40 px-2 py-0.5 text-caption font-medium text-admin-muted">
            {t("badge")}
          </span>
        </Link>

        <nav
          aria-label={t("navLabel")}
          className="ml-auto flex flex-wrap items-center gap-1"
        >
          {/* The index is the wordmark's neighbour rather than a sixth tab:
              it answers "does anything need me", which is a different question
              from "take me to this queue". */}
          <Link
            href="/admin"
            aria-current={pathname === "/admin" ? "page" : undefined}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-3 py-2 text-body-sm transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-foreground/70",
              pathname === "/admin"
                ? "bg-admin-foreground/15 font-semibold text-admin-foreground"
                : "text-admin-muted hover:bg-admin-foreground/10 hover:text-admin-foreground",
            )}
          >
            <Banknote aria-hidden="true" className="size-4" />
            {t("overview")}
          </Link>

          {tabs.map((tab) => {
            /*
             * Prefix match here, unlike the work header's exact one, and the
             * reason is the shape of the routes: /admin/applications/[id] is
             * the same queue as /admin/applications, so an exact match would
             * unlight the tab the moment somebody opened one of its rows. No
             * two of these sit underneath each other, so a prefix cannot light
             * two at once the way /provider and /provider/jobs would.
             */
            const active =
              pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-body-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-foreground/70",
                  active
                    ? "bg-admin-foreground/15 font-semibold text-admin-foreground"
                    : "text-admin-muted hover:bg-admin-foreground/10 hover:text-admin-foreground",
                )}
              >
                <tab.icon aria-hidden="true" className="size-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Who you are and the way out, on their own row — so the thing pressed
          all day is never beside sign-out. Same rule as the work header. */}
      <div className="border-t border-admin-foreground/15">
        <div className="container flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
          <p className="text-caption text-admin-muted">
            {t("signedInAs", { name })}
          </p>

          <div className="ml-auto flex items-center gap-1">
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-caption text-admin-muted transition-colors hover:text-admin-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-foreground/70"
              >
                <LogOut aria-hidden="true" className="size-3.5" />
                {t("logOut")}
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
