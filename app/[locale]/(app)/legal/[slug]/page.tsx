import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { ProseDocumentView } from "@/components/shared/prose-document";
import type { Locale } from "@/i18n/routing";
import { liveDocument } from "@/lib/content/documents";
import { isLegalSlug, LEGAL_SLUGS } from "@/lib/content/legal";
import { openGraphFor } from "@/lib/seo";

/**
 * Terms, privacy and the refund policy.
 *
 * One route for three documents because they are the same shape and the same
 * typography; the difference is entirely content. They were linked from the
 * sign-in screen — directly under "By continuing you agree to our terms and
 * privacy policy" — and returned 404, which meant asking people to consent to
 * documents that did not exist.
 */

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  if (!isLegalSlug(params.slug)) return {};

  const locale = params.locale as Locale;
  /* The published version, so a republished title cannot disagree with the body below
     it. `liveDocument` is cached, so this costs nothing per request. */
  const doc = (await liveDocument(params.slug, locale)).document;

  return {
    title: doc.title,
    description: doc.lead,
    openGraph: openGraphFor({
      locale,
      href: `/legal/${params.slug}`,
      title: doc.title,
      description: doc.lead,
    }),
  };
}

export default async function LegalPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const params = await props.params;
  if (!isLegalSlug(params.slug)) notFound();

  const locale = (await getLocale()) as Locale;
  // Loaded so a missing `legal` namespace fails here rather than rendering a
  // dotted key path into a document somebody is agreeing to.
  await getTranslations("legal");

  /*
   * THE PUBLISHED VERSION WHERE THERE IS ONE, THE FILE OTHERWISE. `liveDocument` falls
   * back to the file in `lib/content/legal` on anything it does not like — nothing published, an
   * unreachable table, a stored body that will not parse — because a legal page that
   * renders as nothing is worse than one showing slightly older words. Today nothing is
   * published, so this is the file, and the fallback is the whole behaviour rather than
   * an edge of it.
   */
  const live = await liveDocument(params.slug, locale);
  return <ProseDocumentView doc={live.document} />;
}
