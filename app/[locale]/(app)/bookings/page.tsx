import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return {
    title: t("bookingsTitle"),
    // Nothing here is useful to a search engine and some of it is personal.
    robots: { index: false, follow: false },
  };
}

/**
 * PLACEHOLDER — there are no bookings to list until Phase 6 builds the booking
 * flow and the `bookings` table. This page exists now because the account menu
 * links to it and a 404 from your own menu reads as a broken product.
 *
 * Phase 6 replaces the empty state with the real list; the empty state itself
 * stays, because a new customer will always land on it first.
 */
export default async function BookingsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.bookings");

  // The middleware already guards this route. Repeated here because a page
  // that reads a session should not depend on something else having checked.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Fbookings", locale });
  }

  const firstName = profile.fullName?.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          {firstName ? t("leadNamed", { name: firstName }) : t("lead")}
        </p>
      </header>

      <div className="animate-rise mt-8" style={{ animationDelay: "60ms" }}>
        <EmptyState
          icon={CalendarDays}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            <Button variant="gold" size="lg" asChild className="btn-tactile">
              <Link href="/#services">{t("browse")}</Link>
            </Button>
          }
        />
      </div>

      <p
        className="animate-rise mt-6 text-center text-caption text-muted-foreground"
        style={{ animationDelay: "120ms" }}
      >
        {t.rich("phoneNote", {
          phone: (chunks) => (
            <a
              href="tel:+9779800000000"
              className="text-foreground underline underline-offset-2"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    </div>
  );
}
