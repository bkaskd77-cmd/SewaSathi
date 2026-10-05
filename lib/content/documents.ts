import "server-only";

import { unstable_cache } from "next/cache";

import type { Locale } from "@/i18n/routing";
import { LEGAL_DOCUMENTS, type LegalSlug } from "@/lib/content/legal";
import { infoPage } from "@/lib/content/pages";
import { standards } from "@/lib/content/pages/standards";
import type { ProseDocument } from "@/lib/content/types";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The four long-form documents, and which version of each is in force.
 *
 * WHY THESE ARE VERSIONED AND THE INTERFACE STRINGS ARE NOT. A button label is just the
 * current wording; nobody ever needs to know what it said last March. The terms are
 * different in kind: a customer agreed to a specific text on a specific day, and if
 * there is a dispute the only answer that means anything is *what did it say then*. So
 * each publish is a new row, the rows are append-only, and `bookings.terms_version`
 * points at the one in force when the booking was made.
 *
 * THE FILE IS THE FALLBACK AND THE FIRST VERSION. `lib/content/legal/*` and
 * `lib/content/pages/standards.ts` stay in the repository, and nothing published means
 * the file is served — so the tables ship empty, a fresh clone renders every document,
 * and an unreachable database shows the words rather than a blank page. Same rule as
 * the string overrides, for the same reason.
 *
 * NULL `terms_version` IS "BEFORE VERSIONING EXISTED", never version 1. Every booking
 * taken so far was made against text that was never versioned, and writing 1 into those
 * rows would assert that each of those customers was shown a specific document — which
 * nobody can know. Nothing is backfilled.
 */

export type DocumentSlug =
  | LegalSlug
  | "standards"
  | "help"
  | "help/complaint"
  | "about"
  | "contact";

/**
 * The eight, and one list written twice.
 *
 * The other copy is the check constraint on `content_documents.slug`, which cannot read
 * TypeScript, so `tests/unit/content-documents.test.ts` compares the two — a slug added
 * here alone would be refused by the database at the moment somebody pressed Publish,
 * losing the edit in the statement that tried to save it. `REFUSAL_REASON_CODES` and the
 * category icons are the same arrangement.
 *
 * THE FOUR INFORMATION PAGES ARE HERE BECAUSE THEY ARE THE SAME SHAPE. Nobody agrees to a
 * contact page, so its version number is evidence of nothing — but the append-only trail
 * is still the record of who changed the help text and when, which is the question asked
 * of any other content edit. Editing them was in the scope and unmet; they cost one
 * constraint.
 */
export const DOCUMENT_SLUGS: DocumentSlug[] = [
  "terms",
  "privacy",
  "refunds",
  "standards",
  "help",
  "help/complaint",
  "about",
  "contact",
];

export function isDocumentSlug(value: string): value is DocumentSlug {
  return (DOCUMENT_SLUGS as string[]).includes(value);
}

/**
 * Where each slug's URL lives, for the ones that are not under `/legal`.
 *
 * `standards` is stored under that name and served at `/providers/standards`, which was
 * already true before this map existed; the rest are stored and served alike. Written
 * down because the storage key and the route are not the same fact and pretending they
 * were is how one of them quietly becomes wrong.
 */
const PAGE_KEY: Partial<Record<DocumentSlug, string>> = {
  standards: "providers/standards",
  help: "help",
  "help/complaint": "help/complaint",
  about: "about",
  contact: "contact",
};

/** The text in the repository, which is version zero of everything. */
function fromFile(slug: DocumentSlug, locale: Locale): ProseDocument {
  const pageKey = PAGE_KEY[slug];
  if (pageKey) {
    const page = infoPage(pageKey, locale);
    /*
     * `standards` keeps its own import rather than relying on the lookup, because that is
     * the document a professional is held to and a renamed key must not silently degrade
     * it to a blank page. The others have no such floor and none is invented for them.
     */
    if (page) return page;
    if (slug === "standards") return standards[locale];
    throw new Error(`No file behind the document "${slug}".`);
  }
  return LEGAL_DOCUMENTS[slug as LegalSlug][locale];
}

const CACHE_SECONDS = 15 * 60;
export const CONTENT_DOCUMENTS_TAG = "content-documents";

type LiveDocument = {
  /** Null when nothing is published and the file is being served. */
  version: number | null;
  effectiveFrom: string | null;
  document: ProseDocument;
};

async function readLive(
  slug: DocumentSlug,
  locale: Locale,
): Promise<LiveDocument> {
  const file = { version: null, effectiveFrom: null, document: fromFile(slug, locale) };
  if (!hasSupabaseConfig()) return file;

  try {
    const db = createAdminClient();
    const { data: pointer, error } = await db
      .from("content_documents")
      .select("live_version")
      .eq("slug", slug)
      .maybeSingle();

    if (error || !pointer?.live_version) return file;

    const { data: version } = await db
      .from("content_document_versions")
      .select("version, body_en, body_ne, effective_from")
      .eq("slug", slug)
      .eq("version", pointer.live_version)
      .maybeSingle();

    if (!version) return file;

    /*
     * A STORED DOCUMENT THAT WILL NOT PARSE SERVES THE FILE. The body is the structured
     * `ProseDocument` as JSON, and a malformed one is the one failure that could render
     * a legal page as nothing at all — so it falls back rather than throwing, and says
     * so in the log. The alternative is a terms page that is blank for everybody
     * because of one bad publish.
     */
    try {
      const body = locale === "ne" ? version.body_ne : version.body_en;
      return {
        version: version.version as number,
        effectiveFrom: version.effective_from as string,
        document: JSON.parse(body as string) as ProseDocument,
      };
    } catch (parseError) {
      console.error(
        `[documents] ${slug} v${version.version} would not parse — serving the file. ${describeError(parseError)}`,
      );
      return file;
    }
  } catch (thrown) {
    console.error(`[documents] ${slug} unread — ${describeError(thrown)}`);
    return file;
  }
}

export const liveDocument = (slug: DocumentSlug, locale: Locale) =>
  unstable_cache(() => readLive(slug, locale), ["content-document", slug, locale], {
    revalidate: CACHE_SECONDS,
    tags: [CONTENT_DOCUMENTS_TAG],
  })();

/**
 * The terms version a booking made right now is agreeing to.
 *
 * NULL WHEN NOTHING IS PUBLISHED, which is the state today and is honest: there is no
 * version to name, because the text has never been versioned. `createBooking` writes
 * whatever this returns, so the column stays null until somebody publishes — and the
 * bookings taken before that are left alone.
 *
 * NEVER THROWS. A booking must not fail because a version lookup did; the worst case is
 * a booking with no version recorded, which is exactly what every existing booking has.
 */
export async function liveTermsVersion(): Promise<number | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data } = await createAdminClient()
      .from("content_documents")
      .select("live_version")
      .eq("slug", "terms")
      .maybeSingle();
    return (data?.live_version as number | null) ?? null;
  } catch (thrown) {
    console.error(`[documents] terms version unread — ${describeError(thrown)}`);
    return null;
  }
}

/**
 * Publish a new version of a document.
 *
 * APPEND-ONLY, SO PUBLISHING IS THE ONLY EDIT. There is no "update the live version" —
 * `content_document_versions` refuses UPDATE and DELETE for every caller including the
 * service role, and that is deliberate: a customer agreed to a specific text, and
 * `bookings.terms_version` points at it. If that text could be changed afterwards the
 * pointer would name something nobody ever saw, which is worse than having no version
 * at all because it looks like a record.
 *
 * THE VERSION IS WRITTEN BEFORE THE POINTER MOVES. A failed pointer update leaves a
 * published version nobody is being served — recoverable, and visible on the screen. The
 * other order would point at a row that does not exist, which renders the file with no
 * sign anything is wrong.
 *
 * AN EFFECTIVE DATE IS NOT A PUBLISH DATE. A document can be written today and take
 * effect next month; `effective_from` is what a dispute is argued from and
 * `published_at` is when somebody pressed the button. Both are kept because they answer
 * different questions.
 */
export async function publishDocument(input: {
  slug: DocumentSlug;
  bodyEn: ProseDocument;
  bodyNe: ProseDocument;
  effectiveFrom: string;
  actorId: string;
}): Promise<{ ok: boolean; version?: number; reason?: string }> {
  if (!hasSupabaseConfig()) return { ok: false, reason: "notConfigured" };

  try {
    const db = createAdminClient();

    await db
      .from("content_documents")
      .upsert({ slug: input.slug }, { onConflict: "slug" });

    const { data: latest } = await db
      .from("content_document_versions")
      .select("version")
      .eq("slug", input.slug)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = ((latest?.version as number | undefined) ?? 0) + 1;

    const { error: versionError } = await db
      .from("content_document_versions")
      .insert({
        slug: input.slug,
        version,
        body_en: JSON.stringify(input.bodyEn),
        body_ne: JSON.stringify(input.bodyNe),
        effective_from: input.effectiveFrom,
        published_by: input.actorId,
      });

    if (versionError) {
      console.error(`[documents] publish — ${describeError(versionError)}`);
      return { ok: false, reason: "failed" };
    }

    const { error: pointerError } = await db
      .from("content_documents")
      .update({ live_version: version, updated_at: new Date().toISOString() })
      .eq("slug", input.slug);

    if (pointerError) {
      console.error(`[documents] pointer — ${describeError(pointerError)}`);
      return { ok: false, reason: "publishedNotLive" };
    }

    return { ok: true, version };
  } catch (thrown) {
    console.error(`[documents] publish threw — ${describeError(thrown)}`);
    return { ok: false, reason: "failed" };
  }
}

/** Every published version of a document, newest first. Null when unreadable. */
export async function documentVersions(slug: DocumentSlug): Promise<
  | Array<{ version: number; effectiveFrom: string; publishedAt: string }>
  | null
> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data, error } = await createAdminClient()
      .from("content_document_versions")
      .select("version, effective_from, published_at")
      .eq("slug", slug)
      .order("version", { ascending: false });

    if (error) return null;
    return (data ?? []).map((row) => ({
      version: row.version as number,
      effectiveFrom: row.effective_from as string,
      publishedAt: row.published_at as string,
    }));
  } catch {
    return null;
  }
}
