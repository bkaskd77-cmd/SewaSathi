"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { History, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EditableString } from "@/lib/data/content";
import { cn } from "@/lib/utils";

/**
 * One string, in both languages, with what it originally said underneath.
 *
 * THE ORIGINAL IS ALWAYS VISIBLE, not hidden behind a toggle. An admin editing a line
 * needs to know whether they are changing the developers' wording or their own previous
 * edit — those are different acts, and the second one is where a sentence drifts a
 * little further each time nobody can see where it started.
 *
 * BOTH LANGUAGES IN ONE FORM, submitted separately. They are one decision and two
 * writes: editing the English of a safety line and leaving the Nepali is how the
 * catalogues come to say different things, and `check:messages` compares keys and
 * placeholders rather than meanings, so it cannot catch it. Showing them together is the
 * guard; forcing both to change would be worse, because a correction to one language is
 * a real and common thing to want.
 *
 * NO AI. Nothing here suggests a translation or rewrites a sentence — the words a
 * customer reads are a person's responsibility, which was the decision and is why there
 * is no "suggest" button on this screen.
 */
export function StringEditor({ row }: { row: EditableString }) {
  const t = useTranslations("admin.content");
  const [history, setHistory] = React.useState<
    null | Array<{ id: string; locale: string; previousValue: string | null; newValue: string; changedAt: string }>
  >(null);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  const keepsHistory = ["money", "safety", "legal"].includes(row.tier);

  async function loadHistory() {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      const { stringHistoryAction } = await import(
        "@/app/[locale]/(admin)/admin/content/history"
      );
      setHistory(await stringHistoryAction(row.key));
    } finally {
      setLoadingHistory(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <code className="text-caption font-mono text-muted-foreground">{row.key}</code>
        {row.tier !== "none" ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-caption font-medium",
              keepsHistory
                ? "bg-warning/10 text-warning-ink"
                : "bg-muted text-muted-foreground",
            )}
          >
            {t(`tiers.${row.tier}` as "tiers.money")}
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-2">
        {(["en", "ne"] as const).map((locale) => (
          <LocaleField
            key={locale}
            messageKey={row.key}
            locale={locale}
            original={row.original[locale]}
            override={row.override[locale]}
          />
        ))}
      </div>

      {keepsHistory ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="inline-flex items-center gap-1.5 text-caption text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {loadingHistory ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <History aria-hidden="true" className="size-3.5" />
            )}
            {t("showHistory")}
          </button>

          {/*
            NULL IS "WE COULD NOT READ IT", NOT "NOTHING HAS CHANGED" — the two are
            different facts and only one of them means it is safe to edit without
            looking first. An empty array is the real "never edited".
          */}
          {history === null ? null : history.length === 0 ? (
            <p className="mt-2 text-caption text-muted-foreground">{t("noHistory")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {history.map((entry) => (
                <li key={entry.id} className="text-caption text-muted-foreground">
                  <form action={rollback} className="flex flex-wrap items-baseline gap-2">
                    <input type="hidden" name="revisionId" value={entry.id} />
                    <span className="font-mono">{entry.locale}</span>
                    <span className="truncate">
                      {entry.previousValue === null
                        ? t("fromCatalogue")
                        : `"${entry.previousValue}"`}
                    </span>
                    <RollbackButton label={t("rollback")} />
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LocaleField({
  messageKey,
  locale,
  original,
  override,
}: {
  messageKey: string;
  locale: "en" | "ne";
  original: string;
  override: string | null;
}) {
  const t = useTranslations("admin.content");

  return (
    <form action={save} className="flex flex-col">
      <input type="hidden" name="messageKey" value={messageKey} />
      <input type="hidden" name="locale" value={locale} />

      <label className="text-caption font-medium" htmlFor={`${messageKey}-${locale}`}>
        {locale === "en" ? t("english") : t("nepali")}
      </label>
      <textarea
        id={`${messageKey}-${locale}`}
        name="value"
        // Defaults to the override where there is one, and to the catalogue where there
        // is not — so the field always shows what the product currently says rather than
        // an empty box somebody has to retype from memory.
        defaultValue={override ?? original}
        rows={2}
        required
        maxLength={4000}
        lang={locale}
        className="mt-1 w-full rounded-lg border border-input bg-background p-2.5 text-body-sm"
      />

      {override !== null ? (
        <p className="mt-1 text-caption text-muted-foreground">
          {t("originally", { value: original })}
        </p>
      ) : null}

      <SaveButton label={t("save")} />
    </form>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="outline"
      size="sm"
      className="btn-tactile mt-2 self-start"
      disabled={pending}
    >
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}

function RollbackButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="underline underline-offset-4 hover:text-foreground disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/** Bound at call time so this stays a plain client component. */
async function save(formData: FormData) {
  const { setStringAction } = await import(
    "@/app/[locale]/(admin)/admin/content/actions"
  );
  await setStringAction(formData);
}

async function rollback(formData: FormData) {
  const { rollbackStringAction } = await import(
    "@/app/[locale]/(admin)/admin/content/actions"
  );
  await rollbackStringAction(formData);
}
