import { getLocale, getTranslations } from "next-intl/server";
import {
  ArrowRight,
  BadgeCheck,
  HandCoins,
  MapPin,
  ReceiptText,
  Star,
  Timer,
} from "lucide-react";

import { ActivityTicker } from "@/components/marketing/activity-ticker";
import { SiteFooter } from "@/components/marketing/footer";
import { ProblemSearch } from "@/components/marketing/problem-search";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SiteHeader } from "@/components/marketing/site-header";
import { CountUp } from "@/components/shared/count-up";
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
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import { CATEGORY_BOOKINGS_THIS_WEEK } from "@/lib/mock/categoryStats";
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
const TRUST_ITEMS: {
  Icon: typeof BadgeCheck;
  key: string;
  value?: number;
  decimals?: number;
  suffix?: string;
}[] = [
  { Icon: BadgeCheck, key: "verified", value: 1200, suffix: "+" },
  { Icon: ReceiptText, key: "pricing" },
  { Icon: Star, key: "rating", value: 4.8, decimals: 1 },
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
  const [profile, locale, t] = await Promise.all([
    getSessionProfile(),
    getLocale() as Promise<Locale>,
    getTranslations("home"),
  ]);

  return (
    <>
      <SiteHeader accountName={profile?.fullName ?? null} />

      <main id="main">
        {/* ---------------- hero ---------------- */}
        <section className="relative overflow-hidden">
          {/* Pure token gradient — nothing to download. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-gold/[0.18] to-transparent"
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
                  className="mt-1 text-body-md text-muted-foreground"
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
              {TRUST_ITEMS.map(({ Icon, key, value, decimals, suffix }) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-sm font-semibold leading-tight">
                      {value !== undefined ? (
                        <>
                          <span className="font-display text-lg font-bold">
                            <CountUp
                              value={value}
                              decimals={decimals}
                              suffix={suffix}
                            />
                          </span>{" "}
                        </>
                      ) : null}
                      {t(`trust.${key}.label`)}
                    </p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {t(`trust.${key}.detail`)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <ActivityTicker />
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
              const booked = CATEGORY_BOOKINGS_THIS_WEEK[slug];

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

                          {/* Mock booking volume — see lib/mock/categoryStats.ts */}
                          <span className="mt-auto pt-3 text-caption tabular-nums text-muted-foreground/80 transition-transform duration-200 group-hover:-translate-y-px">
                            {t("bookedThisWeek", { n: String(booked) })}
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
