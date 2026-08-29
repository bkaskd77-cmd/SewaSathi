import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { ProseDocumentView } from "@/components/shared/prose-document";
import type { Locale } from "@/i18n/routing";
import { isLegalSlug, legalDocument, LEGAL_SLUGS } from "@/lib/content/legal";
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

export async function generateMetadata({
  params,
}: {
  params: { locale: string; slug: string };
}): Promise<Metadata> {
  if (!isLegalSlug(params.slug)) return {};

  const locale = params.locale as Locale;
  const doc = legalDocument(params.slug, locale);

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

export default async function LegalPage({
  params,
}: {
  params: { slug: string };
}) {
  if (!isLegalSlug(params.slug)) notFound();

  const locale = (await getLocale()) as Locale;
  // Loaded so a missing `legal` namespace fails here rather than rendering a
  // dotted key path into a document somebody is agreeing to.
  await getTranslations("legal");

  return <ProseDocumentView doc={legalDocument(params.slug, locale)} />;
}
