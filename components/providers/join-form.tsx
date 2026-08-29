"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { ArrowRight, CheckCircle2, Phone } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NEPAL_DIAL_CODE } from "@/lib/auth/phone";
import type { LeadResult } from "@/lib/data/provider-leads";
import { cn } from "@/lib/utils";

const selectClass =
  "h-12 w-full rounded-lg border border-input bg-card px-3 text-body-md transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export type JoinAction = (
  previous: LeadResult | null,
  formData: FormData,
) => Promise<LeadResult>;

/**
 * The supply-side form.
 *
 * Five fields and nothing else. Every extra question is a professional who
 * closes the tab, and this is everything needed to have a useful first phone
 * call: who you are, how to reach you, what you do, where, and for how long.
 *
 * A real `<form action={...}>` bound to a server action, so it submits and
 * validates without JavaScript having arrived — which matters more here than
 * anywhere else in the product, because the person filling it in is on a cheap
 * phone on mobile data and is not invested enough to wait.
 */
export function JoinForm({
  action,
  trades,
  areas,
}: {
  action: JoinAction;
  trades: Array<{ value: string; label: string }>;
  areas: Array<{
    city: string;
    options: Array<{ value: string; label: string }>;
  }>;
}) {
  const t = useTranslations("join");
  const tErr = useTranslations("join.errors");
  const [state, formAction] = useFormState<LeadResult | null, FormData>(
    action,
    null,
  );

  if (state?.ok) {
    return (
      <div
        role="status"
        className="animate-pop-in rounded-xl border border-success/30 bg-success/[0.07] p-6 text-center"
      >
        <CheckCircle2
          aria-hidden="true"
          className="mx-auto size-10 text-success-ink"
        />
        <h2 className="mt-3 font-display text-display-sm">
          {t("successTitle")}
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-pretty text-body-md text-muted-foreground">
          {t("successBody")}
        </p>
      </div>
    );
  }

  const errors = state?.ok === false ? state.errors : {};
  const message = (key: string | undefined) => (key ? tErr(key) : null);

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      <div>
        <Label htmlFor="fullName">{t("nameLabel")}</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          placeholder={t("namePlaceholder")}
          className="mt-2 h-12"
          aria-describedby="fullName-error"
          aria-invalid={Boolean(errors.fullName)}
        />
        <FieldError
          id="fullName-error"
          lines={1}
          message={message(errors.fullName)}
        />
      </div>

      <div>
        <Label htmlFor="phone">{t("phoneLabel")}</Label>
        <div
          className={cn(
            "mt-2 flex h-12 items-center rounded-lg border bg-card transition-colors",
            "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
            errors.phone ? "border-destructive" : "border-input",
          )}
        >
          <span className="flex items-center gap-2 pl-3 pr-2 text-body-md text-muted-foreground">
            <Phone aria-hidden="true" className="size-4" />
            {NEPAL_DIAL_CODE}
          </span>
          <span aria-hidden="true" className="h-6 w-px bg-border" />
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            placeholder="98XX XXX XXX"
            aria-describedby="phone-error"
            aria-invalid={Boolean(errors.phone)}
            className="h-full w-full min-w-0 bg-transparent px-3 text-body-md tabular-nums outline-none placeholder:text-muted-foreground/70"
          />
        </div>
        <FieldError
          id="phone-error"
          lines={1}
          message={message(errors.phone)}
        />
      </div>

      <div>
        <Label htmlFor="category">{t("tradeLabel")}</Label>
        <select
          id="category"
          name="category"
          required
          defaultValue=""
          className={cn(selectClass, "mt-2")}
          aria-describedby="category-error"
        >
          <option value="" disabled>
            {t("tradePlaceholder")}
          </option>
          {trades.map((trade) => (
            <option key={trade.value} value={trade.value}>
              {trade.label}
            </option>
          ))}
        </select>
        <FieldError
          id="category-error"
          lines={1}
          message={message(errors.category)}
        />
      </div>

      <div>
        <Label htmlFor="area">{t("areaLabel")}</Label>
        <select
          id="area"
          name="area"
          required
          defaultValue=""
          className={cn(selectClass, "mt-2")}
          aria-describedby="area-error"
        >
          <option value="" disabled>
            {t("areaPlaceholder")}
          </option>
          {areas.map((group) => (
            <optgroup key={group.city} label={group.city}>
              {group.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <FieldError id="area-error" lines={1} message={message(errors.area)} />
      </div>

      <div>
        <Label htmlFor="years">{t("yearsLabel")}</Label>
        <Input
          id="years"
          name="years"
          type="number"
          inputMode="numeric"
          min={0}
          max={60}
          required
          placeholder="5"
          className="mt-2 h-12 max-w-32 tabular-nums"
          aria-describedby="years-error"
          aria-invalid={Boolean(errors.years)}
        />
        <FieldError
          id="years-error"
          lines={1}
          message={message(errors.years)}
        />
      </div>

      <div>
        <Label htmlFor="note">{t("noteLabel")}</Label>
        <Input
          id="note"
          name="note"
          className="mt-2 h-12"
          placeholder={t("notePlaceholder")}
        />
      </div>

      <FieldError id="form-error" message={message(errors.form)} />

      <Submit label={t("submit")} pending={t("submitting")} />

      <p className="text-caption text-muted-foreground">{t("privacyNote")}</p>
    </form>
  );
}

/** Its own component so `useFormStatus` can see the form it belongs to. */
function Submit({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();

  return (
    <Button
      type="submit"
      variant="gold"
      size="lg"
      className="btn-tactile w-full sm:w-auto sm:self-start"
      disabled={status.pending}
    >
      {status.pending ? pending : label}
      {status.pending ? null : <ArrowRight aria-hidden="true" />}
    </Button>
  );
}
