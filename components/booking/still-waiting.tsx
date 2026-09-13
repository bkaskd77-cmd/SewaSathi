"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Nobody has answered yet, said out loud.
 *
 * THE SILENCE WAS THE BUG. A professional who ignores the notification produced
 * nothing on this screen at all — the job simply sat there, and the replacement
 * chooser only appears when somebody actively refuses. So a customer could not
 * tell "they are on their way to answering" from "nobody has looked at this",
 * and had no way to act on either. An hour of that is an hour in which they
 * open a different app.
 *
 * NOT A WARNING COLOUR AND NOT AN ACCUSATION. The professional may be under a
 * sink with their phone in a van. The sentence says what is true — no answer
 * yet — and offers the customer the thing only they can decide: whether to
 * keep waiting or let anybody take it.
 */
export function StillWaiting({
  bookingId,
  providerName,
}: {
  bookingId: string;
  /** Null once the job is already open to everybody. */
  providerName: string | null;
}) {
  const t = useTranslations("booking.detail.stillWaiting");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function widen() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { widenBookingAction } = await import(
        "@/app/[locale]/(app)/bookings/[id]/actions"
      );
      const result = await widenBookingAction(bookingId);
      if (!result.ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="animate-rise mt-6 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
      <h2 className="text-body-sm flex items-center gap-2 font-semibold text-foreground">
        <Clock aria-hidden="true" className="size-4 text-muted-foreground" />
        {t("title")}
      </h2>

      <p className="text-caption mt-1 text-muted-foreground">
        {providerName ? t("waitingOn", { name: providerName }) : t("open")}
      </p>

      {providerName ? (
        <>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => void widen()}
          >
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("widen")}
          </Button>
          {/* They keep their place in the queue either way: the professional
              they chose can still take it. Saying so is what makes the button
              safe to press. */}
          <p className="text-caption mt-2 text-muted-foreground">
            {t("widenNote", { name: providerName })}
          </p>
        </>
      ) : null}

      {failed ? (
        <p role="alert" className="text-caption mt-2 text-destructive-ink">
          {t("failed")}
        </p>
      ) : null}
    </section>
  );
}
