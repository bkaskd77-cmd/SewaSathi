"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const LANGUAGES = [
  { value: "en", label: "English", hint: "Interface in English" },
  { value: "ne", label: "नेपाली", hint: "अन्तरफलक नेपालीमा" },
] as const;

/**
 * Two fields, and no skip.
 *
 * The name is not optional: a professional standing at a gate needs to know
 * who they are visiting, and "customer #4821" is not something you shout up
 * at a third-floor window.
 */
export function OnboardingForm({ next }: { next: string }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [language, setLanguage] = React.useState<"en" | "ne">("en");
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();

    if (trimmed.length < 2) {
      setError(
        "Please enter your name so your professional knows who to ask for.",
      );
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
      setError("Your session expired. Please sign in again.");
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: trimmed, preferred_language: language })
      .eq("id", user.id);

    if (updateError) {
      setSaving(false);
      setError("We couldn't save that. Check your connection and try again.");
      return;
    }

    // Stays `saving` through the navigation, like /login does. Dropping back
    // to the idle label while the next screen loads reads as a failed tap.
    router.replace(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Label htmlFor="full-name">Your name</Label>
      <Input
        id="full-name"
        name="full-name"
        autoComplete="name"
        autoFocus
        placeholder="e.g. Anita Shrestha"
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
          Preferred language
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
                  {option.hint}
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
        {saving ? "Saving…" : "Continue"}
        {!saving ? <ArrowRight aria-hidden="true" /> : null}
      </Button>
    </form>
  );
}
