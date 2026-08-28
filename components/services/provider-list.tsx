import Link from "next/link";
import { SearchX } from "lucide-react";

import { ProviderCard } from "@/components/services/provider-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { areaShortLabel } from "@/lib/config/areas";
import { listProviders, type Availability } from "@/lib/data/providers";
import { sortProviders, type SortOption } from "@/lib/data/ranking";

/**
 * The ranked list.
 *
 * A Server Component that awaits its own data, so the page can put it in a
 * Suspense boundary and show skeleton cards the moment a filter changes rather
 * than holding the whole page on the query.
 */

export type ListParams = {
  category: string;
  area?: string | null;
  availability?: string | null;
  verified?: boolean;
  rating?: number | null;
  maxRate?: number | null;
  sort?: SortOption;
  urgency?: string | null;
  q?: string | null;
};

export async function ProviderList({
  params,
  clearHref,
}: {
  params: ListParams;
  /** Where "search everywhere" goes when a ward comes up empty. */
  clearHref: string;
}) {
  const providers = await listProviders({
    category: params.category,
    area: params.area,
    availability: (params.availability as Availability | "any") ?? null,
    verifiedOnly: params.verified,
    minRating: params.rating,
    maxRate: params.maxRate,
  });

  const ranked = sortProviders(providers, params.sort ?? "relevance", {
    urgency: params.urgency,
    area: params.area,
  });

  if (ranked.length === 0) {
    return (
      <EmptyState
        icon={SearchX}
        title={
          params.area
            ? `Nobody free in ${areaShortLabel(params.area)} right now`
            : "No one matches those filters"
        }
        description={
          params.area
            ? "Professionals travel across the Valley, and someone one ward over can usually still come today."
            : "Try loosening a filter — availability and minimum rating are the two that cut a list down fastest."
        }
        action={
          <Button variant="gold" asChild className="btn-tactile">
            <Link href={clearHref}>Search the whole Valley</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      {/* The cards are h3s. Without this the page jumps h1 to h3, which is
          what a screen reader user hears as a missing level. */}
      <h2 className="sr-only">Professionals</h2>

      <p
        aria-live="polite"
        className="animate-rise mt-4 text-caption text-muted-foreground"
      >
        {ranked.length} {ranked.length === 1 ? "professional" : "professionals"}
        {params.area
          ? ` covering ${areaShortLabel(params.area)}`
          : " in the Valley"}
      </p>

      {params.urgency === "emergency" ? (
        <Card className="animate-rise mt-3 border-warning/30 bg-warning/[0.07] p-4">
          <p className="text-body-sm">
            <strong className="font-semibold">Sorted for speed.</strong> Because
            you said this is urgent, whoever can come soonest is first — not
            whoever has the highest rating.
          </p>
        </Card>
      ) : null}

      <ul className="mt-4 flex flex-col gap-4">
        {ranked.map((provider, index) => (
          <li key={provider.id}>
            <ProviderCard
              provider={provider}
              categorySlug={params.category}
              urgency={params.urgency}
              q={params.q}
              index={index}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

/** What the list looks like while it is being fetched. Never a blank gap. */
export function ProviderListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <ul aria-hidden="true" className="mt-4 flex flex-col gap-4">
      {Array.from({ length: count }).map((_, index) => (
        <li key={index}>
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex items-start gap-4">
              <span
                className="animate-skeleton size-14 shrink-0 rounded-lg bg-muted"
                style={{ animationDelay: `${index * 80}ms` }}
              />
              <div className="flex-1 space-y-2">
                <span className="animate-skeleton block h-5 w-40 rounded bg-muted" />
                <span className="animate-skeleton block h-4 w-56 rounded bg-muted [animation-delay:120ms]" />
              </div>
              <span className="animate-skeleton h-6 w-20 rounded bg-muted [animation-delay:60ms]" />
            </div>
            <div className="flex gap-2">
              <span className="animate-skeleton h-6 w-24 rounded-full bg-muted" />
              <span className="animate-skeleton h-6 w-28 rounded-full bg-muted [animation-delay:90ms]" />
            </div>
            <div className="flex gap-8 border-t border-border pt-4">
              <span className="animate-skeleton h-9 w-16 rounded bg-muted" />
              <span className="animate-skeleton h-9 w-16 rounded bg-muted [animation-delay:70ms]" />
              <span className="animate-skeleton h-9 w-20 rounded bg-muted [animation-delay:140ms]" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
