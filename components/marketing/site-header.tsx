"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Menu, X } from "lucide-react";

import { AccountMenu, SignedOutCta } from "@/components/marketing/account-menu";
import { LanguageToggle } from "@/components/marketing/language-toggle";
import { Wordmark } from "@/components/marketing/wordmark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { Link, usePathname } from "@/i18n/navigation";
import { useBeforePaint } from "@/lib/hooks/use-before-paint";
import { cn } from "@/lib/utils";

/**
 * The in-page anchors — every one of which is a section on the landing page.
 *
 * A bare "#services" only works if you are already on `/`. On /services and
 * /login the same markup rendered a link that did nothing at all, which is
 * what `AnchorLink` below exists to stop.
 */
const NAV = [
  { hash: "#services", key: "services" },
  { hash: "#how-it-works", key: "howItWorks" },
  { hash: "#for-professionals", key: "forProfessionals" },
] as const;

/**
 * A link to a section of the landing page, from anywhere.
 *
 * On `/` it stays a plain fragment, so it scrolls without a navigation and
 * without touching the router. Anywhere else it becomes a real link to the
 * landing page's anchor — locale-aware, so a Nepali reader lands on /ne, not
 * on the English homepage.
 */
function AnchorLink({
  hash,
  className,
  onClick,
  children,
}: {
  hash: string;
  className?: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const onLanding = pathname === "/";

  if (onLanding) {
    return (
      <a href={hash} className={className} onClick={onClick}>
        {children}
      </a>
    );
  }

  return (
    <Link href={`/${hash}`} className={className} onClick={onClick}>
      {children}
    </Link>
  );
}

/**
 * `accountName` comes from the server (see lib/auth/session.ts) so the correct
 * header renders in the first HTML — a client-side session check would flash
 * "Book a service" at someone who is already signed in.
 *
 * The locale is no longer a prop: it is in the URL, and `useTranslations`
 * reads it from the provider. One fewer thing every layout has to remember to
 * pass down correctly.
 */
export function SiteHeader({
  accountName,
  worksHere = false,
}: {
  accountName?: string | null;
  /** Read from `profiles.role` by the layout. Adds the door to the work side. */
  worksHere?: boolean;
}) {
  const t = useTranslations("nav");
  const signedIn = accountName !== null && accountName !== undefined;
  const [condensed, setCondensed] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const pathname = usePathname();

  /*
   * WHY THE HEADER USED TO BLINK ON A NAVIGATION.
   *
   * The header lives in the layout, so it survives a route change while its
   * `condensed` state does not get a chance to be right: you navigate away
   * while scrolled down (condensed, with a background), the new page paints
   * with that background still applied, and only afterwards does the scroll
   * reset to the top and flip it back to transparent — animated over 200ms,
   * because the transition that makes scrolling feel smooth also animates this
   * correction. The result is a visible flash of the bar appearing and
   * vanishing on a page you have only just opened.
   *
   * So the state is snapped to the real scroll position BEFORE the browser
   * paints — a layout effect, not an ordinary one — and the transition is
   * suppressed for that one frame. Scrolling still animates; being corrected
   * after a navigation does not, because that is not a change the reader did
   * and animating it only draws the eye to a mistake.
   */
  const [transitions, setTransitions] = React.useState(false);

  useBeforePaint(() => {
    setTransitions(false);
    setCondensed(window.scrollY > 16);
    const frame = requestAnimationFrame(() => setTransitions(true));
    return () => cancelAnimationFrame(frame);
  }, [pathname]);

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
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full",
        transitions &&
          "transition-[background-color,box-shadow,border-color] duration-200",
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
            <AnchorLink
              key={item.hash}
              hash={item.hash}
              className="rounded-sm text-body-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              {t(item.key)}
            </AnchorLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <LanguageToggle />
          </div>
          <ThemeToggle />
          <div className="hidden sm:block">
            {signedIn ? (
              <AccountMenu name={accountName} worksHere={worksHere} />
            ) : (
              <SignedOutCta />
            )}
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
              <AnchorLink
                key={item.hash}
                hash={item.hash}
                onClick={() => setMenuOpen(false)}
                className="py-2.5 text-body-md font-medium hover:text-primary"
              >
                {t(item.key)}
              </AnchorLink>
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
                  <AccountMenu name={accountName} worksHere={worksHere} />
                </div>
              ) : (
                // Just the primary action here — "Sign in" is already a row in
                // the menu above, and repeating it reads as two different doors.
                <Button
                  variant="gold"
                  asChild
                  className="btn-tactile btn-beacon flex-1"
                >
                  <Link href="/services" onClick={() => setMenuOpen(false)}>
                    {t("bookService")}
                  </Link>
                </Button>
              )}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
