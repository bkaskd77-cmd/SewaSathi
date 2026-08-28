import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BadgeCheck,
  ChevronRight,
  Clock,
  MapPin,
  ShieldCheck,
  Star,
} from "lucide-react";

import { ProviderAvatar } from "@/components/services/provider-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { areaLabel, findArea } from "@/lib/config/areas";
import { getCategories, getCategory } from "@/lib/data/categories";
import {
  getProvider,
  getProviderReviews,
  type VerificationCheck,
} from "@/lib/data/providers";
import { bookingHref } from "@/lib/routes/booking";
import { formatNpr } from "@/lib/utils";

/**
 * One professional, in full.
 *
 * The verification block is the reason this page exists. A single "verified"
 * badge tells a customer nothing about what was actually checked, and this is
 * the screen where they decide whether to let somebody into their house — so
 * the checks are listed one by one, and the ones that were not done are shown
 * as not done rather than left out.
 */

const CHECK_LABELS: Record<
  VerificationCheck,
  { label: string; detail: string }
> = {
  id: {
    label: "Government ID",
    detail: "Citizenship or licence seen in person and matched to their face.",
  },
  background: {
    label: "Background check",
    detail: "Police record check through our verification partner.",
  },
  skill: {
    label: "Skill assessment",
    detail: "Practical test in this trade, marked by a senior professional.",
  },
};

const ALL_CHECKS: VerificationCheck[] = ["id", "background", "skill"];

const AVAILABILITY_TEXT = {
  now: "Available now — usually accepts within the hour",
  today: "Available today",
  scheduled: "By appointment, usually within a few days",
};

export async function generateMetadata({
  params,
}: {
  params: { slug: string; providerId: string };
}): Promise<Metadata> {
  const provider = await getProvider(params.providerId);
  if (!provider) return { title: "Professional not found" };

  const category = await getCategory(params.slug);
  return {
    title: `${provider.displayName} — ${category?.nameEn ?? "Professional"}`,
    description: provider.bio.slice(0, 160),
  };
}

export default async function ProviderProfilePage({
  params,
  searchParams,
}: {
  params: { slug: string; providerId: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const [provider, category, categories] = await Promise.all([
    getProvider(params.providerId),
    getCategory(params.slug),
    getCategories(),
  ]);

  if (!provider || !category) notFound();

  const reviews = await getProviderReviews(provider.id);
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  const urgency = first(searchParams.urgency);
  const q = first(searchParams.q);

  const { stats } = provider;
  const specialisations = categories.filter((c) =>
    provider.categories.includes(c.slug),
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <nav aria-label="Breadcrumb" className="animate-rise">
        <ol className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
          <li>
            <Link href="/services" className="hover:text-foreground">
              Services
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li>
            <Link
              href={`/services/${category.slug}`}
              className="hover:text-foreground"
            >
              {category.nameEn}
            </Link>
          </li>
          <li aria-hidden="true">
            <ChevronRight className="size-3.5" />
          </li>
          <li aria-current="page" className="text-foreground">
            {provider.displayName}
          </li>
        </ol>
      </nav>

      <header
        className="animate-rise mt-4 flex flex-wrap items-start gap-5"
        style={{ animationDelay: "60ms" }}
      >
        <ProviderAvatar
          name={provider.displayName}
          photoUrl={provider.photoUrl}
          size={88}
        />

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-display-md">
            {provider.displayName}
          </h1>
          <p className="mt-1 text-body-md text-muted-foreground">
            {specialisations.map((c) => c.nameEn).join(" · ")} ·{" "}
            {provider.yearsExperience} years
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {provider.isVerified ? (
              <Badge variant="verified">
                <BadgeCheck aria-hidden="true" />
                Verified professional
              </Badge>
            ) : (
              <Badge variant="muted">Verification in progress</Badge>
            )}
            <Badge
              variant={provider.availability === "now" ? "urgent" : "info"}
            >
              <Clock aria-hidden="true" />
              {AVAILABILITY_TEXT[provider.availability]}
            </Badge>
          </div>
        </div>
      </header>

      <Card
        className="animate-rise mt-6 flex flex-wrap items-center justify-between gap-4 p-5"
        style={{ animationDelay: "120ms" }}
      >
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <div>
            <dt className="text-overline uppercase text-muted-foreground">
              Rating
            </dt>
            <dd className="mt-0.5 flex items-center gap-1 font-display text-lg font-semibold tabular-nums">
              <Star aria-hidden="true" className="size-4 fill-gold text-gold" />
              {stats.ratingAvg.toFixed(1)}
              <span className="text-caption font-normal text-muted-foreground">
                ({stats.ratingCount})
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-overline uppercase text-muted-foreground">
              Jobs done
            </dt>
            <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
              {stats.jobsCompleted}
            </dd>
          </div>
          <div>
            <dt className="text-overline uppercase text-muted-foreground">
              Completion
            </dt>
            <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
              {stats.completionRate}%
            </dd>
          </div>
          <div>
            <dt className="text-overline uppercase text-muted-foreground">
              Responds in
            </dt>
            <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums">
              ~{stats.avgResponseMinutes} min
            </dd>
          </div>
        </dl>

        <div className="text-right">
          <p className="font-display text-display-sm tabular-nums">
            {formatNpr(provider.baseRate)}
          </p>
          <p className="text-caption text-muted-foreground">starting rate</p>
        </div>
      </Card>

      <section
        className="animate-rise mt-6"
        style={{ animationDelay: "180ms" }}
        aria-labelledby="about-heading"
      >
        <h2 id="about-heading" className="font-display text-display-sm">
          About
        </h2>
        <p className="mt-2 text-pretty text-body-md text-muted-foreground">
          {provider.bio}
        </p>
      </section>

      <section
        className="animate-rise mt-8"
        style={{ animationDelay: "220ms" }}
        aria-labelledby="checks-heading"
      >
        <h2
          id="checks-heading"
          className="flex items-center gap-2 font-display text-display-sm"
        >
          <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
          What we checked
        </h2>

        <ul className="mt-3 flex flex-col gap-2">
          {ALL_CHECKS.map((check) => {
            const done = provider.checks.includes(check);
            const meta = CHECK_LABELS[check];

            return (
              <li
                key={check}
                className="flex items-start gap-3 rounded-lg border border-border p-3"
              >
                <span
                  aria-hidden="true"
                  className={
                    done
                      ? "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                      : "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border text-muted-foreground"
                  }
                >
                  {done ? <BadgeCheck className="size-3.5" /> : null}
                </span>
                <div>
                  <p className="text-body-sm font-semibold">
                    {meta.label}
                    {!done ? (
                      <span className="ml-2 font-normal text-muted-foreground">
                        not completed
                      </span>
                    ) : null}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {meta.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>

        {provider.idDocumentStatus === "pending" ? (
          <p className="mt-2 text-caption text-muted-foreground">
            Their documents are with our verification team now.
          </p>
        ) : null}
      </section>

      <section
        className="animate-rise mt-8"
        style={{ animationDelay: "260ms" }}
        aria-labelledby="areas-heading"
      >
        <h2
          id="areas-heading"
          className="flex items-center gap-2 font-display text-display-sm"
        >
          <MapPin aria-hidden="true" className="size-5 text-primary" />
          Where they work
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {provider.serviceAreas.map((key) => {
            const area = findArea(key);
            return (
              <li key={key}>
                <Badge variant="outline">{area ? areaLabel(area) : key}</Badge>
              </li>
            );
          })}
        </ul>
      </section>

      <section
        className="animate-rise mt-8"
        style={{ animationDelay: "300ms" }}
        aria-labelledby="reviews-heading"
      >
        <h2 id="reviews-heading" className="font-display text-display-sm">
          Reviews
        </h2>

        {reviews.length === 0 ? (
          <p className="mt-2 text-body-sm text-muted-foreground">
            No written reviews yet — this professional is new to the platform.
            Their rating comes from {stats.ratingCount} completed jobs.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {reviews.map((review) => (
              <li key={review.id}>
                <Card className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-body-sm font-semibold">
                      {review.author}
                    </p>
                    <p
                      className="flex items-center gap-1 text-caption tabular-nums"
                      aria-label={`${review.rating} out of 5`}
                    >
                      <Star
                        aria-hidden="true"
                        className="size-3.5 fill-gold text-gold"
                      />
                      {review.rating}.0
                    </p>
                  </div>
                  <p className="mt-1.5 text-pretty text-body-sm text-muted-foreground">
                    {review.comment}
                  </p>
                  <p className="mt-2 text-caption text-muted-foreground">
                    {review.daysAgo < 30
                      ? `${review.daysAgo} days ago`
                      : `${Math.round(review.daysAgo / 30)} months ago`}
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        Sticky on mobile: this is the action the page exists for, and on a
        phone it would otherwise be four screens down past the reviews.
      */}
      <div className="sticky bottom-4 z-10 mt-8">
        <Card className="animate-rise flex flex-wrap items-center justify-between gap-3 p-4 shadow-lg">
          <p className="text-body-sm">
            <span className="font-semibold">
              {formatNpr(provider.baseRate)}
            </span>{" "}
            <span className="text-muted-foreground">
              starting · {category.ctaLabel}
            </span>
          </p>
          <Button variant="gold" size="lg" asChild className="btn-tactile">
            <Link
              prefetch={false}
              href={bookingHref({
                category: category.slug,
                providerId: provider.id,
                urgency,
                q,
              })}
            >
              Book {provider.displayName.split(" ")[0]}
            </Link>
          </Button>
        </Card>
      </div>
    </div>
  );
}
