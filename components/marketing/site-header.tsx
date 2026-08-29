"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";

import { AccountMenu, SignedOutCta } from "@/components/marketing/account-menu";
import { LanguageToggle } from "@/components/marketing/language-toggle";
import { Wordmark } from "@/components/marketing/wordmark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * The in-page anchors. Hrefs are fragments, so they need no locale prefix and
 * no `Link` from the routing helpers — but they still resolve against whatever
 * page the header is on, which is why they are relative fragments and not
 * "/#services".
 */
const NAV = [
  { href: "#services", key: "services" },
  { href: "#how-it-works", key: "howItWorks" },
  { href: "#for-professionals", key: "forProfessionals" },
] as const;

/**
 * `accountName` comes from the server (see lib/auth/session.ts) so the correct
 * header renders in the first HTML — a client-side session check would flash
 * "Book a service" at someone who is already signed in.
 *
 * The locale is no longer a prop: it is in the URL, and `useTranslations`
 * reads it from the provider. One fewer thing every layout has to remember to
 * pass down correctly.
 */
export function SiteHeader({ accountName }: { accountName?: string | null }) {
  const t = useTranslations("nav");
  const signedIn = accountName !== null && accountName !== undefined;
  const [condensed, setCondensed] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    // rAF-throttled so scrolling stays cheap on the low-end Androids that
    // make up most of the traffic here.
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setCondensed(window.scrollY > 16);
        ticking = false;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full transition-[background-color,box-shadow,border-color] duration-200",
        condensed
          ? "border-b border-border bg-background/85 shadow-sm backdrop-blur-md"
          : "border-b border-transparent bg-transparent",
      )}
    >
      <div
        className={cn(
          "container flex items-center gap-4 transition-[height] duration-200",
          condensed ? "h-14" : "h-18",
        )}
      >
        <Wordmark className={cn(condensed && "text-xl")} />

        <nav
          aria-label={t("main")}
          className="ml-6 hidden items-center gap-6 lg:flex"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-sm text-body-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              {t(item.key)}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <LanguageToggle />
          </div>
          <ThemeToggle />
          <div className="hidden sm:block">
            {signedIn ? <AccountMenu name={accountName} /> : <SignedOutCta />}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? t("closeMenu") : t("openMenu")}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {menuOpen ? (
        <div
          id="mobile-nav"
          className="border-t border-border bg-background lg:hidden"
        >
          <nav
            aria-label={t("mobile")}
            className="container flex flex-col py-3"
          >
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="py-2.5 text-body-md font-medium hover:text-primary"
              >
                {t(item.key)}
              </a>
            ))}
            {signedIn ? (
              <>
                <Link
                  href="/bookings"
                  onClick={() => setMenuOpen(false)}
                  className="py-2.5 text-body-md font-medium hover:text-primary"
                >
                  {t("bookings")}
                </Link>
                <Link
                  href="/account"
                  onClick={() => setMenuOpen(false)}
                  className="py-2.5 text-body-md font-medium hover:text-primary"
                >
                  {t("account")}
                </Link>
              </>
            ) : (
              <Link
                href="/login"
                onClick={() => setMenuOpen(false)}
                className="py-2.5 text-body-md font-medium hover:text-primary"
              >
                {t("signIn")}
              </Link>
            )}

            <div className="mt-3 flex items-center gap-3 sm:hidden">
              <LanguageToggle />
              {signedIn ? (
                <div className="flex-1">
                  <AccountMenu name={accountName} />
                </div>
              ) : (
                // Just the primary action here — "Sign in" is already a row in
                // the menu above, and repeating it reads as two different doors.
                <Button variant="gold" asChild className="btn-tactile flex-1">
                  <a href="#hero-search" onClick={() => setMenuOpen(false)}>
                    {t("bookService")}
                  </a>
                </Button>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
