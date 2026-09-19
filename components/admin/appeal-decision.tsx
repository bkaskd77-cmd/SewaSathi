"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Result = { ok: boolean; reason?: string } | null;

const KNOWN = [
  "alreadyResolved",
  "notAdmin",
  "notConfigured",
  "notFound",
  "reasonRequired",
] as const;

/**
 * Waive the commission floor on one job, or leave it.
 *
 * WHAT IS BEING DECIDED. The fee is charged on `max(final_amount, quoted_min)`,
 * which is what makes under-reporting pointless and occasionally lands on a job
 * that genuinely was a five-minute washer. Upholding waives the floor for this
 * booking and recomputes the split against the rate frozen at settlement.
 *
 * ONE JOB AT A TIME, AND NEVER A JUDGEMENT ABOUT A PERSON. A whole category
 * bunching under its floor is OUR mispricing, which is what
 * `category_pricing_signals` counts — per category, deliberately never per
 * professional, because read the other way it becomes a list of people to
 * punish for a price we set.
 */
export function AppealDecision({ appealId }: { appealId: string }) {
  const t = useTranslations("admin.appeals");
  const [result, action] = useFormState(resolve, null);

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="appealId" value={appealId} />

      <div className="space-y-1.5">
        <Label htmlFor={`note-${appealId}`}>{t("note")}</Label>
        <textarea
          id={`note-${appealId}`}
          name="note"
          rows={2}
          required
          minLength={3}
          className="w-full rounded-md border border-input bg-background p-3 text-body-md"
        />
      </div>

      {result && !result.ok ? (
        <p
          role="alert"
          className="animate-pop-in text-body-sm text-destructive-ink"
        >
          {t(
            `errors.${
              (KNOWN as readonly string[]).includes(result.reason ?? "")
                ? result.reason
                : "saveFailed"
            }`,
          )}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Send label={t("uphold")} value="uphold" primary />
        <Send label={t("refuse")} value="refuse" />
      </div>
    </form>
  );
}

function Send({
  label,
  value,
  primary,
}: {
  label: string;
  value: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="verdict"
      value={value}
      variant={primary ? "default" : "outline"}
      className="btn-tactile"
      disabled={pending}
    >
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}

/** Bound at call time so the component stays a plain client component. */
async function resolve(_previous: Result, formData: FormData): Promise<Result> {
  const { resolveAppealAction } = await import(
    "@/app/[locale]/(app)/admin/appeals/actions"
  );
  return resolveAppealAction(formData);
}
