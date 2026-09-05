"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Phone, ShieldCheck, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Link, useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * "Your professional pulled out. Here are three who can do it."
 *
 * The whole point of this screen. A withdrawal used to leave the customer on a
 * page that said "we are looking" and gave them one button that mostly
 * reported nothing had changed — which is a product telling somebody to wait
 * without telling them what for. Waiting is not a service. A choice is.
 *
 * Three suggestions, not a list: this is read on a phone by somebody who has
 * already made this decision once today and does not want to make it again
 * from scratch. Each one is one tap to book, and the tap assigns them
 * immediately — no going back through the booking flow, because everything
 * else about the job (the problem, the address, the time, the quote) has not
 * changed and asking again would be asking them to re-earn what they already
 * gave us.
 *
 * WHEN THERE IS NOBODY, IT SAYS SO AND HANDS OVER A PHONE NUMBER. An empty
 * list with an encouraging sentence is the worst possible answer: it leaves
 * somebody refreshing a screen while their bathroom floods. We would rather
 * spend a support call than lose the customer to a number in a shop window.
 */

export type AlternativeOption = {
  id: string;
  name: string;
  photoUrl: string | null;
  verified: boolean;
  reach: "ward" | "city" | "anywhere";
  /** Pre-formatted, because numerals are a locale decision. */
  ratingLabel: string;
  jobsLabel: string;
  rateLabel: string;
  availability: "now" | "today" | "scheduled";
};

/** Reasons the customer gets a real sentence for. Anything else is ours. */
const KNOWN = [
  "alreadyAssigned",
  "alreadyRefused",
  "notWaiting",
  "providerUnavailable",
] as const;

export function Alternatives({
  bookingId,
  options,
  categoryHref,
  supportPhone,
}: {
  bookingId: string;
  options: AlternativeOption[];
  /** Back to the full directory, for somebody who wants to choose properly. */
  categoryHref: string;
  supportPhone: string;
}) {
  const t = useTranslations("booking.alternatives");
  const router = useRouter();

  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const choose = (providerId: string) => {
    if (busyId) return;
    setBusyId(providerId);
    setError(null);
    void (async () => {
      try {
        const { chooseProviderAction } = await import(
          "@/app/[locale]/(app)/bookings/[id]/actions"
        );
        const result = await chooseProviderAction(bookingId, providerId);
        // The action revalidates this route, so its response already carries
        // the re-rendered page. A refresh() here would be a second round trip
        // for the same screen — see the note in provider/job-card.tsx.
        if (result.ok) return;
        setError(result.reason ?? "failed");
        // The two refusals that mean the screen is out of date rather than
        // that the customer did something wrong: somebody took the job, or it
        // has moved on. Re-read the page so the sentence they see next is the
        // truth instead of a stale list of people they can no longer book.
        if (result.reason === "alreadyAssigned" || result.reason === "notWaiting") {
          router.refresh();
        }
      } catch {
        setError("failed");
      } finally {
        setBusyId(null);
      }
    })();
  };

  if (options.length === 0) {
    return (
      <section className="animate-pop-in mt-6 rounded-xl border border-border bg-muted/30 p-4">
        <h2 className="text-body-md font-semibold">{t("none.title")}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("none.body")}
        </p>
        <Button className="btn-tactile btn-beacon mt-3" asChild>
          <a href={`tel:${supportPhone}`}>
            <Phone aria-hidden="true" />
            {t("none.call", { phone: supportPhone })}
          </a>
        </Button>
      </section>
    );
  }

  return (
    <section className="animate-pop-in mt-6 rounded-xl border border-gold/40 bg-gold/[0.06] p-4">
      <h2 className="text-body-md font-semibold">{t("heading")}</h2>
      <p className="mt-1 text-body-sm text-muted-foreground">{t("body")}</p>

      <ul className="assemble mt-4 space-y-3">
        {options.map((option, i) => (
          <li
            key={option.id}
            style={{ ["--i" as string]: i }}
            className="rounded-lg border border-border bg-background p-3"
          >
            <div className="flex items-start gap-3">
              {option.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- seeded remote avatars; next/image would need every host allow-listed.
                <img
                  src={option.photoUrl}
                  alt=""
                  className="size-11 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-body-sm font-semibold"
                >
                  {option.name.slice(0, 1)}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-body-md font-semibold">
                  <span className="truncate">{option.name}</span>
                  {option.verified ? (
                    <ShieldCheck
                      aria-label={t("verified")}
                      className="size-3.5 shrink-0 text-primary"
                    />
                  ) : null}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <Star aria-hidden="true" className="size-3" />
                    <span className="tabular-nums">{option.ratingLabel}</span>
                  </span>
                  <span className="tabular-nums">{option.jobsLabel}</span>
                  <span className="tabular-nums">{option.rateLabel}</span>
                </p>
                {/* How far they are reaching, said out loud. A suggestion from
                    the next city is still a good suggestion — but only if the
                    customer knows that is what it is before they tap. */}
                <p
                  className={cn(
                    "mt-1 text-caption",
                    option.reach === "ward"
                      ? "text-success-ink"
                      : "text-muted-foreground",
                  )}
                >
                  {t(`reach.${option.reach}`)} ·{" "}
                  {t(`availability.${option.availability}`)}
                </p>
              </div>
            </div>

            <Button
              size="sm"
              className={cn("btn-tactile mt-3 w-full", i === 0 && "btn-beacon")}
              onClick={() => choose(option.id)}
              disabled={busyId !== null}
            >
              {busyId === option.id ? (
                <Loader2 aria-hidden="true" className="animate-spin" />
              ) : null}
              {t("choose", { name: option.name })}
            </Button>
          </li>
        ))}
      </ul>

      {error ? (
        <p
          role="alert"
          className="animate-pop-in mt-3 text-caption text-destructive-ink"
        >
          {t(
            (KNOWN as readonly string[]).includes(error)
              ? `errors.${error}`
              : "errors.failed",
          )}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={categoryHref}>{t("browseAll")}</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <a href={`tel:${supportPhone}`}>
            <Phone aria-hidden="true" />
            {t("callInstead")}
          </a>
        </Button>
      </div>
    </section>
  );
}
