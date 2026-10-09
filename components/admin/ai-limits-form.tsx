"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiLimits } from "@/lib/config/ai-limits";

/**
 * Twelve numbers, each with the bounds it is held to.
 *
 * THE BOUNDS ARE PRINTED BESIDE EVERY FIELD, which is the whole reason this is a
 * component rather than a bare form. The database refuses a value outside them and
 * `clampLimit` moves one that slips through — so without the range on screen, the only
 * way to discover that 50 is the most visitors may have is to try 51 and be quietly
 * given 50. A clamp nobody can see is a clamp that reads as a bug.
 *
 * NOTHING IS PRE-FILLED AS A PLACEHOLDER. Every field carries its current value, so
 * saving without touching anything changes nothing — `saveAiLimits` compares each number
 * against what is stored and writes only what moved, and the audit row says what moved
 * rather than snapshotting the lot.
 */
export function AiLimitsForm({
  limits,
  bounds,
  keys,
}: {
  limits: AiLimits;
  bounds: Record<keyof AiLimits, { min: number; max: number }>;
  keys: (keyof AiLimits)[];
}) {
  const t = useTranslations("admin.aiLimits");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  async function submit(data: FormData) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const { saveAiLimitsAction } = await import(
        "@/app/[locale]/(admin)/admin/ai-limits/actions"
      );
      const result = await saveAiLimitsAction(data);
      if (result.ok) setSaved(true);
      else setError(result.error);
    } catch {
      setError("saveFailed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className="mt-6 rounded-xl border border-border bg-card p-4">
      <h2 className="text-body-sm font-semibold text-foreground">{t("formTitle")}</h2>
      {/* The sentence that stops somebody treating this as a settings page. Every field
          below changes what the product spends or what a person is allowed to ask. */}
      <p className="text-caption mt-1 text-muted-foreground">{t("formLead")}</p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {keys.map((key) => (
          <div key={key}>
            <Label htmlFor={key}>{t(`field.${key}`)}</Label>
            <Input
              id={key}
              name={key}
              type="number"
              step="any"
              min={bounds[key].min}
              max={bounds[key].max}
              defaultValue={String(limits[key])}
              disabled={busy}
            />
            <p className="text-caption mt-1 text-muted-foreground">
              {t("range", {
                min: String(bounds[key].min),
                max: String(bounds[key].max),
              })}
            </p>
          </div>
        ))}
      </div>

      {error ? (
        <p role="alert" className="text-caption mt-3 text-destructive-ink">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-caption mt-3 text-foreground">
          {t("saved")}
        </p>
      ) : null}

      <Button type="submit" className="mt-4" disabled={busy}>
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
        {t("save")}
      </Button>
    </form>
  );
}
