import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarDays, ChevronRight } from "lucide-react";

import { StatusBadge } from "@/components/booking/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { categoryCopy } from "@/lib/config/services";
import { listBookings } from "@/lib/data/bookings";
import { getCategories } from "@/lib/data/categories";
import { unreadByBooking } from "@/lib/data/notifications";
import { formatNpr } from "@/lib/utils";

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

export const dynamic = "force-dynamic";

/**
 * Everything this customer has booked.
 *
 * The empty state stays, because a new customer always lands on it first — it
 * is the common case on day one, not an error path.
 */
export default async function BookingsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.bookings");
  const tNote = await getTranslations("booking");

  // The middleware already guards this route. Repeated here because a page
  // that reads a session should not depend on something else having checked.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Fbookings", locale });
  }

  const [bookings, categories, unread] = await Promise.all([
    listBookings(),
    getCategories(),
    unreadByBooking(),
  ]);

  const categoryName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };

  const firstName = profile.fullName?.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          {firstName ? t("leadNamed", { name: firstName }) : t("lead")}
        </p>
      </header>

      {bookings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            delay={0.06}
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
      ) : (
        <ul className="assemble mt-8 flex flex-col gap-3">
          {bookings.map((booking, i) => (
            <li key={booking.id} style={{ ["--i" as string]: i }}>
              <Link
                href={`/bookings/${booking.id}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all duration-200 hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-md font-semibold">
                      {categoryName(booking.categorySlug)}
                    </span>
                    <StatusBadge status={booking.status} />
                    {/* Something happened here since this person last looked.
                        The live page only helps someone who is looking at it;
                        this is for everyone who closed the tab. */}
                    {unread.has(booking.id) ? (
                      <span className="animate-pop-in inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-caption font-semibold text-primary">
                        <span
                          aria-hidden="true"
                          className="size-1.5 rounded-full bg-primary"
                        />
                        {tNote(`notifications.${unread.get(booking.id)!.kind}`)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-body-sm text-muted-foreground">
                    {booking.description}
                  </p>
                  <p className="mt-1 text-caption tabular-nums text-muted-foreground">
                    {booking.reference} ·{" "}
                    {booking.finalAmount !== null
                      ? formatNpr(booking.finalAmount, { locale })
                      : `${formatNpr(booking.quotedMin, { locale })}–${formatNpr(booking.quotedMax, { locale })}`}
                  </p>
                </div>
                <ChevronRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

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
