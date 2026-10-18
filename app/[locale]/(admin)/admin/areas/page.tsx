import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { AddArea, AreaPanel } from "@/components/admin/area-panel";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { allAreas } from "@/lib/data/areas";
import { wardCentre } from "@/lib/geo";

import { addAreaAction, reopenAreaAction, retireAreaAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The wards we serve, and the two things a person can do to the list.
 *
 * ADD AND RETIRE, NEVER DELETE. `addresses.area_key`,
 * `provider_leads.area_key` and `providers.service_areas` all hold these keys
 * with no foreign key behind them, so removing a row would orphan live
 * bookings, break the dispatch coverage check and leave an old booking page
 * unable to say where the job was. There is no delete button here and the table
 * has no DELETE policy — retiring is the whole mechanism.
 *
 * RETIRED WARDS STAY ON THE SCREEN, quiet and below the live ones. Hiding them
 * would make the one action available on them — reopening — unreachable, and
 * would leave somebody wondering whether a ward they withdrew last month had
 * been deleted after all.
 *
 * THIS SCREEN READS `allAreas()` AND NOT `bookableAreas()`, which is the one
 * place in the product that wants the retired rows. Every CHOICE surface reads
 * the other one — see `lib/data/areas.ts` for why the two reads have different
 * failure postures.
 */
export default async function AreasPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.areas");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/areas", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about
    // what exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/areas", locale });
  }

  const [areas, messages] = await Promise.all([allAreas(), getMessages()]);

  const cards = areas.map((area) => ({
    key: area.key,
    city: area.city,
    cityNe: area.cityNe,
    wardNumber: area.wardNumber,
    name: area.name,
    nameNe: area.nameNe,
    retiredAt: area.retiredAt,
    retiredReason: area.retiredReason,
    /*
     * `wardCentre` IS THE ONE DEFINITION OF "WE KNOW WHERE THIS IS", so the
     * card asks it rather than reading the centroid file a second way. It
     * answers null for an unknown key and an unfetched seed alike, which is
     * exactly what this flag means: distance ranking has nothing to measure.
     */
    centroidMissing: wardCentre(area.key) === null,
  }));

  const live = cards.filter((area) => area.retiredAt === null);
  const retired = cards.filter((area) => area.retiredAt !== null);

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="text-heading-lg font-display">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("neverDeleted")}
        </p>
      </header>

      <NextIntlClientProvider locale={locale} messages={messages}>
        <div className="animate-rise mt-8" style={{ animationDelay: "60ms" }}>
          <AddArea add={addAreaAction} />
        </div>

        <h2 className="mt-8 text-body-sm font-semibold">
          {t("serving", { count: live.length, n: String(live.length) })}
        </h2>
        <ul className="mt-3 space-y-3">
          {live.map((area, index) => (
            <li
              key={area.key}
              className="animate-rise"
              style={{ animationDelay: `${Math.min(index * 0.05, 0.25)}s` }}
            >
              <AreaPanel
                area={area}
                retire={retireAreaAction}
                reopen={reopenAreaAction}
              />
            </li>
          ))}
        </ul>

        {/*
          BELOW, AND ONLY WHEN THERE ARE ANY. A permanent "nothing retired"
          heading is true every day for a year and stops being read — the
          `ACTIVITY_FLOOR` reasoning — and on this screen it would also be the
          only thing suggesting retirement is a thing that happens.
        */}
        {retired.length > 0 ? (
          <>
            <h2 className="mt-10 text-body-sm font-semibold text-muted-foreground">
              {t("notServing", {
                count: retired.length,
                n: String(retired.length),
              })}
            </h2>
            <ul className="mt-3 space-y-3">
              {retired.map((area) => (
                <li key={area.key} className="animate-rise">
                  <AreaPanel
                    area={area}
                    retire={retireAreaAction}
                    reopen={reopenAreaAction}
                  />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </NextIntlClientProvider>
    </section>
  );
}
