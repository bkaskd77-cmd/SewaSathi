import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CloudOff } from "lucide-react";

import { Card } from "@/components/ui/card";
import { routing, type Locale } from "@/i18n/routing";

/**
 * The one page the service worker keeps, and the reason it can.
 *
 * IT CONTAINS NOTHING. No session read, no price, no booking, no count, not
 * even a support phone number — and the absences are the feature rather than
 * minimalism. This file is stored in a cache on somebody's phone at install and
 * served, unchanged, for however long that install lasts. Anything true on it
 * today that could become false is a lie with a long fuse, and
 * `lib/pwa/cache-rule.ts` is the rule that makes this the ONLY document the
 * worker is allowed to hold. If this page ever needs a number on it, the number
 * is the thing that has to change, not the rule.
 *
 *   The support phone is the near miss worth naming. It is `site.supportPhone`,
 *   it is exactly what somebody with no signal would want, and it is read from
 *   an environment variable that can change between a deploy and the cached
 *   copy on a phone. A stale number on the offline page is the dead escape
 *   hatch `site.ts` already records as reading like contempt — so it is not
 *   here, and what is here instead is the honest instruction: the connection is
 *   the thing to fix, and the product is a tab away once it comes back.
 *
 * NO ROUTE GROUP, SO NO HEADER AND NO FOOTER. The site header reads the session
 * to render the account menu; a cached copy of it would show a signed-in
 * account to whoever next picks up the phone. Sitting directly under `[locale]`
 * gives this page the root layout alone, which reads messages and fonts and
 * nothing else.
 *
 * BOTH LANGUAGES ARE PRECACHED. The worker picks by the path that failed, so a
 * Nepali reader whose signal has gone reads Nepali — which is the one screen in
 * the product guaranteed to be read in a bad moment, by somebody least able to
 * absorb an apology in a second language.
 *
 * `generateStaticParams` IS WHAT MAKES IT PRECACHEABLE. The worker fetches
 * `/offline` and `/ne/offline` during install, on a connection that is by
 * definition about to be unreliable; a page that had to be rendered per request
 * would make installing the app depend on a server round trip twice over.
 */

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const t = await getTranslations({ locale: params.locale, namespace: "offline" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function OfflinePage(props: {
  params: Promise<{ locale: Locale }>;
}) {
  const params = await props.params;
  setRequestLocale(params.locale);
  const t = await getTranslations({ locale: params.locale, namespace: "offline" });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-4 py-10">
      <Card className="w-full p-6 text-center animate-rise">
        <span
          aria-hidden="true"
          className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-muted"
        >
          <CloudOff className="size-6 text-muted-foreground" />
        </span>

        <h1 className="text-h3 font-semibold">{t("title")}</h1>
        <p className="mt-2 text-pretty text-body-sm text-muted-foreground">
          {t("body")}
        </p>

        {/*
          A PLAIN <a> AND A FULL RELOAD, not the locale-aware <Link>. There is no
          router to navigate with on a page served by a worker from a cache, and
          a client navigation would resolve against a React tree that was never
          hydrated with real data. Reloading is the honest action: it either
          reaches the network or it comes straight back here.

          It keeps the locale by being written per language — `/` and `/ne` —
          because `localePrefix: "as-needed"` means English has no prefix.
        */}
        <a
          href={params.locale === routing.defaultLocale ? "/" : `/${params.locale}`}
          className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-body-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.99]"
        >
          {t("retry")}
        </a>

        <p className="mt-4 text-caption text-muted-foreground">{t("kept")}</p>
      </Card>
    </main>
  );
}
