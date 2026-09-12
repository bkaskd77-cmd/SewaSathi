"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The "from" price on their card, and the band it may not leave.
 *
 * THE BAND IS SHOWN BEFORE THEY TYPE. A field that silently rewrites what
 * somebody entered reads as the form losing their work — so the range is on
 * screen first, and when the figure is moved the screen says so and says which
 * way, rather than showing a different number with no explanation.
 *
 * The clamp is applied on the server, not here. This is the same figure a
 * customer reads as a promise about cost, and a rule enforced only in the
 * browser is a rule enforced nowhere.
 */
export function RateField({
  rate,
  low,
  high,
  currency,
}: {
  rate: number;
  low: number;
  high: number;
  /** "Rs" or "रु", already chosen for the reader's language. */
  currency: string;
}) {
  const t = useTranslations("provider.dashboard.rate");
  const [value, setValue] = React.useState(String(rate));
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<"low" | "high" | "saved" | null>(null);
  const [failed, setFailed] = React.useState(false);

  async function save() {
    if (busy) return;
    const asked = Number(value);
    if (!Number.isFinite(asked) || asked <= 0) {
      setFailed(true);
      return;
    }

    setBusy(true);
    setFailed(false);
    setNote(null);
    try {
      const { setRateAction } = await import(
        "@/app/[locale]/(app)/provider/actions"
      );
      const result = await setRateAction(asked);
      if (result.ok) {
        setValue(String(result.rate));
        setNote(result.clampedTo ?? "saved");
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="provider-rate">{t("label")}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="provider-rate"
          inputMode="numeric"
          className="max-w-[10rem]"
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
        />
        <Button size="sm" variant="outline" onClick={() => void save()} disabled={busy}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {t("save")}
        </Button>
      </div>

      <p className="text-caption text-muted-foreground">
        {t("band", {
          low: `${currency} ${low.toLocaleString("en-US")}`,
          high: `${currency} ${high.toLocaleString("en-US")}`,
        })}
      </p>

      {note ? (
        <p className="animate-rise text-caption text-foreground">
          {t(note === "saved" ? "saved" : `clamped.${note}`)}
        </p>
      ) : null}

      {failed ? (
        <p role="alert" className="text-caption text-destructive-ink">
          {t("failed")}
        </p>
      ) : null}
    </div>
  );
}
