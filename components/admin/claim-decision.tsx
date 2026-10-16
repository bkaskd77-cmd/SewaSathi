"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

import { isReauthReason, ReauthNotice } from "@/components/admin/reauth-notice";

import { useSecondsOnEvidence } from "./use-seconds-on-evidence";

type Result = { ok: boolean; reason?: string } | null;

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
  const [result, action] = useFormState(decide, null);

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

      {result && !result.ok ? (
        isReauthReason(result.reason) ? (
          <ReauthNotice />
        ) : (
          <p
            role="alert"
            className="animate-pop-in text-body-sm text-destructive-ink"
          >
            {t("errors.saveFailed")}
          </p>
        )
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
async function decide(
  _previous: Result,
  formData: FormData,
): Promise<Result> {
  const { decideClaimAction } = await import(
    "@/app/[locale]/(admin)/admin/claims/actions"
  );
  return decideClaimAction(formData);
}
