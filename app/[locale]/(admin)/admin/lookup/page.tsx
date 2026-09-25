import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Search } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { formatInstant } from "@/lib/booking";
import { categoryCopy } from "@/lib/config/services";
import { getCategories } from "@/lib/data/categories";
import { lookup } from "@/lib/data/lookup";
import { formatBand, formatNpr } from "@/lib/utils";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * One booking, everything about it, because somebody is on the phone.
 *
 * WHAT THIS IS FOR AND WHY IT IS NOT A QUEUE. The six queues answer "what needs
 * deciding". This answers "a customer has rung and I need to see their job" —
 * which has no list, no order and no end, and would have broken the index's
 * "nothing is waiting" the moment it was counted as work.
 *
 * IT DOES NOT WIDEN WHAT AN ADMIN CAN SEE. Every field here was already
 * readable straight from PostgREST or the Supabase dashboard with no trace,
 * which is the hole `lib/audit` names. What this adds is the record: the search
 * is logged, hit or miss, and the phone numbers that reached the screen are
 * counted. The address is read through the service role rather than by adding
 * an `Admins read every address` policy — a policy would have widened the
 * untraceable route to include everybody's home.
 *
 * NO CLIENT JAVASCRIPT. A plain `<form method="get">`, the same shape
 * `/services` uses, so the result is a shareable URL and the back button
 * behaves — and it works on the connection somebody has while standing
 * somewhere holding a phone to their ear.
 *
 * NO MODEL READS ANY OF IT. This is the single densest screen of personal data
 * in the product: a name, a number, a home address and a risk history on one
 * page. Nothing here is summarised by anything that leaves the building.
 */
export default async function LookupPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.lookup");
  /*
   * The status labels are the customer's own, not a second set. `booking.status`
   * already names every state in the machine; an `admin.lookup.statuses` block
   * would be the same nine strings in two places, drifting the first time one
   * was reworded.
   */
  const tStatus = await getTranslations("booking.status");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") redirect({ href: "/login?next=/admin/lookup", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/lookup", locale });
  }

  // Same clamp and array-handling as `/services`: a query string is whatever
  // somebody put in it, including an array.
  const raw = searchParams.q;
  const query = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim().slice(0, 80);

  const [result, categories] = await Promise.all([
    query ? lookup({ query, adminId: gate.profile.id }) : Promise.resolve(null),
    getCategories(),
  ]);

  const tradeName = (slug: string) => {
    const category = categories.find((c) => c.slug === slug);
    return category ? categoryCopy(category, locale).name : slug;
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      <form
        method="get"
        action="/admin/lookup"
        role="search"
        className="animate-rise mt-6 flex flex-wrap items-center gap-2"
      >
        <label htmlFor="lookup-q" className="sr-only">
          {t("label")}
        </label>
        <div className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-lg border border-input bg-card px-3 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background sm:w-auto sm:max-w-md sm:flex-1">
          <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            id="lookup-q"
            name="q"
            type="search"
            defaultValue={query}
            placeholder={t("placeholder")}
            maxLength={80}
            className="h-full w-full min-w-0 bg-transparent text-body-md outline-none placeholder:text-muted-foreground"
          />
        </div>
        <button type="submit" className={buttonVariants({ className: "btn-tactile" })}>
          {t("submit")}
        </button>
      </form>

      <p className="animate-rise mt-2 text-caption text-muted-foreground">
        {t("accepts")}
      </p>

      {result === null ? null : !result.found ? (
        <p
          className="animate-rise mt-8 text-body-md text-muted-foreground"
          aria-live="polite"
        >
          {result.reason === "impossible"
            ? t("impossible", { characters: result.offending ?? "" })
            : result.reason === "none"
              ? t("unreadable")
              : t("notFound")}
        </p>
      ) : (
        <div className="animate-rise mt-8 space-y-4" aria-live="polite">
          <div className="rounded-lg border border-border p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-display text-heading-sm">
                {tradeName(result.booking.categorySlug)}
              </span>
              <span className="text-caption tabular-nums text-muted-foreground">
                {result.booking.reference}
              </span>
            </div>
            <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
              <Row label={t("status")} value={tStatus(result.booking.status)} />
              <Row
                label={t("band")}
                value={
                  formatBand(
                    { min: result.booking.quotedMin, max: result.booking.quotedMax },
                    { locale },
                  ) ?? t("unrecorded")
                }
              />
              <Row
                label={t("finalAmount")}
                value={
                  result.booking.finalAmount === null
                    ? t("unrecorded")
                    : formatNpr(result.booking.finalAmount, { locale })
                }
              />
            </dl>
          </div>

          <Person title={t("customer")} person={result.customer} unknown={t("unrecorded")} />
          <Person title={t("professional")} person={result.provider} unknown={t("unrecorded")} />

          <div className="rounded-lg border border-border p-5">
            <h2 className="font-display text-heading-sm">{t("where")}</h2>
            {result.address === null ? (
              <p className="mt-2 text-body-sm text-muted-foreground">{t("unrecorded")}</p>
            ) : (
              <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                <Row
                  label={t("ward")}
                  value={`${result.address.city} — ${t("wardNumber", {
                    n: String(result.address.wardNumber),
                  })}`}
                />
                <Row label={t("tole")} value={result.address.tole} />
                <Row label={t("landmark")} value={result.address.landmark} />
                {result.address.directionsNote ? (
                  <Row label={t("directions")} value={result.address.directionsNote} />
                ) : null}
              </dl>
            )}
          </div>

          {/* What happened, oldest first. `getBookingHistory` has existed since
              Phase 6 with no caller at all — this is its first. */}
          <div className="rounded-lg border border-border p-5">
            <h2 className="font-display text-heading-sm">{t("history")}</h2>
            {result.history.length === 0 ? (
              <p className="mt-2 text-body-sm text-muted-foreground">{t("noHistory")}</p>
            ) : (
              <ol className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
                {result.history.map((event, index) => (
                  <li key={`${event.createdAt}-${index}`} className="flex gap-3">
                    <span className="shrink-0 tabular-nums">
                      {formatInstant(event.createdAt, locale)}
                    </span>
                    <span className="text-foreground">
                      {tStatus(event.toStatus as never)}
                    </span>
                    <span className="text-caption">{event.changedByRole}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/*
            * RISK IS SHOWN AND NOT SCORED. The numbers are what happened —
            * no-shows, false addresses, jobs completed. A verdict computed here
            * would be a judgement about a person rendered next to their phone
            * number, which is the shape of thing that gets acted on without
            * anybody deciding to.
            */}
          <div className="rounded-lg border border-border p-5">
            <h2 className="font-display text-heading-sm">{t("customerRecord")}</h2>
            <dl className="mt-3 space-y-1.5 text-body-sm text-muted-foreground">
              <Row label={t("completedJobs")} value={String(result.risk.completedJobs)} />
              <Row label={t("noShows")} value={String(result.risk.noShows)} />
              <Row label={t("falseAddresses")} value={String(result.risk.falseAddresses)} />
              {result.risk.tripDebt > 0 ? (
                <Row
                  label={t("tripDebt")}
                  value={formatNpr(result.risk.tripDebt, { locale })}
                />
              ) : null}
            </dl>
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function Person({
  title,
  person,
  unknown,
}: {
  title: string;
  person: { name: string | null; phone: string | null } | null;
  unknown: string;
}) {
  return (
    <div className="rounded-lg border border-border p-5">
      <h2 className="font-display text-heading-sm">{title}</h2>
      <p className="mt-2 text-body-md">{person?.name ?? unknown}</p>
      {person?.phone ? (
        <a
          href={`tel:${person.phone}`}
          className="mt-1 inline-block text-body-sm tabular-nums text-primary underline underline-offset-4"
        >
          {person.phone}
        </a>
      ) : null}
    </div>
  );
}
