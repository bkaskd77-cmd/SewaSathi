"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Publishing, and throwing a working copy away.
 *
 * THE CONFIRMATION IS A REQUIRED FIELD, NOT A COURTESY, and it is checked again in the
 * action — a server action is a public POST endpoint, so a tick nothing verified is
 * decoration. The sentence it carries is the one that matters: this takes effect now for new
 * bookings, and bookings already taken keep the version they were made under.
 *
 * THE DATE IS NOT ASKED FOR. `effective_from` defaults to the publish moment in the
 * database, so nothing on this screen can set it — which is what makes "recorded
 * automatically" structural rather than a habit. Scheduling an amendment for a future date
 * is deferred: it would mean serving text that is not yet in force while bookings are
 * stamped with its version.
 */
export function PublishPanel({ slug }: { slug: string }) {
  const t = useTranslations("admin.content.documents");
  const [error, setError] = React.useState<string | null>(null);
  const [published, setPublished] = React.useState<number | null>(null);

  async function publish(formData: FormData) {
    setError(null);
    const { publishDocumentAction } = await import(
      "@/app/[locale]/(admin)/admin/content/documents/actions"
    );
    const result = await publishDocumentAction(formData);
    if (result.ok) setPublished(result.version ?? null);
    else setError(result.error === "notConfirmed" ? t("confirmFirst") : (result.error ?? t("publishFailed")));
  }

  async function discard(formData: FormData) {
    const { discardDocumentAction } = await import(
      "@/app/[locale]/(admin)/admin/content/documents/actions"
    );
    await discardDocumentAction(formData);
  }

  if (published !== null) {
    return (
      <p
        role="status"
        className="animate-rise mt-8 rounded-lg border border-success/30 bg-success/[0.07] p-4 text-body-sm text-success-ink"
      >
        {t("publishedVersion", { n: String(published) })}
      </p>
    );
  }

  return (
    <div className="mt-8 rounded-lg border border-border p-5">
      <form action={publish}>
        <input type="hidden" name="slug" value={slug} />

        <label className="flex items-start gap-2.5 text-body-sm">
          <input type="checkbox" name="confirm" required className="mt-0.5 size-4" />
          <span>{t("confirmSentence")}</span>
        </label>

        {error ? (
          <p role="alert" className="mt-3 text-body-sm text-destructive-ink">
            {error}
          </p>
        ) : null}

        <div className="mt-4">
          <PublishButton label={t("publish")} />
        </div>
      </form>

      <form action={discard} className="mt-4 border-t border-border pt-4">
        <input type="hidden" name="slug" value={slug} />
        <button
          type="submit"
          className="text-caption text-muted-foreground underline underline-offset-4 hover:text-destructive-ink"
        >
          {t("discard")}
        </button>
      </form>
    </div>
  );
}

function PublishButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="btn-tactile" disabled={pending}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}
