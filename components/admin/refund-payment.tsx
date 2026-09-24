"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = { ok: boolean; reason?: string } | null;

/**
 * Reasons this screen has a sentence for.
 *
 * An allow-list rather than an interpolated key, the same rule the correction
 * panel follows: next-intl renders a miss as its own dotted path, so a reason
 * without copy would print `admin.guaranteeClaims.errors.x` onto a money
 * screen. `gatewaySaidNo` and `noAnswer` are deliberately different sentences
 * — one is a refusal we can act on, the other means the money may already have
 * left and nobody should press the button again without looking.
 */
const KNOWN = [
  "alreadyPaid",
  "badDate",
  "cashByHand",
  "esewaHasNoApi",
  "futureDate",
  "gatewayNotConfigured",
  "gatewaySaidNo",
  "manualOnly",
  "noAnswer",
  "noGatewayReference",
  "notAdmin",
  "notConfigured",
  "notFound",
  "referenceRequired",
  "saveFailed",
] as const;

const errorKey = (reason: string | undefined) =>
  (KNOWN as readonly string[]).includes(reason ?? "") ? reason! : "saveFailed";

/**
 * "This money has actually gone" — the second of the two steps.
 *
 * WHY THIS SCREEN EXISTS AT ALL. Approving a refund and sending it are two
 * events, because two of our three rails cannot move money from inside this
 * product: eSewa has no merchant-initiated refund on ePay v2, and cash comes
 * back the way it went out. Recording both with one button would have the
 * product tell a customer their money was sent by somebody who has not sent
 * it — and remove the only thing that would ever remind us to.
 *
 * THE REFERENCE IS REQUIRED AND IT IS THE POINT. It is what lets "I never got
 * it" be answered rather than argued with, and what tells the next reviewer
 * this has already gone.
 *
 * THE DATE IS A FIELD, NOT `now()`. Somebody recording a bank transfer on
 * Monday that went on Friday should be able to say Friday. A future date is
 * refused: money that has not moved is a refund still waiting, and recording
 * it as sent tomorrow would take it off this queue today.
 */
export function RefundPayment({
  refundId,
  automatic,
}: {
  refundId: string;
  /** Khalti with a live secret. Everything else is a person and a reference. */
  automatic: boolean;
}) {
  const t = useTranslations("admin.guaranteeClaims");
  const [result, action] = useFormState(record, null);
  const [sendResult, sendAction] = useFormState(send, null);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mt-4 space-y-3">
      {automatic ? (
        <form action={sendAction} className="space-y-2">
          <input type="hidden" name="refundId" value={refundId} />
          {/* The rail sentence is rendered by the page, immediately above.
              A second copy here would be the same words from two keys, which
              drift apart the first time either is edited. */}
          {sendResult && !sendResult.ok ? (
            <p
              role="alert"
              className="animate-pop-in text-body-sm text-destructive-ink"
            >
              {t(`errors.${errorKey(sendResult.reason)}`)}
            </p>
          ) : null}
          <Submit label={t("sendNow")} primary icon />
        </form>
      ) : null}

      <form action={action} className="space-y-3">
        <input type="hidden" name="refundId" value={refundId} />

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`ref-${refundId}`}>{t("reference")}</Label>
            <Input
              id={`ref-${refundId}`}
              name="reference"
              required
              minLength={3}
              maxLength={200}
              placeholder={t("referencePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`paid-${refundId}`}>{t("paidOn")}</Label>
            <Input
              id={`paid-${refundId}`}
              name="paidAt"
              type="date"
              required
              max={today}
              defaultValue={today}
            />
          </div>
        </div>

        {result && !result.ok ? (
          <p
            role="alert"
            className="animate-pop-in text-body-sm text-destructive-ink"
          >
            {t(`errors.${errorKey(result.reason)}`)}
          </p>
        ) : null}

        <Submit label={t("markPaid")} primary={!automatic} />
      </form>
    </div>
  );
}

function Submit({
  label,
  primary,
  icon,
}: {
  label: string;
  primary?: boolean;
  icon?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="sm"
      variant={primary ? "default" : "outline"}
      className="btn-tactile"
      disabled={pending}
    >
      {pending ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : icon ? (
        <Send aria-hidden="true" className="size-4" />
      ) : null}
      {label}
    </Button>
  );
}

/** Bound at call time so these stay plain client components. */
async function record(_previous: Result, formData: FormData): Promise<Result> {
  const { markRefundPaidAction } = await import(
    "@/app/[locale]/(app)/admin/guarantee-claims/actions"
  );
  return markRefundPaidAction(formData);
}

async function send(_previous: Result, formData: FormData): Promise<Result> {
  const { sendRefundAction } = await import(
    "@/app/[locale]/(app)/admin/guarantee-claims/actions"
  );
  return sendRefundAction(formData);
}
