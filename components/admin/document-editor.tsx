"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DocumentFields, SectionPair } from "@/lib/content/prose-text";

/**
 * One long-form document, both languages, one textarea per section.
 *
 * WHY A TEXTAREA AND NOT A FIELD PER BLOCK. A `ProseDocument` is structured — paragraphs,
 * bulleted lists and term/detail tables — and the alternative was a textarea per paragraph,
 * paired inputs per table row, and add/remove/reorder controls, on documents that run to
 * twelve sections. That is the largest screen in the admin panel and most of it is chrome.
 * The format is a blank line between blocks, `- ` for a list and ` :: ` for a table; neither
 * marker appears in any document today, which a test asserts, and the round trip is lossless
 * over all eight documents in both languages.
 *
 * THE ANCHOR IS ONE FIELD, NOT TWO. `#cancellation` is a URL fragment somebody may have
 * been linked to by support, so it belongs to the section rather than to a language — and
 * changing it breaks that link, which is why it is shown as the anchor rather than as an id.
 *
 * SAVING IS NOT PUBLISHING. This writes a working copy nobody reads; the page then shows the
 * rendered result and the diff, and publishing is a separate act with its own confirmation.
 *
 * NO AI, as decided. Nothing here suggests a translation or rewrites a sentence.
 */
export function DocumentEditor({
  slug,
  fields,
}: {
  slug: string;
  fields: DocumentFields;
}) {
  const t = useTranslations("admin.content.documents");
  const [sections, setSections] = React.useState<SectionPair[]>(fields.sections);
  const [error, setError] = React.useState<string | null>(null);

  async function save(formData: FormData) {
    setError(null);
    const { saveDocumentAction } = await import(
      "@/app/[locale]/(admin)/admin/content/documents/actions"
    );
    const result = await saveDocumentAction(formData);
    if (!result.ok) setError(result.error ?? t("saveFailed"));
  }

  return (
    <form action={save} className="mt-8">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="sectionCount" value={sections.length} />

      <div className="grid gap-4 md:grid-cols-2">
        <Field name="titleEn" label={t("fieldTitle")} hint="EN" value={fields.titleEn} />
        <Field
          name="titleNe"
          label={t("fieldTitle")}
          hint="ने"
          value={fields.titleNe}
          locale="ne"
        />
        <Field name="leadEn" label={t("fieldLead")} hint="EN" value={fields.leadEn} rows={2} />
        <Field
          name="leadNe"
          label={t("fieldLead")}
          hint="ने"
          value={fields.leadNe}
          rows={2}
          locale="ne"
        />
      </div>

      <label className="mt-4 flex items-start gap-2.5 text-body-sm">
        <input
          type="checkbox"
          name="draft"
          defaultChecked={fields.draft}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="font-medium">{t("reviewNotice")}</span>
          <span className="block text-caption text-muted-foreground">
            {t("reviewNoticeHelp")}
          </span>
        </span>
      </label>

      <p className="mt-8 text-caption text-muted-foreground">{t("formatHelp")}</p>

      <ol className="mt-3 space-y-5">
        {sections.map((section, index) => (
          <li key={`${section.id}-${index}`} className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="text-body-sm">
                <span className="block font-medium">{t("anchor")}</span>
                <input
                  name={`section-${index}-id`}
                  defaultValue={section.id}
                  required
                  className="mt-1 h-11 rounded-lg border border-input bg-background px-3 font-mono text-body-sm"
                />
              </label>

              {/* Removal is offered, with what it costs said out loud. Not offering it is
                  how people blank a section instead, which leaves a heading with nothing
                  under it and the anchor still resolving to an empty clause. */}
              <label className="flex items-center gap-2 text-caption text-muted-foreground">
                <input type="checkbox" name={`section-${index}-remove`} className="size-4" />
                {t("removeSection")}
              </label>
            </div>

            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <Field
                name={`section-${index}-headingEn`}
                label={t("heading")}
                hint="EN"
                value={section.headingEn}
              />
              <Field
                name={`section-${index}-headingNe`}
                label={t("heading")}
                hint="ने"
                value={section.headingNe}
                locale="ne"
              />
              <Field
                name={`section-${index}-bodyEn`}
                label={t("body")}
                hint="EN"
                value={section.bodyEn}
                rows={10}
                mono
              />
              <Field
                name={`section-${index}-bodyNe`}
                label={t("body")}
                hint="ने"
                value={section.bodyNe}
                rows={10}
                mono
                locale="ne"
              />
            </div>
          </li>
        ))}
      </ol>

      <button
        type="button"
        onClick={() =>
          setSections((current) => [
            ...current,
            { id: "", headingEn: "", headingNe: "", bodyEn: "", bodyNe: "" },
          ])
        }
        className="btn-tactile mt-4 inline-flex h-11 items-center gap-1.5 rounded-lg border border-border px-4 text-body-sm"
      >
        <Plus aria-hidden="true" className="size-4" />
        {t("addSection")}
      </button>

      {error ? (
        <p
          role="alert"
          className="animate-rise mt-6 rounded-lg border border-destructive/30 bg-destructive/[0.07] p-4 text-body-sm text-destructive-ink"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        <SaveButton label={t("save")} />
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  hint,
  value,
  rows = 1,
  mono,
  locale,
}: {
  name: string;
  label: string;
  hint: string;
  value: string;
  rows?: number;
  mono?: boolean;
  locale?: "ne";
}) {
  return (
    <div className="flex flex-col">
      <label className="text-caption font-medium" htmlFor={name}>
        {label} <span className="text-muted-foreground">{hint}</span>
      </label>
      <textarea
        id={name}
        name={name}
        defaultValue={value}
        rows={rows}
        required
        lang={locale}
        className={`mt-1 w-full rounded-lg border border-input bg-background p-2.5 text-body-sm ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="btn-tactile" disabled={pending}>
      {pending ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
      {label}
    </Button>
  );
}
