import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getCategory } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { getSessionProfile } from "@/lib/auth/session";
import { formatNpr } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Book a professional",
  robots: { index: false, follow: false },
};

/**
 * PLACEHOLDER — Phase 6 builds the booking flow here.
 *
 * It exists now because every "Book now" in the product points at it, and a
 * primary call to action that 404s is worse than one that says "not yet".
 *
 * It also proves the piece that is easy to get wrong and hard to notice: this
 * route is protected, so a logged-out customer goes through /login and comes
 * back *here*, with the professional and the urgency they picked still in the
 * URL — not to the homepage to start again.
 */
export default async function BookPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const categorySlug = first(searchParams.category);
  const providerId = first(searchParams.provider);
  const urgency = first(searchParams.urgency);
  const q = first(searchParams.q);

  const profile = await getSessionProfile();
  if (!profile) {
    const params = new URLSearchParams();
    if (categorySlug) params.set("category", categorySlug);
    if (providerId) params.set("provider", providerId);
    if (urgency) params.set("urgency", urgency);
    if (q) params.set("q", q);
    redirect(`/login?next=${encodeURIComponent(`/book?${params.toString()}`)}`);
  }

  const [category, provider] = await Promise.all([
    categorySlug ? getCategory(categorySlug) : Promise.resolve(null),
    providerId ? getProvider(providerId) : Promise.resolve(null),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">Book a professional</h1>
        <p className="mt-2 text-body-md text-muted-foreground">
          Dates, addresses and payment arrive in the next release. Everything
          you chose is held below — nothing has been lost.
        </p>
      </header>

      {category || provider ? (
        <Card
          className="animate-rise mt-6 p-5"
          style={{ animationDelay: "60ms" }}
        >
          <p className="text-overline uppercase text-muted-foreground">
            Your request
          </p>
          <dl className="mt-3 flex flex-col gap-3">
            {category ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">Service</dt>
                <dd className="text-right text-body-md font-semibold">
                  {category.nameEn}
                  <span className="ml-2 font-normal tabular-nums text-muted-foreground">
                    {formatNpr(category.basePriceMin)}–
                    {formatNpr(category.basePriceMax)}
                  </span>
                </dd>
              </div>
            ) : null}
            {provider ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">
                  Professional
                </dt>
                <dd className="text-right text-body-md font-semibold">
                  {provider.displayName}
                </dd>
              </div>
            ) : null}
            {urgency ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">Urgency</dt>
                <dd className="text-right">
                  <Badge variant={urgency === "emergency" ? "urgent" : "info"}>
                    {urgency}
                  </Badge>
                </dd>
              </div>
            ) : null}
            {q ? (
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-body-sm text-muted-foreground">
                  What you told us
                </dt>
                <dd className="text-right text-body-sm">
                  &ldquo;{q.slice(0, 120)}&rdquo;
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      <div className="animate-rise mt-6" style={{ animationDelay: "120ms" }}>
        <EmptyState
          icon={CalendarClock}
          title="Booking opens shortly"
          description="Until then we can take this over the phone — call and quote the professional's name, and we'll arrange the visit for you."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="gold" asChild className="btn-tactile">
                <a href="tel:+9779800000000">Call +977 9800 000 000</a>
              </Button>
              {category ? (
                <Button variant="outline" asChild>
                  <Link href={`/services/${category.slug}`}>
                    Back to {category.ctaLabel}
                  </Link>
                </Button>
              ) : null}
            </div>
          }
        />
      </div>
    </div>
  );
}
