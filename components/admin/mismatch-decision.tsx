"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = { ok: boolean; reason?: string } | null;

const KNOWN = [
  "alreadyResolved",
  "blocked",
  "noChoice",
  "noCustomerFigure",
  "noFigure",
  "noMismatch",
  "noPayment",
  "notAdmin",
  "notANumber",
  "notConfigured",
  "notFound",
  "notSurveyed",
  "reasonRequired",
  "tooLow",
] as const;

/**
 * Settle one cash job whose two figures disagree.
 *
 * THREE BUTTONS, NOT A DROPDOWN AND A SUBMIT. Each is the whole decision: the
 * customer's figure, the professional's, or a third. A select plus a confirm
 * would let somebody change the choice and press a button that still says what
 * the old one did, and this is a screen where the wrong press moves money.
 *
 * THE TWO PARTY FIGURES SEND NO AMOUNT. They are already on the booking, and
 * the server re-reads them — a form posting "the customer said 9,000" would be
 * a browser setting a price. Only the third figure is typed, and only it needs
 * a reason.
 *
 * THE REASON IS ONLY REQUIRED WHERE IT MEANS SOMETHING. Demanding one for
 * "take the customer's number" teaches people to type a full stop, and a field
 * everybody defeats is worse than no field. It is `required` on the third form
 * because there it is the entire justification for a figure neither party
 * named.
 */
export function MismatchDecision({
  bookingId,
  recordedLabel,
  reportedLabel,
  canTakeReported,
}: {
  bookingId: string;
  recordedLabel: string;
  reportedLabel: string;
  /** False when the customer never typed a figure — nothing to take. */
  canTakeReported: boolean;
}) {
  const t = useTranslations("admin.mismatches");
  const [result, action] = useFormState(resolve, null);

  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="bookingId" value={bookingId} />

      <div className="flex flex-wrap gap-2">
        {canTakeReported ? (
          <Send
            label={t("takeReported", { amount: reportedLabel })}
            source="customer"
          />
        ) : null}
        <Send label={t("takeRecorded", { amount: recordedLabel })} source="provider" />
      </div>

      <div className="rounded-md border border-border p-3">
        <p className="text-body-sm text-muted-foreground">{t("thirdLead")}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,10rem)_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor={`amount-${bookingId}`}>{t("thirdAmount")}</Label>
            <Input
              id={`amount-${bookingId}`}
              name="amount"
              type="number"
              inputMode="numeric"
              min={100}
              step={1}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`note-${bookingId}`}>{t("thirdNote")}</Label>
            <Input id={`note-${bookingId}`} name="note" minLength={3} />
          </div>
        </div>

        <div className="mt-3">
          <Send label={t("takeThird")} source="adjudicated" outline />
        </div>
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
    </form>
  );
}

function Send({
  label,
  source,
  outline,
}: {
  label: string;
  source: string;
  outline?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="source"
      value={source}
      variant={outline ? "outline" : "default"}
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
  const { resolveMismatchAction } = await import(
    "@/app/[locale]/(admin)/admin/mismatches/actions"
  );
  return resolveMismatchAction(formData);
}
