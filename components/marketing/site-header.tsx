"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

import { LanguageToggle } from "@/components/marketing/language-toggle";
import { Wordmark } from "@/components/marketing/wordmark";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "#services", label: "Services" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#for-professionals", label: "For Professionals" },
];

export function SiteHeader() {
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
          aria-label="Main"
          className="ml-6 hidden items-center gap-6 lg:flex"
        >
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-sm text-body-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden sm:block">
            <LanguageToggle />
          </div>
          <ThemeToggle />
          <Button variant="gold" asChild className="hidden sm:inline-flex">
            <Link href="#hero-search">Book a service</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
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
          <nav aria-label="Mobile" className="container flex flex-col py-3">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="py-2.5 text-body-md font-medium hover:text-primary"
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex items-center gap-3 sm:hidden">
              <LanguageToggle />
              <Button variant="gold" asChild className="flex-1">
                <Link href="#hero-search" onClick={() => setMenuOpen(false)}>
                  Book a service
                </Link>
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
