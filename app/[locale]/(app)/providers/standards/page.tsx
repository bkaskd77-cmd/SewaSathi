import type { Metadata } from "next";
import { getLocale } from "next-intl/server";

import { ProseDocumentView } from "@/components/shared/prose-document";
import type { Locale } from "@/i18n/routing";
import { liveDocument } from "@/lib/content/documents";
import { openGraphFor } from "@/lib/seo";

const SLUG = "providers/standards";

/* What the document is STORED as, which is not always what it is served at. */
const DOCUMENT = "standards" as const;

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const locale = params.locale as Locale;
  const doc = (await liveDocument(DOCUMENT, locale)).document;

  return {
    title: doc.title,
    description: doc.lead,
    openGraph: openGraphFor({
      locale,
      href: `/${SLUG}`,
      title: doc.title,
      description: doc.lead,
    }),
  };
}

export default async function Page() {
  const locale = (await getLocale()) as Locale;
  /*
   * THE PUBLISHED VERSION WHERE THERE IS ONE, THE FILE OTHERWISE. `liveDocument` falls back
   * to the file in `lib/content/pages` on anything it does not like — nothing published, an
   * unreachable table, a stored body that will not parse. Today nothing is published, so
   * this IS the file, and the fallback is the whole behaviour rather than an edge of it.
   *
   * It read `infoPage` directly until now, which meant publishing this document changed
   * nothing on the page it is published for — `liveDocument` existed, was tested, and had no
   * caller for this slug.
   */
  const doc = (await liveDocument(DOCUMENT, locale)).document;

  return <ProseDocumentView doc={doc} />;
}
