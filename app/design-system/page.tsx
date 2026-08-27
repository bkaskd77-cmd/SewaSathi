import { BadgeCheck, Clock, Star } from "lucide-react";

import { BookingDialog } from "@/components/shared/booking-dialog";
import { FadeIn } from "@/components/shared/fade-in";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { hasAnthropicConfig } from "@/lib/ai";
import { hasSupabaseConfig } from "@/lib/env";
import { formatNpr } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Internal design-system reference.
 *
 * Every primitive rendered against real SajiloKaam content rather than "Lorem"
 * and a grid of grey boxes, so we can judge whether the identity survives
 * contact with an actual provider card. Not linked from the marketing site —
 * it exists for us, and for the contrast pass every new component gets.
 */

export const metadata = { title: "Design system", robots: { index: false } };

function Section({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("mt-14", className)}>
      <h2 className="mb-4 border-b border-border pb-2 text-overline uppercase text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

export default function Home() {
  const supabaseReady = hasSupabaseConfig();
  const anthropicReady = hasAnthropicConfig();

  return (
    <main className="relative min-h-dvh">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-gradient-to-b from-gold/[0.16] to-transparent"
      />

      <div className="container relative max-w-3xl py-14 sm:py-20">
        <FadeIn className="mb-10 flex items-center justify-between gap-4">
          <span className="text-overline uppercase text-muted-foreground">
            Design system
          </span>
          <ThemeToggle />
        </FadeIn>

        <FadeIn delay={0.05}>
          <h1 className="text-balance font-display text-display-lg sm:text-display-xl">
            Sajilo<span className="text-gold-ink">Kaam</span>
          </h1>
          <p className="mt-3 text-pretty text-body-lg text-muted-foreground">
            Deep emerald carries trust, warm gold marks the one action that
            commits you, burnt orange means hurry. Every primitive below reads
            from the same tokens.
          </p>
          <p className="mt-1 text-body-md text-muted-foreground" lang="ne">
            नेपालका लागि घरायसी सेवा।
          </p>
        </FadeIn>

        {/* --- the component that matters most: a provider ------------ */}
        <Section label="Provider card">
          <FadeIn delay={0.1}>
            <Card>
              <CardHeader className="flex-row items-center gap-4 space-y-0">
                <span
                  aria-hidden="true"
                  className="grid size-12 shrink-0 place-items-center rounded-lg bg-primary font-display text-lg font-bold text-primary-foreground"
                >
                  RT
                </span>
                <div className="min-w-0">
                  <CardTitle className="truncate">Ramesh Tamang</CardTitle>
                  <CardDescription>Plumber · Lalitpur, Ward 4</CardDescription>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="verified">
                    <BadgeCheck aria-hidden="true" />
                    ID verified
                  </Badge>
                  <Badge variant="info">98% completion</Badge>
                  <Badge variant="urgent">
                    <Clock aria-hidden="true" />
                    Available now
                  </Badge>
                </div>

                <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border pt-4">
                  {[
                    { k: "Rating", v: "4.8", icon: true },
                    { k: "Jobs done", v: "212" },
                    { k: "Responds in", v: "~12 min" },
                  ].map((stat) => (
                    <div key={stat.k}>
                      <dt className="text-overline uppercase text-muted-foreground">
                        {stat.k}
                      </dt>
                      <dd className="mt-0.5 flex items-center gap-1 font-display text-lg font-semibold tabular-nums">
                        {stat.icon ? (
                          <Star
                            aria-hidden="true"
                            className="size-4 fill-gold text-gold"
                          />
                        ) : null}
                        {stat.v}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>

              <CardFooter className="flex-wrap">
                <BookingDialog />
                <Button variant="outline">View profile</Button>
                <p className="ml-auto font-display text-lg font-bold tabular-nums">
                  {formatNpr(1200)}
                  <span className="block text-right text-overline font-normal uppercase text-muted-foreground">
                    from
                  </span>
                </p>
              </CardFooter>
            </Card>
          </FadeIn>
        </Section>

        {/* --- primitives --------------------------------------------- */}
        <Section label="Buttons">
          <FadeIn delay={0.05} className="flex flex-wrap items-center gap-3">
            <Button variant="gold" size="lg">
              Book now
            </Button>
            <Button>Confirm</Button>
            <Button variant="outline">View profile</Button>
            <Button variant="secondary">Reschedule</Button>
            <Button variant="ghost">Cancel</Button>
            <Button variant="link">Terms</Button>
            <Button disabled>Unavailable</Button>
          </FadeIn>
        </Section>

        <Section label="Badges">
          <FadeIn delay={0.05} className="flex flex-wrap items-center gap-2">
            <Badge variant="verified">
              <BadgeCheck aria-hidden="true" />
              ID verified
            </Badge>
            <Badge variant="urgent">Emergency</Badge>
            <Badge variant="info">Scheduled · 2–4 pm</Badge>
            <Badge>Top rated</Badge>
            <Badge variant="gold">New</Badge>
            <Badge variant="gold-subtle">Premium</Badge>
            <Badge variant="outline">Carpentry</Badge>
            <Badge variant="muted">Draft</Badge>
          </FadeIn>
        </Section>

        <Section label="Inputs">
          <FadeIn delay={0.05} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="phone">Mobile number</Label>
              <Input id="phone" type="tel" placeholder="98XXXXXXXX" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="landmark">Nearest landmark</Label>
              <Input id="landmark" placeholder="e.g. Patan Durbar Square" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="otp">Verification code</Label>
              <Input
                id="otp"
                defaultValue="1234"
                aria-invalid="true"
                aria-describedby="otp-error"
              />
              <p id="otp-error" className="text-caption text-destructive">
                That code has expired. Request a new one.
              </p>
            </div>
          </FadeIn>
        </Section>

        {/* --- wiring ------------------------------------------------- */}
        <Section label="Service wiring">
          <FadeIn delay={0.05}>
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {[
                  { label: "Supabase (URL + anon key)", ready: supabaseReady },
                  {
                    label: "Anthropic (Claude API key)",
                    ready: anthropicReady,
                  },
                ].map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center gap-3 px-5 py-3.5"
                  >
                    <span className="text-body-sm">{row.label}</span>
                    <Badge
                      variant={row.ready ? "verified" : "muted"}
                      className="ml-auto"
                    >
                      {row.ready ? "connected" : "awaiting keys"}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </FadeIn>
        </Section>
      </div>
    </main>
  );
}
