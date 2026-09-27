import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  BadgeCheck,
  HandCoins,
  MapPin,
  ReceiptText,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { ActivityStrip } from "@/components/marketing/activity-strip";
import { PromiseStrip } from "@/components/marketing/promise-strip";
import { SiteFooter } from "@/components/marketing/footer";
import { ProblemSearch } from "@/components/marketing/problem-search";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SiteHeader } from "@/components/marketing/site-header";
import { CountUp } from "@/components/shared/count-up";
import { headerIdentity } from "@/lib/auth";
import { platformStats } from "@/lib/data/platform";
import { Reveal } from "@/components/shared/reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import {
  categoryCopy,
  isSurveyPriced,
  SERVICE_CATEGORIES,
} from "@/lib/config/services";
import { categoryBookingCounts, recentActivity } from "@/lib/data/activity";
import { formatNpr } from "@/lib/utils";
import { site } from "@/lib/config/site";

/**
 * Public landing page.
 *
 * Above the fold is deliberately cheap to render — a token gradient and type,
 * no hero image or video. A lot of this traffic is a mid-range Android on a
 * 3G connection, and the search input is the only thing that has to be
 * interactive immediately.
 */

// PLACEHOLDER DATA — swap for real figures once we have them. Replaced in
// Phase 9 by live aggregates (verified-pro count, mean rating, review count).
// Items with a `value` count up on scroll; the rest just reveal. The words are
// keys into `home.trust`; only the numbers live here.
/*
 * FOUR THINGS WE DO, and numbers only once they are earned.
 *
 * This strip said "1,200+ ID-verified professionals" and "Average rating 4.8
 * from 10,000+ households" against 28 fixtures and no completed bookings —
 * the first thing on the page, and the specific claim the product asked to be
 * trusted on.
 *
 * IT SHOWS NOTHING RATHER THAN SOMETHING SMALLER. A count of two is not a
 * humbler version of a count of twelve hundred; it is an admission dressed as
 * a statistic, and a reader does the arithmetic on what it implies. All four
 * items are true on day one with no data at all, and two of them grow a figure
 * when `platformStats` says there is one.
 */
const TRUST_ITEMS: {
  Icon: typeof BadgeCheck;
  key: "verified" | "pricing" | "guarantee" | "coverage";
}[] = [
  { Icon: BadgeCheck, key: "verified" },
  { Icon: ReceiptText, key: "pricing" },
  { Icon: ShieldCheck, key: "guarantee" },
  { Icon: MapPin, key: "coverage" },
];

// The three highest-intent searches carry the most visual weight in the grid.
const FEATURED_SLUGS = ["plumbing", "electrical", "home-cleaning"];

const STEPS = ["describe", "match", "track", "pay"] as const;

const FAQS = ["notHome", "price", "cash", "badWork", "checks"] as const;

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}) {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("homeTitle"), description: t("homeDescription") };
}

export default async function Home() {
  // One wave, per the latency rule: these do not depend on each other, and the
  // booking counts are a cached aggregate so most renders pay nothing for them.
  const [profile, locale, t, tNav, stats, bookingCounts, activity] =
    await Promise.all([
      getSessionProfile(),
      getLocale() as Promise<Locale>,
      getTranslations("home"),
      getTranslations("nav"),
      // Cached per request, and it returns nothing at all rather than a smaller
      // number when the evidence is thin. See `platformStats`.
      platformStats(),
      categoryBookingCounts(),
      // Both of these are cached across visitors rather than per request, so
      // most renders pay nothing for either. One wave, per the latency rule —
      // nothing here depends on anything else here.
      recentActivity(),
    ]);

  /*
   * One function decides every door in the header — see `headerIdentity`.
   * Three pages render this component and each used to work the props out for
   * itself, which is how the Admin item came to appear on one screen and not
   * another.
   */
  const identity = headerIdentity({
    signedIn: profile != null,
    fullName: profile?.fullName ?? null,
    role: profile?.role ?? null,
    providerId: profile?.providerId ?? null,
    fallbackName: tNav("account"),
  });

  return (
    <>
      <SiteHeader {...identity} />

      <main id="main">
        {/* ---------------- hero ---------------- */}
        {/*
          The CTA anchors point here, at the whole hero — not at the search box
          inside it. Aiming at the input scrolled the headline off the top and
          left a sliver of clipped text under the sticky header, which reads as
          a broken page rather than a considered landing.
        */}
        <section id="hero" className="relative scroll-mt-16 overflow-hidden">
          {/* Pure token gradient — nothing to download. */}
          <div
            aria-hidden="true"
            // inset-0, not a fixed height: at 560px the gradient was still
            // mid-fade where the section ends and `overflow-hidden` cut it,
            // leaving a hard horizontal step above the trust strip.
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-gold/[0.18] via-gold/[0.06] to-transparent"
          />
          {/*
            Drifting mesh, brand colours only, kept at low opacity so it never
            touches text contrast. Hidden under 640px — see `.mesh`.
          */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block"
          >
            <span className="mesh -left-20 top-[-8rem] size-[30rem] bg-primary/[0.10]" />
            <span className="mesh right-[-6rem] top-[-4rem] size-[26rem] bg-gold/[0.16] [animation-delay:-9s] [animation-duration:32s]" />
            <span className="mesh bottom-[-12rem] left-1/3 size-[24rem] bg-primary/[0.07] [animation-delay:-17s] [animation-duration:38s]" />
          </div>

          <div className="container relative pb-12 pt-12 sm:pb-16 sm:pt-18">
            <div className="max-w-3xl">
              <div className="animate-rise">
                <Badge variant="gold-subtle">{t("badge")}</Badge>
              </div>

              <h1 className="animate-rise mt-4 text-balance font-display text-display-lg [animation-delay:60ms] sm:text-display-xl">
                {t("heading")}
              </h1>

              <div className="animate-rise [animation-delay:120ms]">
                <p className="mt-4 max-w-xl text-pretty text-body-lg text-muted-foreground">
                  {t("lead")}
                </p>
                {/*
                  The tagline in the *other* language, which is the point: an
                  English reader sees that we work in Nepali, and a Nepali
                  reader sees the same the other way. Dropping it on /ne would
                  have made the bilingual signal one-directional.
                */}
                <p
                  className="mt-3 flex items-center gap-2.5 text-body-md text-muted-foreground before:h-px before:w-6 before:shrink-0 before:bg-border before:content-['']"
                  lang={locale === "ne" ? "en" : "ne"}
                >
                  {locale === "ne" ? site.tagline : site.taglineNe}
                </p>
              </div>

              <div className="animate-rise mt-8 [animation-delay:180ms]">
                <ProblemSearch />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- trust strip ---------------- */}
        <div className="border-y border-border bg-card/60">
          <div className="container">
            <ul className="grid grid-cols-2 gap-x-6 gap-y-5 py-6 lg:grid-cols-4">
              {TRUST_ITEMS.map(({ Icon, key }) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-sm font-semibold leading-tight">
                      {/*
                          The count appears only when it has cleared its floor,
                          and `CountUp` only then too — a number animating up to
                          two would draw the eye to the one thing on the strip
                          worth least attention.
                       */}
                      {key === "verified" && stats.professionals !== null ? (
                        <>
                          <span className="font-display text-lg font-bold">
                            <CountUp value={stats.professionals} />
                          </span>{" "}
                        </>
                      ) : null}
                      {t(`trust.${key}.label`)}
                    </p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {key === "guarantee" &&
                      stats.rating !== null &&
                      stats.households !== null
                        ? t("trust.ratingWithCount", {
                            rating: stats.rating.toFixed(1),
                            households: String(stats.households),
                          })
                        : t(`trust.${key}.detail`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <PromiseStrip />
        </div>

        {/* ---------------- categories ---------------- */}
        <Section id="services">
          <Reveal>
            <SectionHeading
              eyebrow={t("servicesEyebrow")}
              title={t("servicesTitle")}
              lead={t("servicesLead")}
            />
          </Reveal>

          {/*
            Bento: the three highest-intent categories get double-width cards on
            desktop, the rest sit in a tighter row beneath. Under 640px the
            whole thing collapses to two even columns, so no card is left
            orphaned in a half-width gap.
          */}
          {/*
            Bento on a 12-column grid, sized so every row fills exactly:
              row 1  3 featured x 4 = 12   (the highest-intent searches)
              row 2  4 regular  x 3 = 12
              row 3  3 + 3 + 6      = 12   (the last card takes the slack)
            Without that last span the tenth card sits alone on its own row.
            Under 640px it is two even columns, with the featured cards and
            the trailing card full-width so nothing is left half-orphaned.
          */}
          <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-12">
            {SERVICE_CATEGORIES.map((category, i) => {
              const { slug, Icon } = category;
              const copy = categoryCopy(category, locale);
              const featured = FEATURED_SLUGS.includes(slug);
              const last = i === SERVICE_CATEGORIES.length - 1;
              /*
                A RESEARCHED FLOOR, NOT AN INVENTED COUNT. This line used to
                read "312 booked this week" against 14 real bookings across
                every category. The band is `researched`, dated and sourced —
                and it answers what somebody choosing a category is actually
                asking, which a number they cannot verify never did.

                `isSurveyPriced` decides, as it already does on five other
                surfaces: movers publishes no band anywhere, because no Nepali
                operator quotes a move without seeing it. A category with no
                band must never render a floor of zero.
              */
              const surveyPriced = isSurveyPriced(category);
              const booked = bookingCounts.get(slug);

              const span = featured
                ? "col-span-2 lg:col-span-4"
                : last
                  ? "col-span-2 lg:col-span-6"
                  : "col-span-1 lg:col-span-3";

              return (
                <li key={slug} className={span}>
                  <Reveal delay={Math.min(i * 0.03, 0.24)} className="h-full">
                    <Card className="group h-full overflow-hidden transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg">
                      <Link
                        href={`/services/${slug}`}
                        className="flex h-full flex-col rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <div
                          className={
                            featured
                              ? "flex flex-1 flex-col gap-2 p-5 sm:p-7"
                              : "flex flex-1 flex-col gap-2 p-4"
                          }
                        >
                          <span
                            className={
                              (featured
                                ? "size-12 rounded-xl "
                                : "size-10 rounded-lg ") +
                              "grid place-items-center bg-primary/10 text-primary transition-[transform,background-color,color] duration-200 group-hover:-translate-y-0.5 group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground"
                            }
                          >
                            <Icon
                              aria-hidden="true"
                              className={featured ? "size-6" : "size-5"}
                            />
                          </span>

                          <span
                            className={
                              (featured
                                ? "font-display text-body-lg sm:text-display-sm "
                                : "text-body-sm ") +
                              "mt-1 font-semibold leading-snug transition-transform duration-200 group-hover:-translate-y-px"
                            }
                          >
                            {copy.name}
                          </span>

                          <span
                            className={
                              (featured ? "text-body-sm " : "text-caption ") +
                              "text-muted-foreground"
                            }
                          >
                            {copy.descriptor}
                          </span>

                          <span className="mt-auto pt-3 text-caption tabular-nums text-muted-foreground/80 transition-transform duration-200 group-hover:-translate-y-px">
                            {surveyPriced
                              ? t("surveyPriced")
                              : t("fromPrice", {
                                  price: formatNpr(category.basePriceMin, {
                                    locale,
                                  }),
                                })}
                            {/*
                              REAL, AND ONLY ABOVE ITS FLOOR. `categoryBookingCounts`
                              drops anything under CATEGORY_COUNT_FLOOR, so a slug
                              missing from the map is one we are not ready to print
                              a figure for — never a zero, never "fewer than 20".
                            */}
                            {booked === undefined ? null : (
                              <> · {t("bookedThisWeek", { n: String(booked) })}</>
                            )}
                          </span>
                        </div>
                      </Link>
                    </Card>
                  </Reveal>
                </li>
              );
            })}
          </ul>
        </Section>

        {/* ---------------- what has actually happened ---------------- */}
        {/*
          Real finished jobs, or nothing. It returns null below the floor and on
          a failed read, so this slot is silent until there is enough behind it
          — which is why it sits here rather than above the fold, where a band
          appearing and disappearing would move the hero.
        */}
        <ActivityStrip entries={activity} />

        {/* ---------------- how it works ---------------- */}
        <Section
          id="how-it-works"
          className="border-y border-border bg-card/60"
        >
          <Reveal>
            <SectionHeading
              eyebrow={t("stepsEyebrow")}
              title={t("stepsTitle")}
              lead={t("stepsLead")}
            />
          </Reveal>

          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step}>
                <Reveal delay={i * 0.06} className="h-full">
                  <div className="relative h-full border-t border-border pt-5">
                    <span
                      aria-hidden="true"
                      className="absolute -top-4 grid size-8 place-items-center rounded-full bg-gold font-display text-body-sm font-bold tabular-nums text-gold-foreground"
                    >
                      {i + 1}
                    </span>
                    <h3 className="mt-3 font-display text-lg font-semibold">
                      {t(`steps.${step}.title`)}
                    </h3>
                    <p className="mt-1.5 text-pretty text-body-sm text-muted-foreground">
                      {t(`steps.${step}.body`)}
                    </p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </Section>

        {/* ---------------- for professionals ---------------- */}
        <Section id="for-professionals">
          <Reveal>
            <Card className="border-transparent bg-primary text-primary-foreground">
              <div className="flex flex-col gap-6 p-8 sm:p-10 lg:flex-row lg:items-center">
                <div className="max-w-xl">
                  <p className="text-overline uppercase text-primary-foreground/70">
                    {t("prosEyebrow")}
                  </p>
                  <h2 className="mt-2 text-balance font-display text-display-sm">
                    {t("prosTitle")}
                  </h2>
                  <p className="mt-3 text-pretty text-body-md text-primary-foreground/85">
                    {t("prosLead")}
                  </p>
                  <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-primary-foreground/85">
                    <li className="flex items-center gap-2">
                      <HandCoins aria-hidden="true" className="size-4" />
                      {t("prosPayouts")}
                    </li>
                    <li className="flex items-center gap-2">
                      <Timer aria-hidden="true" className="size-4" />
                      {t("prosHours")}
                    </li>
                    <li className="flex items-center gap-2">
                      <BadgeCheck aria-hidden="true" className="size-4" />
                      {t("prosVerification")}
                    </li>
                  </ul>
                </div>
                <div className="lg:ml-auto">
                  <Button variant="gold" size="lg" asChild>
                    <Link href="/providers/join" prefetch={false}>
                      {t("prosCta")}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          </Reveal>
        </Section>

        {/* ---------------- faq ---------------- */}
        <Section id="faq" className="border-t border-border bg-card/60">
          <Reveal>
            <SectionHeading eyebrow={t("faqEyebrow")} title={t("faqTitle")} />
          </Reveal>

          <Reveal delay={0.05} className="mt-8 max-w-3xl">
            <Accordion type="single" collapsible>
              {FAQS.map((faq) => (
                <AccordionItem key={faq} value={faq}>
                  <AccordionTrigger>{t(`faq.${faq}.q`)}</AccordionTrigger>
                  <AccordionContent>{t(`faq.${faq}.a`)}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </Section>
      </main>

      <SiteFooter />
    </>
  );
}
