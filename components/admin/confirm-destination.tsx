"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * "I have looked at this, and the first payment may go."
 *
 * ONE BUTTON AND NOTHING ELSE ON THE WIRE. The destination id is the whole
 * payload; who confirmed it comes from the session, and the trigger refuses a
 * second confirmation outright. A form carrying the account, the name or the
 * admin's id would be a browser asserting any of them.
 *
 * NO CONFIRMATION DIALOG. The act is itself the check — a reviewer who has read
 * the row and pressed the button has done the thing an "are you sure" would be
 * asking about, and a second tap is what teaches people to tap through
 * approvals, which `lib/payments/pricing.ts` already refuses to do to customers.
 */
export function ConfirmDestination({
  destinationId,
  action,
}: {
  destinationId: string;
  action: (data: FormData) => Promise<{ ok: boolean; reason?: string }>;
}) {
  const t = useTranslations("admin.payoutDestinations");
  const [result, setResult] = React.useState<{
    ok: boolean;
    reason?: string;
  } | null>(null);

  return (
    <form
      action={async (data) => setResult(await action(data))}
      className="mt-3"
    >
      <input type="hidden" name="destinationId" value={destinationId} />
      {result?.ok ? (
        <p className="animate-rise flex items-center gap-1.5 text-body-sm text-success-ink">
          <Check className="size-4" aria-hidden />
          {t("confirmed")}
        </p>
      ) : (
        <>
          <ConfirmButton />
          {result && !result.ok ? (
            <p
              role="alert"
              className="animate-rise mt-2 text-body-sm text-destructive-ink"
            >
              {t(`errors.${result.reason}` as "errors.generic")}
            </p>
          ) : null}
        </>
      )}
    </form>
  );
}

function ConfirmButton() {
  const t = useTranslations("admin.payoutDestinations");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("confirming")}
        </>
      ) : (
        t("confirm")
      )}
    </Button>
  );
}
