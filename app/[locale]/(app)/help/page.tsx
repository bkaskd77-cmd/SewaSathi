import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { ProseDocumentView } from "@/components/shared/prose-document";
import type { Locale } from "@/i18n/routing";
import { infoPage } from "@/lib/content/pages";
import { openGraphFor } from "@/lib/seo";

const SLUG = "help";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const doc = infoPage(SLUG, locale);
  if (!doc) return {};

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
  const doc = infoPage(SLUG, locale);
  if (!doc) notFound();

  return <ProseDocumentView doc={doc} />;
}
