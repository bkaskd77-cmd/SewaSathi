"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { useSecondsOnEvidence } from "./use-seconds-on-evidence";

/**
 * Uphold or refuse one wasted-trip claim.
 *
 * WHAT IS BEING DECIDED IS WHO CARRIES THE Rs 350, not whether the
 * professional gets paid — that is settled by the evidence above, and on the
 * common path it has already happened. The buttons say "uphold — pay the trip"
 * rather than "approve" so the reviewer is never confused about which of those
 * two questions is in front of them.
 *
 * The time on evidence rides along, same as the application review. It gates
 * nothing.
 */

export function ClaimDecision({ bookingId }: { bookingId: string }) {
  const t = useTranslations("admin.claims");
  const seconds = useSecondsOnEvidence();
  const [, action] = useFormState(decide, null);

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="secondsOnEvidence" value={seconds()} />

      <div className="space-y-1.5">
        <Label htmlFor={`reason-${bookingId}`}>{t("reason")}</Label>
        <textarea
          id={`reason-${bookingId}`}
          name="reason"
          rows={2}
          required
          minLength={5}
          className="w-full rounded-md border border-input bg-background p-3 text-body-md"
        />
      </div>

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
async function decide(
  _previous: { ok: boolean } | null,
  formData: FormData,
): Promise<{ ok: boolean }> {
  const { decideClaimAction } = await import(
    "@/app/[locale]/(app)/admin/claims/actions"
  );
  return decideClaimAction(formData);
}
