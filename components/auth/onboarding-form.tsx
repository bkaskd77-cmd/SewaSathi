"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

// Each option is written in its own language, in both locales — a language
// picker that renders "Nepali" in English is asking somebody to recognise the
// name of their own language in a script they may not read.
const LANGUAGES = [
  { value: "en", label: "English", hintKey: "languageEnHint" },
  { value: "ne", label: "नेपाली", hintKey: "languageNeHint" },
] as const;

/**
 * Two fields, and no skip.
 *
 * The name is not optional: a professional standing at a gate needs to know
 * who they are visiting, and "customer #4821" is not something you shout up
 * at a third-floor window.
 */
export function OnboardingForm({ next }: { next: string }) {
  const t = useTranslations("auth.onboarding");
  const tErr = useTranslations("auth.errors");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [name, setName] = React.useState("");
  // Prefilled from the language they are already reading in — they chose it
  // in the header, and asking again with the wrong default is a small insult.
  const [language, setLanguage] = React.useState<Locale>(locale);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();

    if (trimmed.length < 2) {
      setError(tErr("nameTooShort"));
      return;
    }

    setError(null);
    setSaving(true);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSaving(false);
      setError(tErr("sessionExpired"));
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: trimmed, preferred_language: language })
      .eq("id", user.id);

    if (updateError) {
      setSaving(false);
      setError(tErr("saveFailed"));
      return;
    }

    // Stays `saving` through the navigation, like /login does. Dropping back
    // to the idle label while the next screen loads reads as a failed tap.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Label htmlFor="full-name">{t("nameLabel")}</Label>
      <Input
        id="full-name"
        name="full-name"
        autoComplete="name"
        autoFocus
        placeholder={t("namePlaceholder")}
        className="mt-2 h-14 text-lg"
        aria-invalid={Boolean(error)}
        aria-describedby="name-error"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          if (error) setError(null);
        }}
      />
      <FieldError id="name-error" message={error} className="mt-1.5" />

      <fieldset className="mt-3">
        <legend className="text-body-sm font-semibold">
          {t("languageLegend")}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-3">
          {LANGUAGES.map((option) => {
            const active = language === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer flex-col rounded-lg border p-4 transition-colors",
                  "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
                  active
                    ? "border-primary bg-primary/[0.07]"
                    : "border-input bg-card hover:border-primary/40",
                )}
              >
                <input
                  type="radio"
                  name="language"
                  value={option.value}
                  checked={active}
                  onChange={() => setLanguage(option.value)}
                  className="sr-only"
                />
                <span
                  className="font-display text-body-lg font-semibold"
                  lang={option.value}
                >
                  {option.label}
                </span>
                <span
                  className="mt-0.5 text-caption text-muted-foreground"
                  lang={option.value}
                >
                  {t(option.hintKey)}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <Button
        type="submit"
        variant="gold"
        size="lg"
        className="btn-tactile mt-6 w-full"
        disabled={saving}
      >
        {saving ? t("saving") : t("continue")}
        {!saving ? <ArrowRight aria-hidden="true" /> : null}
      </Button>
    </form>
  );
}
