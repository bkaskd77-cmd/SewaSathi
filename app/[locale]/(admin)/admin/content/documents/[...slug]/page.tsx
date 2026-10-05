import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { DocumentEditor } from "@/components/admin/document-editor";
import { ProseDocumentView } from "@/components/shared/prose-document";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { changedLines, diffCount, diffLines } from "@/lib/content/diff";
import {
  documentVersions,
  isDocumentSlug,
  liveDocument,
  workingCopy,
} from "@/lib/content/documents";
import { documentLines, pairDocuments } from "@/lib/content/prose-text";
import { PublishPanel } from "@/components/admin/document-publish";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Editing one document, previewing it, and publishing it.
 *
 * THREE SEPARATE ACTS, IN THAT ORDER, AND THE ORDER IS THE SAFEGUARD. A publish cannot be
 * taken back — only superseded — and `bookings.terms_version` points at what a customer
 * agreed to. "Are you sure" is not a safeguard against that; seeing the actual change is.
 * So saving writes a working copy nobody reads, the page then renders that copy through the
 * SAME component the public pages use, shows the diff against what is live, and publishing
 * is a third act with its own confirmation.
 *
 * THE PREVIEW IS THE REAL RENDERER, NOT A COPY OF IT. `ProseDocumentView` is an async
 * Server Component, so there is no way to render unsaved form state with it — which is why
 * the working copy is a table rather than something carried in the request. A client
 * reimplementation would be two renderers of the legal pages, which is shared surface and
 * where every expensive bug in this product has lived.
 *
 * A CATCH-ALL SEGMENT, because `help/complaint` has a slash in it.
 */
export default async function DocumentPage(props: {
  params: Promise<{ slug: string[] }>;
}) {
  const params = await props.params;
  const slug = (params.slug ?? []).join("/");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.content.documents");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: `/login?next=/admin/content/documents`, locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: `/account/security?next=/admin/content/documents`, locale });
  }

  if (!isDocumentSlug(slug)) notFound();

  const [liveEn, liveNe, pending, versions, messages] = await Promise.all([
    liveDocument(slug, "en"),
    liveDocument(slug, "ne"),
    workingCopy(slug),
    documentVersions(slug),
    getMessages(),
  ]);

  /* The form shows the working copy where there is one, and what is live otherwise — so
     opening a document somebody half-edited continues their edit rather than silently
     throwing it away. */
  const editing =
    pending && pending !== undefined
      ? pairDocuments(pending.en, pending.ne)
      : pairDocuments(liveEn.document, liveNe.document);

  const diff =
    pending && pending !== undefined
      ? diffLines(documentLines(liveEn.document), documentLines(pending.en))
      : null;
  const diffNe =
    pending && pending !== undefined
      ? diffLines(documentLines(liveNe.document), documentLines(pending.ne))
      : null;

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="animate-rise text-caption text-muted-foreground">
        <Link href="/admin/content/documents" className="underline underline-offset-4">
          {t("backToDocuments")}
        </Link>
      </p>

      <h1 className="animate-rise mt-2 font-display text-display-sm">
        {liveEn.document.title}
      </h1>
      <p className="animate-rise mt-2 text-caption text-muted-foreground">
        {liveEn.version === null
          ? t("fromTheRepository")
          : t("liveVersion", {
              n: String(liveEn.version),
              date: (liveEn.effectiveFrom ?? "").slice(0, 10),
            })}
      </p>

      {pending === undefined ? (
        <p
          role="status"
          className="animate-rise mt-6 rounded-lg border border-warning/30 bg-warning/[0.07] p-4 text-body-sm text-warning-ink"
        >
          {t("pendingUnread")}
        </p>
      ) : null}

      {editing.ok ? (
        <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
          <DocumentEditor slug={slug} fields={editing.fields} />
        </NextIntlClientProvider>
      ) : (
        <p
          role="alert"
          className="animate-rise mt-6 rounded-lg border border-destructive/30 bg-destructive/[0.07] p-4 text-body-sm text-destructive-ink"
        >
          {editing.error}
        </p>
      )}

      {pending && pending !== undefined && diff && diffNe ? (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="font-display text-heading-md">{t("beforePublishing")}</h2>
          <p className="mt-1 text-body-sm text-muted-foreground">
            {t("savedAt", { date: pending.updatedAt.slice(0, 16).replace("T", " ") })}
          </p>

          <h3 className="mt-6 font-display text-heading-sm">{t("whatChanges")}</h3>
          <Diff
            label="English"
            diff={diff}
            nothing={t("nothingWouldChange")}
            summary={t}
          />
          <Diff label="नेपाली" diff={diffNe} nothing={t("nothingWouldChange")} summary={t} />

          <h3 className="mt-8 font-display text-heading-sm">{t("howItWillRead")}</h3>
          <div className="mt-4 grid gap-8 lg:grid-cols-2">
            <div className="rounded-lg border border-border p-5">
              <ProseDocumentView doc={pending.en} />
            </div>
            <div className="rounded-lg border border-border p-5" lang="ne">
              <ProseDocumentView doc={pending.ne} />
            </div>
          </div>

          <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
            <PublishPanel slug={slug} />
          </NextIntlClientProvider>
        </div>
      ) : null}

      {versions && versions.length > 0 ? (
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="font-display text-heading-md">{t("history")}</h2>
          <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
            <ul className="mt-4 space-y-2">
              {versions.map((version) => (
                <li
                  key={version.version}
                  className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm"
                >
                  <span>
                    {t("versionLine", {
                      n: String(version.version),
                      effective: version.effectiveFrom.slice(0, 10),
                      published: version.publishedAt.slice(0, 10),
                    })}
                  </span>
                  <RestoreButton slug={slug} version={version.version} label={t("restore")} />
                </li>
              ))}
            </ul>
          </NextIntlClientProvider>
        </div>
      ) : null}
    </section>
  );
}

function Diff({
  label,
  diff,
  nothing,
  summary,
}: {
  label: string;
  diff: ReturnType<typeof diffLines>;
  nothing: string;
  summary: Awaited<ReturnType<typeof getTranslations<"admin.content.documents">>>;
}) {
  const shown = changedLines(diff);
  const counted = diffCount(diff);

  return (
    <div className="mt-4">
      <p className="text-caption font-medium">{label}</p>
      {/* An unchanged document says so rather than rendering an empty box: "nothing would
          change" and "we could not compare" must not look alike. */}
      {shown.length === 0 ? (
        <p className="mt-1 text-body-sm text-muted-foreground">{nothing}</p>
      ) : (
        <>
          <p className="mt-1 text-caption text-muted-foreground">
            {summary("diffCount", {
              added: String(counted.added),
              removed: String(counted.removed),
            })}
          </p>
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-caption">
            {shown.map((line, i) => (
              <div
                key={i}
                className={
                  line.kind === "added"
                    ? "text-success-ink"
                    : line.kind === "removed"
                      ? "text-destructive-ink line-through"
                      : "text-muted-foreground"
                }
              >
                {line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}
                {line.text || " "}
              </div>
            ))}
          </pre>
        </>
      )}
    </div>
  );
}

function RestoreButton({
  slug,
  version,
  label,
}: {
  slug: string;
  version: number;
  label: string;
}) {
  return (
    <form action={restore}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="version" value={version} />
      <button
        type="submit"
        className="text-caption underline underline-offset-4 hover:text-primary"
      >
        {label}
      </button>
    </form>
  );
}

async function restore(formData: FormData) {
  "use server";
  const { restoreDocumentAction } = await import(
    "@/app/[locale]/(admin)/admin/content/documents/actions"
  );
  await restoreDocumentAction(formData);
}
