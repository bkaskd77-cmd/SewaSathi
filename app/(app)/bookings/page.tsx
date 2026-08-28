import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { getSessionProfile } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Your bookings",
  // Nothing here is useful to a search engine and some of it is personal.
  robots: { index: false, follow: false },
};

/**
 * PLACEHOLDER — there are no bookings to list until Phase 6 builds the booking
 * flow and the `bookings` table. This page exists now because the account menu
 * links to it and a 404 from your own menu reads as a broken product.
 *
 * Phase 6 replaces the empty state with the real list; the empty state itself
 * stays, because a new customer will always land on it first.
 */
export default async function BookingsPage() {
  // The middleware already guards this route. Repeated here because a page
  // that reads a session should not depend on something else having checked.
  const profile = await getSessionProfile();
  if (!profile) redirect("/login?next=%2Fbookings");

  const firstName = profile.fullName?.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">Your bookings</h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          {firstName
            ? `Everything you book, ${firstName}, in one place — upcoming first, then past jobs.`
            : "Everything you book in one place — upcoming first, then past jobs."}
        </p>
      </header>

      <div className="animate-rise mt-8" style={{ animationDelay: "60ms" }}>
        <EmptyState
          icon={CalendarDays}
          title="No bookings yet"
          description="Once you book a professional, the job shows up here with its time, status and agreed price — and you can call them from it."
          action={
            <Button variant="gold" size="lg" asChild className="btn-tactile">
              <Link href="/#services">Browse services</Link>
            </Button>
          }
        />
      </div>

      <p
        className="animate-rise mt-6 text-center text-caption text-muted-foreground"
        style={{ animationDelay: "120ms" }}
      >
        Booked over the phone? Call{" "}
        <a
          href="tel:+9779800000000"
          className="text-foreground underline underline-offset-2"
        >
          +977 9800 000 000
        </a>{" "}
        and we&rsquo;ll add it to your account.
      </p>
    </div>
  );
}
