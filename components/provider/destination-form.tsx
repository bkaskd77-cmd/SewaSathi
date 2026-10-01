"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Changing where the money goes.
 *
 * THE WAIT IS STATED BEFORE THEY TYPE, not after they submit. A form that
 * accepts a new account and then reveals a three-day delay reads as the product
 * having taken something away; said first, it reads as what it is — the time the
 * real person has to object if it was not them who changed it. Same reasoning as
 * `RateField` putting the band on screen before the figure is moved.
 *
 * NOTHING HERE ENFORCES ANYTHING. The method list, the required fields and the
 * shape of an account are a convenience; `changeDestination` re-reads the
 * session, refuses a stale one and seals before it writes. A rule enforced only
 * in the browser is a rule enforced nowhere, and this one stands between a
 * stolen session and somebody's earnings.
 */
export function DestinationForm({
  action,
  hasDestination,
}: {
  action: (previous: Result | null, data: FormData) => Promise<Result>;
  hasDestination: boolean;
}) {
  const t = useTranslations("provider.payouts");
  const [state, submit] = useFormState(action, null);
  const [method, setMethod] = React.useState<"bank" | "esewa" | "khalti">("esewa");

  return (
    <form action={submit} className="animate-rise mt-8 space-y-4">
      <div>
        <h2 className="font-display text-heading-sm">
          {hasDestination ? t("changeTitle") : t("noneAction")}
        </h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("changeLead")}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-body-sm font-medium">{t("method")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["esewa", "khalti", "bank"] as const).map((option) => (
            <label
              key={option}
              className={`flex items-center gap-2 rounded-md border p-3 text-body-md transition-colors ${
                method === option ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="kind"
                value={option}
                checked={method === option}
                onChange={() => setMethod(option)}
                className="size-4 accent-primary"
              />
              {t(`methods.${option}` as "methods.esewa")}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor="accountRef">{t("accountLabel")}</Label>
        <Input id="accountRef" name="accountRef" required inputMode="numeric" />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="accountName">{t("nameLabel")}</Label>
        <Input id="accountName" name="accountName" required />
      </div>

      {method === "bank" ? (
        <div className="space-y-1.5">
          <Label htmlFor="bankName">{t("bankLabel")}</Label>
          <Input id="bankName" name="bankName" />
        </div>
      ) : null}

      {state && !state.ok ? (
        <p
          role="alert"
          className="animate-rise rounded-md border border-destructive/40 bg-destructive/5 p-3 text-body-sm text-destructive-ink"
        >
          {t(`errors.${state.error}` as "errors.generic")}
        </p>
      ) : null}

      <SaveButton />
    </form>
  );
}

function SaveButton() {
  const t = useTranslations("provider.payouts");
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("saving")}
        </>
      ) : (
        t("save")
      )}
    </Button>
  );
}
