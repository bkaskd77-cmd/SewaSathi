"use client";

import * as React from "react";
import Link from "next/link";
import { CalendarDays, LogOut, User } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Signed-in replacement for the "Book a service" button.
 *
 * Deliberately not a Radix dropdown — this is four links, and the menu is the
 * only thing on the page that would pull in another primitive.
 */
export function AccountMenu({ name }: { name: string }) {
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const initial = name.trim().charAt(0).toUpperCase() || "?";
  const firstName = name.trim().split(/\s+/)[0] || "Account";

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1 pr-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-primary font-display text-body-sm font-bold text-primary-foreground"
        >
          {initial}
        </span>
        <span className="max-w-[7rem] truncate text-body-sm font-semibold">
          {firstName}
        </span>
      </button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "animate-rise absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-popover shadow-lg",
          )}
        >
          <Link
            role="menuitem"
            href="/bookings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-body-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <CalendarDays aria-hidden="true" className="size-4" />
            Bookings
          </Link>
          <Link
            role="menuitem"
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-3 text-body-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <User aria-hidden="true" className="size-4" />
            Account
          </Link>
          <form action={signOutAction}>
            <button
              role="menuitem"
              type="submit"
              className="flex w-full items-center gap-2.5 border-t border-border px-4 py-3 text-left text-body-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <LogOut aria-hidden="true" className="size-4" />
              Log out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Logged-out state.
 *
 * "Book a service" stays the primary action — most first-time visitors want to
 * describe a problem, not create an account. But sign-in needs its own visible
 * door: /login existed with nothing linking to it, so the only way in was to
 * type the URL.
 */
export function SignedOutCta({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button variant="ghost" asChild>
        <Link href="/login">Sign in</Link>
      </Button>
      <Button variant="gold" asChild className="btn-tactile">
        <Link href="#hero-search">Book a service</Link>
      </Button>
    </div>
  );
}
