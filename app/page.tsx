import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  HandCoins,
  MapPin,
  ReceiptText,
  Star,
  Timer,
} from "lucide-react";

import { SiteFooter } from "@/components/marketing/footer";
import { ProblemSearch } from "@/components/marketing/problem-search";
import { Section, SectionHeading } from "@/components/marketing/section";
import { SiteHeader } from "@/components/marketing/site-header";
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
import { SERVICE_CATEGORIES } from "@/lib/config/services";
import { site } from "@/lib/config/site";

/**
 * Public landing page.
 *
 * Above the fold is deliberately cheap to render — a token gradient and type,
 * no hero image or video. A lot of this traffic is a mid-range Android on a
 * 3G connection, and the search input is the only thing that has to be
 * interactive immediately.
 */

// PLACEHOLDER DATA — swap for real figures once we have them. Nothing here is
// load-bearing; the icons and copy are.
const TRUST_ITEMS = [
  {
    Icon: BadgeCheck,
    label: "ID-verified professionals",
    detail: "Every pro checked",
  },
  {
    Icon: ReceiptText,
    label: "Upfront pricing",
    detail: "Agreed before work starts",
  },
  { Icon: Star, label: "Rated 4.8 / 5", detail: "by 10,000+ households" },
  {
    Icon: MapPin,
    label: "Kathmandu Valley",
    detail: "Ktm · Lalitpur · Bhaktapur",
  },
];

const STEPS = [
  {
    title: "Describe the problem",
    body: "Type it in your own words, or pick a category. No forms, no jargon.",
  },
  {
    title: "Get matched, with a price",
    body: "We find a verified pro nearby and show you the price before anyone is sent.",
  },
  {
    title: "Track it live",
    body: "See when your professional accepts, sets off, and arrives at your door.",
  },
  {
    title: "Pay when it's done",
    body: "eSewa, Khalti or cash — after the work is finished, not before.",
  },
];

const FAQS = [
  {
    q: "What if I'm not home when the professional arrives?",
    a: "You'll get a call and an SMS when they set off, so you know roughly when to expect them. If your plans change, reschedule from the booking screen up to an hour before — there's no charge. If nobody is home and we weren't told, a small visit fee applies to cover the trip.",
  },
  {
    q: "How is the price decided?",
    a: "Every category has a published rate for common jobs, and you see the estimate before you confirm. If the professional finds the job is bigger than described — a burst pipe rather than a dripping tap — they'll explain why and you approve the revised price before they carry on. Nothing gets added to your bill without your say-so.",
  },
  {
    q: "Can I pay in cash?",
    a: "Yes. Cash on completion is fully supported, alongside eSewa and Khalti. You always pay after the job is done. We never ask for payment in advance, and no professional should ever ask you to send money outside the app.",
  },
  {
    q: "What if the work isn't done properly?",
    a: "Report it from the booking within 48 hours and we'll send someone back to put it right at no extra cost. If it still isn't resolved, we refund the job. Repeat complaints affect a professional's trust score, which is why the scores on their profiles are worth reading.",
  },
  {
    q: "How do you check the professionals?",
    a: "Government ID and a citizenship or licence check before anyone takes a job, plus a skills assessment for the trade they're registering in. Their completion rate and rating come from real finished bookings, not self-reported claims.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader />

      <main id="main">
        {/* ---------------- hero ---------------- */}
        <section className="relative overflow-hidden">
          {/* Pure token gradient — nothing to download. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-gradient-to-b from-gold/[0.18] to-transparent"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-24 top-10 hidden size-96 rounded-full bg-primary/[0.06] blur-3xl lg:block"
          />

          <div className="container relative pb-12 pt-12 sm:pb-16 sm:pt-18">
            <div className="max-w-3xl">
              <div className="animate-rise">
                <Badge variant="gold-subtle">
                  Now serving the Kathmandu Valley
                </Badge>
              </div>

              <h1 className="animate-rise mt-4 text-balance font-display text-display-lg [animation-delay:60ms] sm:text-display-xl">
                A verified professional at your door, usually within the hour.
              </h1>

              <div className="animate-rise [animation-delay:120ms]">
                <p className="mt-4 max-w-xl text-pretty text-body-lg text-muted-foreground">
                  Tell us what&rsquo;s wrong. You&rsquo;ll see the price and who
                  is coming before anyone sets off.
                </p>
                <p
                  className="mt-1 text-body-md text-muted-foreground"
                  lang="ne"
                >
                  {site.taglineNe}
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
              {TRUST_ITEMS.map(({ Icon, label, detail }) => (
                <li key={label} className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon aria-hidden="true" className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-body-sm font-semibold leading-tight">
                      {label}
                    </p>
                    <p className="mt-0.5 text-caption text-muted-foreground">
                      {detail}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ---------------- categories ---------------- */}
        <Section id="services">
          <Reveal>
            <SectionHeading
              eyebrow="Services"
              title="Ten trades, one number to call"
              lead="Every category is staffed by professionals we've checked ourselves, with published rates so you know the cost before you book."
            />
          </Reveal>

          <ul className="mt-10 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
            {SERVICE_CATEGORIES.map(({ slug, name, descriptor, Icon }, i) => (
              <li key={slug}>
                <Reveal delay={Math.min(i * 0.03, 0.24)}>
                  <Card className="group h-full transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md">
                    <Link
                      href={`/services/${slug}`}
                      className="flex h-full flex-col gap-2 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <span className="grid size-10 place-items-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                      <span className="mt-1 text-body-sm font-semibold leading-snug">
                        {name}
                      </span>
                      <span className="text-caption text-muted-foreground">
                        {descriptor}
                      </span>
                    </Link>
                  </Card>
                </Reveal>
              </li>
            ))}
          </ul>
        </Section>

        {/* ---------------- how it works ---------------- */}
        <Section
          id="how-it-works"
          className="border-y border-border bg-card/60"
        >
          <Reveal>
            <SectionHeading
              eyebrow="How it works"
              title="Four steps, no phone tag"
              lead="The part most people worry about — what it will cost — is settled before anyone is dispatched."
            />
          </Reveal>

          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <Reveal delay={i * 0.06} className="h-full">
                  <div className="relative h-full border-t border-border pt-5">
                    <span
                      aria-hidden="true"
                      className="absolute -top-4 grid size-8 place-items-center rounded-full bg-gold font-display text-body-sm font-bold tabular-nums text-gold-foreground"
                    >
                      {i + 1}
                    </span>
                    <h3 className="mt-3 font-display text-lg font-semibold">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 text-pretty text-body-sm text-muted-foreground">
                      {step.body}
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
                    For Professionals
                  </p>
                  <h2 className="mt-2 text-balance font-display text-display-sm">
                    Steady work, paid out weekly.
                  </h2>
                  <p className="mt-3 text-pretty text-body-md text-primary-foreground/85">
                    Get jobs near you without chasing customers or haggling over
                    rates. You set your hours, we handle the booking, the price
                    and the payment.
                  </p>
                  <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-body-sm text-primary-foreground/85">
                    <li className="flex items-center gap-2">
                      <HandCoins aria-hidden="true" className="size-4" />
                      Weekly payouts
                    </li>
                    <li className="flex items-center gap-2">
                      <Timer aria-hidden="true" className="size-4" />
                      Choose your own hours
                    </li>
                    <li className="flex items-center gap-2">
                      <BadgeCheck aria-hidden="true" className="size-4" />
                      Free verification
                    </li>
                  </ul>
                </div>
                <div className="lg:ml-auto">
                  <Button variant="gold" size="lg" asChild>
                    <Link href="/providers/join">
                      Join as a professional
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
            <SectionHeading
              eyebrow="Questions"
              title="What people ask before their first booking"
            />
          </Reveal>

          <Reveal delay={0.05} className="mt-8 max-w-3xl">
            <Accordion type="single" collapsible>
              {FAQS.map((faq) => (
                <AccordionItem key={faq.q} value={faq.q}>
                  <AccordionTrigger>{faq.q}</AccordionTrigger>
                  <AccordionContent>{faq.a}</AccordionContent>
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
