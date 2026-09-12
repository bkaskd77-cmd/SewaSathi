"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ClipboardList, LogOut, Store } from "lucide-react";

import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { Link, usePathname } from "@/i18n/navigation";
import { stripLocale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

/**
 * The professional's own chrome, and why it is not the customer's.
 *
 * THE TWO HALVES OF THIS PRODUCT ARE DIFFERENT JOBS DONE BY DIFFERENT PEOPLE,
 * and for a while they wore the same clothes. The signed-in layout carried one
 * comment — "same header and footer as the landing page, so signing in does
 * not drop you into a different-looking product" — which is exactly right for
 * a customer, who is still shopping after they sign in, and was never checked
 * against a professional, who is not. Somebody who is both had no way to tell
 * from a glance which side of the product they were looking at.
 *
 * WHAT ACTUALLY DIFFERS, and each one is a consequence of the work rather
 * than decoration:
 *
 *   * A DARK GROUND. A tradesperson opens this several times a day, often
 *     outdoors on a bright phone, and it has to be identifiable in the second
 *     before it is read.
 *   * NO MARKETING FOOTER, no "Book a service", no catalogue links. Nothing
 *     here is trying to sell them anything; they are the supply side.
 *   * TWO TABS AND NOTHING ELSE — the work, and the listing. A working screen
 *     with six destinations is a screen somebody has to read before acting.
 *   * THE WORDMARK GOES TO THE PUBLIC SITE, as a wordmark does everywhere
 *     else on the internet. It pointed at the jobs list for one version, on
 *     the theory that the home of a working surface is the work — which left
 *     a professional with no route to the homepage at all, because the tabs
 *     are work and there was nothing else. The tabs are the work navigation;
 *     the wordmark is the way out.
 *
 * THERE IS NO "MY BOOKINGS" LINK, and its removal is the point rather than a
 * simplification. A professional reading "my bookings" on a working screen
 * reads it as the jobs they have been given, which is what the Jobs tab is —
 * two labels for what looks like one thing, and the wrong one leads somewhere
 * that will be empty for nearly everybody. Most professionals will never book
 * a service from us. How somebody who does crosses over is an open question
 * (possibly a separate number), and a confusing link is not a placeholder for
 * an answer.
 */
export function WorkHeader({ name }: { name: string }) {
  const t = useTranslations("provider.chrome");
  const pathname = stripLocale(usePathname());

  const tabs = [
    { href: "/provider/jobs", label: t("jobs"), icon: ClipboardList },
    { href: "/provider", label: t("listing"), icon: Store },
  ];

  return (
    <header className="bg-work text-work-foreground">
      <div className="container flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
        <Link
          href="/"
          aria-label={t("home")}
          className="flex items-center gap-2 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-work-foreground/70"
        >
          <span className="font-display text-body-md font-bold tracking-tight">
            {t("wordmark")}
          </span>
          {/* The word that settles which product this is, next to the name
              rather than buried in a menu. */}
          <span className="rounded-full border border-work-muted/40 px-2 py-0.5 text-caption font-medium text-work-muted">
            {t("badge")}
          </span>
        </Link>

        <nav aria-label={t("navLabel")} className="ml-auto flex items-center gap-1">
          {tabs.map((tab) => {
            // Exact match, not a prefix: /provider/jobs sits underneath
            // /provider, and a prefix would light both tabs at once.
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-3 py-2 text-body-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-work-foreground/70",
                  active
                    ? "bg-work-foreground/15 font-semibold text-work-foreground"
                    : "text-work-muted hover:bg-work-foreground/10 hover:text-work-foreground",
                )}
              >
                <tab.icon aria-hidden="true" className="size-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* The second row carries who you are and the way out. Separated from the
          tabs so the thing pressed all day is never beside sign-out. */}
      <div className="border-t border-work-foreground/15">
        <div className="container flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
          <p className="text-caption text-work-muted">
            {t("workingAs", { name })}
          </p>

          <div className="ml-auto flex items-center gap-1">
            <form action={signOutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-caption text-work-muted transition-colors hover:text-work-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-work-foreground/70"
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
