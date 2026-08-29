import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { BookingFlow } from "@/components/booking/booking-flow";
import type { SavedAddress } from "@/components/booking/step-address";
import type { Locale } from "@/i18n/routing";
import { areaLabel, areasByCity, findArea } from "@/lib/config/areas";
import { categoryCopy } from "@/lib/config/services";
import { getSessionProfile } from "@/lib/auth/session";
import { listAddresses } from "@/lib/data/addresses";
import { getCategories } from "@/lib/data/categories";
import { getProvider } from "@/lib/data/providers";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("bookTitle"), robots: { index: false, follow: false } };
}

// The flow reads a session and saved addresses, so there is nothing to
// prerender and a cached shell would show one customer another's addresses.
export const dynamic = "force-dynamic";

/**
 * The booking flow.
 *
 * Arrives from three places — a triage result, a provider card, a category
 * page — and any of the four parameters may be missing, including all of them
 * when somebody lands here cold. Nothing below requires one: a missing
 * category just means the first step asks.
 *
 * Deliberately NOT redirecting a signed-out visitor to login. `/book` is still
 * in PROTECTED_ROUTES for the middleware's benefit on the pages that need it,
 * but the flow itself lets a stranger through the first three steps and asks
 * them to sign in at the professional step, with the draft in sessionStorage
 * and the redirect intent in the URL. Gating step one is where funnels die.
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
  const triageLogId = first(searchParams.triage);

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.flow");
  const tServices = await getTranslations("services");

  const profile = await getSessionProfile();

  /*
   * The `booking` namespace is held back from the root client provider — it is
   * the longest prose in the catalogue and every page would carry it. The flow
   * is a Client Component and genuinely needs it, so it gets its own provider
   * scoped to this page rather than the landing page paying for booking copy.
   */
  const messages = await getMessages();

  const [categories, addresses, provider] = await Promise.all([
    getCategories(),
    profile ? listAddresses() : Promise.resolve([]),
    providerId ? getProvider(providerId) : Promise.resolve(null),
  ]);

  const ward = (n: number) => tServices("ward", { n: String(n) });

  const savedAddresses: SavedAddress[] = addresses.map((address) => {
    const area = findArea(address.areaKey);
    return {
      id: address.id,
      label: address.label,
      tole: address.tole,
      landmark: address.landmark,
      areaKey: address.areaKey,
      areaLabel: area
        ? areaLabel(area, locale, ward(area.wardNumber))
        : address.city,
    };
  });

  const areas = areasByCity(locale).map((group) => ({
    city: group.city,
    options: group.areas.map((area) => ({
      value: area.key,
      label: areaLabel(area, locale, ward(area.wardNumber)),
    })),
  }));

  // Every ward key to its label, so the review screen can name the area the
  // customer picked without shipping the areas config to the browser.
  const areaLabels: Record<string, string> = {};
  for (const group of areas) {
    for (const option of group.options) areaLabels[option.value] = option.label;
  }

  // The intent travels in the URL so `safeRedirect` brings them back to this
  // booking rather than the homepage.
  const back = new URLSearchParams();
  if (categorySlug) back.set("category", categorySlug);
  if (providerId) back.set("provider", providerId);
  if (urgency) back.set("urgency", urgency);
  if (q) back.set("q", q);
  const loginHref = `${locale === "ne" ? "/ne" : ""}/login?next=${encodeURIComponent(
    `/book?${back.toString()}`,
  )}`;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      <div className="animate-rise mt-8" style={{ animationDelay: "60ms" }}>
        <NextIntlClientProvider
          locale={locale}
          messages={{ booking: messages.booking }}
        >
        <BookingFlow
          seed={{
            category: categorySlug,
            provider: providerId,
            urgency,
            description: q,
            triageLogId,
          }}
          categories={categories.map((category) => ({
            slug: category.slug,
            label: categoryCopy(category, locale).name,
            priceMin: category.basePriceMin,
            priceMax: category.basePriceMax,
            // Formatted here rather than passed as a formatter: a function
            // cannot cross the server/client boundary, and the locale-aware
            // currency rules belong on the server anyway.
            quoteLabel: `${formatNpr(category.basePriceMin, { locale })}–${formatNpr(category.basePriceMax, { locale })}`,
          }))}
          savedAddresses={savedAddresses}
          areas={areas}
          preselectedProvider={
            provider
              ? {
                  id: provider.id,
                  displayName: provider.displayName,
                  photoUrl: provider.photoUrl,
                  yearsExperience: provider.yearsExperience,
                  isVerified: provider.isVerified,
                  availability: provider.availability,
                  ratingAvg: provider.stats.ratingAvg,
                  ratingCount: provider.stats.ratingCount,
                  jobsCompleted: provider.stats.jobsCompleted,
                  avgResponseMinutes: provider.stats.avgResponseMinutes,
                }
              : null
          }
          signedIn={Boolean(profile)}
          loginHref={loginHref}
          areaLabels={areaLabels}
        />
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
