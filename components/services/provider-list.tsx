import { getLocale, getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";

import { DataSourceBadge } from "@/components/services/data-source-badge";
import { ProviderCard } from "@/components/services/provider-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { areaShortLabel } from "@/lib/config/areas";
import {
  listProviders,
  type AvailabilityFilter,
} from "@/lib/data/providers";
import { sortProviders, type SortOption } from "@/lib/data/ranking";
import { providerCapacity } from "@/lib/data/capacity";
import { hasRoom } from "@/lib/booking";
import { jobFit, servingWhen, showsInList } from "@/lib/provider";

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
  /**
   * The product the triage named, passing straight through to the Book link.
   *
   * NOT A FILTER AND NOT A RANKING INPUT — it never reaches `listProviders`.
   * It is triage context being carried to the booking, the same way `q` and
   * `urgency` already are, so a customer who came from "paint my living room,
   * you supply the paint" does not arrive at /book having lost the one fact
   * that says the job is four days rather than two hours.
   */
  band?: string | null;
  bandSource?: string | null;
  /** The triage row this journey began at, passed straight through. */
  triageLogId?: string | null;
  asked?: boolean;
};

export async function ProviderList({
  params,
  clearHref,
  debug = false,
}: {
  params: ListParams;
  /** Where "search everywhere" goes when a ward comes up empty. */
  clearHref: string;
  /** Show the data-source line. Inside this component because the reads it
      reports happen here, after the page shell has already streamed. */
  debug?: boolean;
}) {
  const t = await getTranslations("services");
  const locale = (await getLocale()) as Locale;

  const providers = await listProviders({
    category: params.category,
    area: params.area,
    availability: (params.availability as AvailabilityFilter | "any") ?? null,
    verifiedOnly: params.verified,
    minRating: params.rating,
    maxRate: params.maxRate,
  });

  /*
   * CAN EACH OF THESE PEOPLE ACTUALLY DO THIS JOB?
   *
   * The catalogue never asked. `canServeAt`, `hasRoom` and `providerCapacity`
   * all existed and all ran at claim time, so this list could put somebody
   * whose window was already promised to another customer at the top — the
   * customer taps, and `enforce_slot_capacity` refuses the insert. The list and
   * the database disagreed about who was bookable and the customer found out at
   * the confirm button.
   *
   * WHAT THIS PAGE DOES AND DOES NOT KNOW. There is no slot yet — it is picked
   * later in the booking flow — so `when` is whatever the urgency implies and
   * nothing more. `servingWhen` returns null for an emergency, which is the
   * honest "as soon as possible", and the coarse answer is the right one here:
   * can they come at all. The booking flow asks the exact question later.
   */
  const capacity = await providerCapacity(
    providers.map((p) => p.id),
    params.category,
  );
  const when = servingWhen({ urgency: params.urgency });

  const ranked = sortProviders(providers, params.sort ?? "relevance", {
    urgency: params.urgency,
    area: params.area,
    fit: (provider) => {
      const held = capacity[provider.id];
      return jobFit({
        provider: {
          categories: [params.category],
          availability: provider.availability,
          busyUntil: provider.busyUntil,
        },
        job: {
          categorySlug: params.category,
          urgency: params.urgency,
          when,
          /*
           * UNDEFINED WHERE WE DID NOT READ, never `false`. A listing missing
           * from the capacity map is one nobody checked — Supabase unconfigured,
           * or a read that came back empty — and reporting that as "there is
           * room" would be the default doing the work of a measurement.
           */
          windowFull: held
            ? !hasRoom({
                jobs: held.held,
                scheduledFor: when,
                workingMinutes: null,
                capacity: held.capacity,
              })
            : undefined,
        },
        providerId: provider.id,
      });
    },
  });

  /*
   * ONE EXCLUSION IS SILENT AND IT IS THE ONLY ONE. Somebody who has already
   * turned this exact job down cannot be reassigned — the immutability trigger
   * refuses it — so offering them is a button that cannot work, and naming them
   * to the customer as having refused is bruising to no purpose. Every other
   * reason stays in the list carrying its explanation, because a list that
   * quietly got shorter reads as a catalogue with nobody in it.
   */
  const visible = ranked.filter((provider) => showsInList(provider.fit));

  if (visible.length === 0) {
    const area = params.area ? areaShortLabel(params.area, locale) : null;

    return (
      <EmptyState
        icon={SearchX}
        title={area ? t("emptyAreaTitle", { area }) : t("emptyFiltersTitle")}
        description={area ? t("emptyAreaBody") : t("emptyFiltersBody")}
        action={
          <Button variant="gold" asChild className="btn-tactile">
            <Link href={clearHref}>{t("searchWholeValley")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      {/* The cards are h3s. Without this the page jumps h1 to h3, which is
          what a screen reader user hears as a missing level. */}
      <h2 className="sr-only">{t("professionals")}</h2>

      <p
        aria-live="polite"
        className="animate-rise mt-4 text-caption text-muted-foreground"
      >
        {t("resultCount", {
          count: visible.length,
          n: String(visible.length),
          where: params.area
            ? t("coveringArea", {
                area: areaShortLabel(params.area, locale),
              })
            : t("inTheValley"),
        })}
      </p>

      {params.urgency === "emergency" ? (
        <Card className="animate-rise mt-3 border-warning/30 bg-warning/[0.07] p-4">
          <p className="text-body-sm">
            <strong className="font-semibold">
              {t("sortedForSpeedTitle")}
            </strong>{" "}
            {t("sortedForSpeedBody")}
          </p>
        </Card>
      ) : null}

      <ul className="mt-4 flex flex-col gap-4">
        {visible.map((provider, index) => (
          <li key={provider.id}>
            <ProviderCard
              provider={provider}
              categorySlug={params.category}
              urgency={params.urgency}
              band={params.band}
              bandSource={params.bandSource}
              triageLogId={params.triageLogId}
              asked={params.asked}
              q={params.q}
              index={index}
              fit={provider.fit}
            />
          </li>
        ))}
      </ul>

      <DataSourceBadge enabled={debug} />
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
