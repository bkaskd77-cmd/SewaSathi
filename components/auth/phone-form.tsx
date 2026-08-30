"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, Phone } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import { sendOtp } from "@/lib/auth/otp";
import {
  checkNepaliMobile,
  formatNepaliMobile,
  NEPAL_DIAL_CODE,
} from "@/lib/auth";
import { cn } from "@/lib/utils";

export function PhoneForm({ next }: { next: string }) {
  const t = useTranslations("auth.login");
  const tErr = useTranslations("auth.errors");
  const router = useRouter();
  const [raw, setRaw] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const check = checkNepaliMobile(raw);
    if (!check.ok) {
      setError(tErr(check.reason));
      return;
    }

    setError(null);
    setSending(true);
    const outcome = await sendOtp(check.e164);

    if (!outcome.ok) {
      setSending(false);
      setError(tErr(outcome.error));
      return;
    }

    // Deliberately stays `sending` through the navigation. Flipping the label
    // back to "Send code" while /verify is still loading reads as if the tap
    // did nothing — the two screens are one flow, so the button waits.
    const params = new URLSearchParams({ phone: check.e164, next });
    router.push(`/verify?${params.toString()}`);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Label htmlFor="phone">{t("mobileLabel")}</Label>

      <div
        className={cn(
          "mt-2 flex h-14 items-center rounded-lg border bg-card transition-colors",
          "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
          error ? "border-destructive" : "border-input",
        )}
      >
        <span className="flex items-center gap-2 pl-4 pr-3 text-body-md text-muted-foreground">
          <Phone aria-hidden="true" className="size-4" />
          {NEPAL_DIAL_CODE}
        </span>
        <span aria-hidden="true" className="h-7 w-px bg-border" />
        <input
          id="phone"
          name="phone"
          type="tel"
          // Numeric keypad on mobile without losing the tel semantics.
          inputMode="numeric"
          autoComplete="tel-national"
          autoFocus
          placeholder={t("placeholder")}
          aria-invalid={Boolean(error)}
          aria-describedby="phone-error"
          value={formatNepaliMobile(raw)}
          onChange={(event) => {
            setRaw(event.target.value);
            if (error) setError(null);
          }}
          className="h-full w-full min-w-0 bg-transparent px-3 text-lg tabular-nums outline-none placeholder:text-muted-foreground/70"
        />
      </div>

      <FieldError id="phone-error" message={error} className="mt-1.5" />

      <Button
        type="submit"
        variant="gold"
        size="lg"
        className="btn-tactile mt-2 w-full"
        disabled={sending}
      >
        {sending ? t("sending") : t("send")}
        {!sending ? <ArrowRight aria-hidden="true" /> : null}
      </Button>

      <p className="mt-3 text-center text-caption text-muted-foreground">
        {t("smsNote")}
      </p>
    </form>
  );
}
