"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "Yes, I will be there" — one tap, and it is the whole anti-fraud mechanism.
 *
 * WHAT IT COSTS THE TWO PEOPLE IT SEPARATES. A real customer just tapped Book
 * and is holding the phone: this is one more tap, on a screen already open, and
 * it takes a second. A script that fired twenty bookings at fake addresses and
 * walked away cannot do it at all — not because we detected anything, but
 * because nobody is there to tap. No fraud model, no scoring, nothing to tune.
 *
 * A PASSIVE TIMER WOULD PROTECT NOTHING. "We dispatch unless you say no in five
 * minutes" is answered identically by a real customer and by nobody at all.
 * The confirmation has to be something a person actively does.
 *
 * IT IS NEVER A REFUSAL, AND THE COPY CARRIES THAT. The screen does not say
 * "verify yourself"; it says somebody is about to ride across town, please
 * confirm you are there. That is true, it is the actual reason, and it is the
 * version a frightened person at 2am can act on. For an emergency the phone
 * number sits right beside the button, because a call reaches a person faster
 * than a tap reaches a dispatcher.
 */

export type ConfirmTripProps = {
  bookingId: string;
  isEmergency: boolean;
  supportPhone: string;
  confirm: (bookingId: string) => Promise<{ ok: boolean }>;
};

export function ConfirmTrip(props: ConfirmTripProps) {
  const t = useTranslations("booking.confirmTrip");
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await props.confirm(props.bookingId);
      if (result.ok) setDone(true);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="animate-rise mt-6 rounded-lg border border-primary/40 bg-primary/5 p-5">
        <p className="flex items-center gap-2 text-body-md">
          <CheckCircle2 aria-hidden="true" className="size-5 shrink-0 text-primary" />
          {t("confirmedTitle")}
        </p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("confirmedBody")}
        </p>
      </section>
    );
  }

  return (
    <section className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-5">
      <h2 className="font-display text-heading-sm">{t("title")}</h2>
      <p className="mt-2 text-body-md text-muted-foreground">{t("body")}</p>

      <Button
        type="button"
        onClick={() => void confirm()}
        disabled={busy}
        className="btn-tactile mt-4 h-12 w-full text-body-lg sm:w-auto sm:px-8"
      >
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {t("confirm")}
      </Button>

      {/* An emergency gets more ways to answer, never fewer. */}
      {props.isEmergency ? (
        <Button
          variant="outline"
          className="btn-tactile mt-2 h-12 w-full sm:ml-2 sm:mt-4 sm:w-auto"
          asChild
        >
          <a href={`tel:${props.supportPhone}`}>
            <Phone aria-hidden="true" />
            {t("callInstead")}
          </a>
        </Button>
      ) : null}

      {failed ? (
        <p className="animate-rise mt-3 text-body-sm text-destructive" role="alert">
          {t("failed")}
        </p>
      ) : null}
    </section>
  );
}
