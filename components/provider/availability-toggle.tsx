"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "I am free now", and the sentence that says when it stops being true.
 *
 * THE EXPIRY IS SHOWN, NOT HIDDEN. A switch whose effect quietly ends is a
 * switch people stop trusting — and the first thing they do when they cannot
 * tell whether it is on is leave it on for ever, which is exactly the
 * behaviour the decay exists to prevent. So the button says how long is left,
 * in words, and turning it on again is one tap.
 *
 * The remaining minutes come from the server render and are not counted down
 * in the browser. A ticking number would be a timer running on every provider
 * screen to restate something that is accurate to the minute anyway.
 */
export function AvailabilityToggle({
  on,
  minutesLeft,
}: {
  on: boolean;
  minutesLeft: number | null;
}) {
  const t = useTranslations("provider.dashboard.availability");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { setAvailabilityAction } = await import(
        "@/app/[locale]/(work)/provider/actions"
      );
      const result = await setAvailabilityAction(!on);
      if (!result.ok) setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const hours = minutesLeft != null ? Math.floor(minutesLeft / 60) : 0;
  const mins = minutesLeft != null ? minutesLeft % 60 : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant={on ? "default" : "outline"}
          size="sm"
          onClick={() => void toggle()}
          disabled={busy}
          aria-pressed={on}
        >
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {on ? t("onLabel") : t("offLabel")}
        </Button>

        <p className="text-caption text-muted-foreground">
          {on && minutesLeft != null
            ? t("until", { hours: String(hours), minutes: String(mins) })
            : t("explain")}
        </p>
      </div>

      {failed ? (
        <p role="alert" className="text-caption mt-2 text-destructive-ink">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
