import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { BookingFlow } from "@/components/booking/booking-flow";
import { Button } from "@/components/ui/button";
import type { SavedAddress } from "@/components/booking/step-address";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { tripDebtNotice } from "@/lib/abuse";
import { areaLabel, areasByCity, findAreaIn } from "@/lib/config/areas";
import { categoryCopy, categoryQuote } from "@/lib/config/services";
import { allAreas, openAreas } from "@/lib/data/areas";
import { supportPhoneDisplay } from "@/lib/config/site";
import { getSessionProfile } from "@/lib/auth/session";
import { listAddresses } from "@/lib/data/addresses";
import { customerHistory } from "@/lib/data/customer-risk";
import { getSubBands, openCategories } from "@/lib/data/categories";
import { providerCapacity } from "@/lib/data/capacity";
import { getProvider } from "@/lib/data/providers";
import { TRIAGE_PARAM } from "@/lib/routes/booking";
import { formatNpr } from "@/lib/utils";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
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
export default async function BookPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const categorySlug = first(searchParams.category);
  const providerId = first(searchParams.provider);
  const urgency = first(searchParams.urgency);
  const q = first(searchParams.q);
  // Same constant `bookingHref` writes, so the two ends of this seam cannot
  // drift apart — which is how the attribution was lost in the first place.
  const triageLogId = first(searchParams[TRIAGE_PARAM]);
  // Which product the triage narrowed to, so the booking can know its own
  // length. Absent for anybody who reached /book without going through the
  // hero, which is an ordinary case and not a failure.
  const band = first(searchParams.band);
  const bandSource = first(searchParams.bandSource);
  const asked = first(searchParams.asked) === "1";

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

  const [openCats, subBands, addresses, provider, risk] = await Promise.all([
    /*
     * THE SCOPED LIST, AND NULL REFUSES HERE rather than falling back to the
     * whole catalogue the way the landing grid and `/services` do. This is the
     * flow that takes the booking, so an unreadable scope is the same kind of
     * fault as an unreadable band: we do not know which trades are open, and
     * collecting a description, an address and a time before finding out is the
     * dead end `bandsUnreadable` already refuses a few lines down.
     */
    openCategories(),
    getSubBands(),
    profile ? listAddresses() : Promise.resolve([]),
    providerId ? getProvider(providerId) : Promise.resolve(null),
    /*
     * A CARRIED TRIP DEBT, IN THE SAME WAVE. It is read here rather than at
     * settlement-time only because the review screen has to say it before the confirm
     * button: the recovery is the one charge on this platform beyond the work itself,
     * and a charge that first appears on the final bill is a charge added unseen.
     * Signed out there is nobody to owe anything, and the flow asks for a sign-in at
     * the professional step — by which point this page has re-rendered.
     */
    profile ? customerHistory(profile.id) : Promise.resolve(null),
  ]);

  /*
   * The preselected professional's own capacity, so the review screen can say
   * "already booked at that time" about the person who came in on the URL.
   * Without this the one professional a customer arrived WANTING is the only
   * one whose full window was invisible.
   */
  const preselectedCapacity =
    provider && categorySlug
      ? (await providerCapacity([provider.id], categorySlug))[provider.id]
      : undefined;

  const ward = (n: number) => tServices("ward", { n: String(n) });

  /*
   * FORMATTED HERE, like `quoteLabel` beside it and for the same reason: a formatter
   * cannot cross the server/client boundary, and the locale's currency and numeral
   * rules belong on the server. `sharePercent` goes over as a string because `ne`
   * renders digits as Devanagari and this one sits in a sentence rather than beside a
   * figure the reader has to match.
   */
  const debtNotice = risk
    ? tripDebtNotice({
        outstanding: risk.tripDebt,
        disputedAt: risk.tripDebtDisputedAt,
      })
    : { show: false as const };

  const tripDebt = debtNotice.show
    ? {
        outstandingLabel: formatNpr(debtNotice.outstanding, { locale }),
        sharePercent: String(debtNotice.sharePercent),
        disputed: debtNotice.disputed,
      }
    : null;

  /*
   * A SAVED ADDRESS IS A LABEL, NOT A CHOICE — so every area ever, including a
   * ward we have since retired. The customer already lives there; refusing to
   * name it would make their own saved address unreadable, and they can still
   * pick it for a booking because the ward was live when they saved it.
   */
  const labelAreaRows = await allAreas();

  const savedAddresses: SavedAddress[] = addresses.map((address) => {
    const area = findAreaIn(labelAreaRows, address.areaKey);
    return {
      id: address.id,
      label: address.label,
      tole: address.tole,
      landmark: address.landmark,
      areaKey: address.areaKey,
      areaLabel: area
        ? areaLabel(area, locale, ward(area.wardNumber))
        : address.city,
      /* Whatever pin this address already carries, so a returning customer is not
         asked to locate a place they located once. */
      at: address.at,
    };
  });

  /*
   * THE PICKER OFFERS LIVE WARDS ONLY, and `null` means we could not read them.
   * A retired ward in this list is a booking nobody will travel to, so it is the
   * same refusal the unreadable price band gets a few lines down — `areaRows`
   * is checked there, in one place, rather than rendering a picker with nothing
   * in it.
   */
  const areaRows = await openAreas();
  /*
   * `[]` SO THE REST OF THE PAGE HAS A LIST, with the refusal below reading the
   * flag rather than the length — `categories.length === 0` is a REAL state
   * during a soft launch (nothing open in this trade yet) and must not be
   * confused with "we could not read it", which is rule 6 on the one screen
   * that decides whether to take somebody's money.
   */
  const scopeUnreadable = openCats === null;
  const categories = openCats ?? [];
  const areas = areasByCity(areaRows ?? [], locale).map((group) => ({
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

  /*
   * NO BAND, NO BOOKING — and this is a refusal rather than a flow with the
   * prices hidden.
   *
   * `getCategories` blanks the band when the `categories` read FAILS, because
   * the seed holds the band as authored and `/admin/bands` moves it in the table
   * — so the two diverge with every decision somebody takes. Offering the flow
   * anyway would collect a description, an address and a time and then have
   * `createBooking` refuse at the end, which is a worse screen than this one;
   * and quoting from the seed is the thing being fixed, since `quoted_max` is
   * frozen onto the booking and is what `judgeFinalAmount` measures a 2x
   * overcharge against.
   *
   * THE BLANKING IS WHOLESALE, so one unreadable category means the read failed
   * and every band is unknown. `some` rather than `every` because a survey trade
   * is never `unreadable` and would make `every` false for ever.
   *
   * The sentence is `/services`' — ours, not theirs — with the support number,
   * because somebody who wanted a plumber now needs a way to get one.
   */
  const bandsUnreadable = categories.some(
    (category) => categoryQuote(category).kind === "unreadable",
  );

  /*
   * THE AREAS JOIN THE SAME REFUSAL, because the flow needs both to take a
   * booking: a price to quote and a ward to send somebody to. One screen says
   * one thing, so they share it rather than stacking two panels — and the
   * sentence is about what failed on OUR side either way.
   */
  if (bandsUnreadable || areaRows === null || scopeUnreadable) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <header className="animate-rise">
          <h1 className="font-display text-display-md">{t("title")}</h1>
        </header>

        <div
          className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4"
          style={{ animationDelay: "60ms" }}
        >
          <p className="text-body-md">
            {t("pricesUnreadable")}
            {/*
              THE NUMBER ONLY IF THERE IS ONE. `supportPhoneDisplay` is null
              until a real line exists, and "ring null now" is worse than not
              offering a call — `/provider/payouts` settled that and the rule
              transfers. The sentence above stands on its own either way.
            */}
            {supportPhoneDisplay
              ? ` ${t("pricesUnreadableCall", { phone: supportPhoneDisplay })}`
              : ""}
          </p>

          {/*
            AND SOMETHING TO PRESS, which is `components/shared/empty-state.tsx`'s
            standing rule applied to a failure rather than to an absence: a
            screen that says "try again in a minute" and offers no way to try is
            the dead end that rule exists to refuse. The retry is a link to this
            same URL carrying the same intent — a Server Component re-runs its
            reads on navigation, so it genuinely retries rather than replaying a
            cached render, and the customer does not lose the category,
            professional or description they arrived with.
          */}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/book?${back.toString()}`}>{t("tryAgain")}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/services">{t("browseInstead")}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /*
   * NOTHING OPEN YET, WHICH IS A DIFFERENT SENTENCE FROM "WE COULD NOT READ IT".
   *
   * During a soft launch the scope may be narrowed to a handful of wards and
   * trades, and `scopeStanding` calls the both-ends-empty case `closed` for the
   * reason this branch exists: a booking needs a ward AND a trade, so either
   * list being empty means the product takes no bookings, however full the
   * other one is.
   *
   * IT IS NOT A FAULT AND MUST NOT WEAR THE FAULT'S COPY. The panel above says
   * "this is us, not you" with a phone number, because something broke; this is
   * a decision we made, so it says we are starting in a few areas and will
   * widen — no warning colour, no apology for a malfunction, and the same
   * `empty-state` rule that there is always something to press. It is checked
   * SECOND so the two cannot stack: an unreadable scope means we do not know
   * whether we are open, and `instead`'s rule is that one screen says one thing.
   */
  if (categories.length === 0 || areaRows.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl">
        <header className="animate-rise">
          <h1 className="font-display text-display-md">{t("title")}</h1>
        </header>

        <div
          className="animate-rise mt-6 rounded-lg border border-border bg-muted/40 p-4"
          style={{ animationDelay: "60ms" }}
        >
          <p className="text-body-md">{t("notOpenYet")}</p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/services">{t("browseInstead")}</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      <div className="animate-rise mt-8" style={{ animationDelay: "60ms" }}>
        <NextIntlClientProvider
          locale={locale}
          /* `common` carries the shared "from" the price on each shortlist
             row needs. Thirteen short keys, and the alternative is a second
             spelling of the same word living inside the booking namespace. */
          messages={{ booking: messages.booking, common: messages.common }}
        >
          <BookingFlow
            seed={{
              category: categorySlug,
              provider: providerId,
              urgency,
              description: q,
              triageLogId,
              band,
              bandSource,
              asked,
            }}
            categories={categories.map((category) => {
              /*
               * A SURVEY TRADE CARRIES NO NUMBERS INTO THE FLOW AT ALL, not even
               * as a value the screen then chooses to hide. Passing them down and
               * trusting five components to remember is how the invented movers
               * range survived on five screens after the data said otherwise.
               */
              const quote = categoryQuote(category);
              const survey = quote.kind === "survey";
              return {
                slug: category.slug,
                label: categoryCopy(category, locale).name,
                /*
                 * `band` or `survey` only: the guard above returned for an
                 * unreadable read, so this is narrowing rather than a third
                 * branch nobody can reach. Reading the two columns directly here
                 * would compile and would be the second place deciding what a
                 * null band means.
                 */
                priceMin: quote.kind === "band" ? quote.low : null,
                priceMax: quote.kind === "band" ? quote.high : null,
                surveyPriced: survey,
                /*
                 * THE PRODUCTS, SO THIS FLOW CAN ASK WHICH ONE. Until now that
                 * question lived only on the triage card, so everybody who
                 * picked a category off `/services` reached a booking with no
                 * product at all — and that is the common path now the AI
                 * ceilings refuse the card to anybody out of free questions.
                 *
                 * Slug and label only, with the locale already chosen here:
                 * `categoryCopy`'s rule, and the same reason the triage route
                 * sends labels back on its response rather than shipping all
                 * thirty-six in two languages to the browser.
                 *
                 * A SURVEY TRADE GETS NONE, like the prices above — it sells no
                 * products to choose between, and an empty list is what the
                 * step reads to know not to ask.
                 */
                subBands: survey
                  ? []
                  : subBands
                      .filter((sub) => sub.categorySlug === category.slug)
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((sub) => ({
                        slug: sub.slug,
                        label: locale === "ne" ? sub.labelNe : sub.labelEn,
                      })),
                // Formatted here rather than passed as a formatter: a function
                // cannot cross the server/client boundary, and the locale-aware
                // currency rules belong on the server anyway.
                quoteLabel:
                  quote.kind === "band"
                    ? `${formatNpr(quote.low, { locale })}–${formatNpr(quote.high, { locale })}`
                    : tServices("surveyPriced"),
              };
            })}
            savedAddresses={savedAddresses}
            areas={areas}
            preselectedProvider={
              provider
                ? {
                    id: provider.id,
                    displayName: provider.displayName,
                    busyUntil: provider.busyUntil,
                    photoUrl: provider.photoUrl,
                    yearsExperience: provider.yearsExperience,
                    isVerified: provider.isVerified,
                    availability: provider.availability,
                    ratingAvg: provider.stats.ratingAvg,
                    ratingCount: provider.stats.ratingCount,
                    ratingRecentAvg: provider.stats.ratingRecentAvg,
                    ratingRecentWeight: provider.stats.ratingRecentWeight,
                    jobsCompleted: provider.stats.jobsCompleted,
                    avgResponseMinutes: provider.stats.avgResponseMinutes,
                    responseSamples: provider.stats.responseSamples,
                    baseRate: provider.baseRate,
                    heldWindows: (preselectedCapacity?.held ?? []).map((job) =>
                      typeof job.scheduledFor === "string"
                        ? job.scheduledFor
                        : (job.scheduledFor?.toISOString() ?? ""),
                    ),
                    capacity: preselectedCapacity?.capacity ?? 1,
                  }
                : null
            }
            tripDebt={tripDebt}
            signedIn={Boolean(profile)}
            loginHref={loginHref}
            areaLabels={areaLabels}
          />
        </NextIntlClientProvider>
      </div>
    </div>
  );
}
