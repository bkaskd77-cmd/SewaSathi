import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import {
  Fraunces,
  Noto_Sans_Devanagari,
  Plus_Jakarta_Sans,
} from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { ThemeProvider } from "@/components/shared/theme-provider";
import { routing } from "@/i18n/routing";
import { site } from "@/lib/config/site";
import "@/styles/globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Fraunces carries the brand voice in headings — a soft serif with enough
// character to read as made-in-Nepal rather than imported template. Body copy
// stays on the grotesk, which holds up better at small sizes on cheap Android.
const display = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
  variable: "--font-display",
});

// Nepali copy renders in Devanagari. The rule that applies it is scoped to
// `:root[lang="ne"]` in globals.css, so an English page never pulls this file
// — it was 119 kB, the largest asset on the page, and it was being downloaded
// to render two glyphs in the language toggle.
//
// On /ne it is still 119 kB of the 207 kB the page spends on type, and worth
// about six Lighthouse points on mobile. Dropping to a single weight halves it
// (see the note in CLAUDE.md); doing better than that means self-hosting a
// glyph-subset built from messages/ne.json, which is a real build step and a
// decision for a later phase.
const nepali = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "600"],
  display: "swap",
  preload: false,
  variable: "--font-nepali",
});

/**
 * Both locales are known at build time, so Next can shape the route tree
 * without a request. Pages underneath are still free to be dynamic — most of
 * them read a session or a query string and are.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const { locale } = params;
  const t = await getTranslations({ locale, namespace: "meta" });

  return {
    metadataBase: new URL(site.url),
    title: {
      default: t("homeTitle"),
      template: `%s · ${site.name}`,
    },
    description: t("homeDescription"),
    applicationName: site.name,
    keywords: [
      "plumber Kathmandu",
      "electrician Nepal",
      "home cleaning Lalitpur",
      "appliance repair Nepal",
      "घरायसी सेवा",
    ],
    // No `alternates` here. Metadata on a layout is inherited by every page
    // under it, so a canonical set here made /services claim the homepage as
    // its canonical URL — worse than having none. The per-path hreflang pairs
    // are already served by next-intl's middleware as `Link` response headers,
    // which is the mechanism built for exactly this and cannot go stale.
    openGraph: {
      type: "website",
      siteName: site.name,
      url: site.url,
      title: t("homeTitle"),
      description: t("homeDescription"),
      locale: locale === "ne" ? "ne_NP" : "en_NP",
    },
    twitter: {
      card: "summary_large_image",
      title: t("homeTitle"),
      description: t("homeDescription"),
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8e7" },
    { media: "(prefers-color-scheme: dark)", color: "#131a1e" },
  ],
};

/**
 * Namespaces no Client Component reads.
 *
 * `NextIntlClientProvider` serialises whatever it is given into the RSC
 * payload for every page. The FAQ answers and the booking placeholder copy are
 * the longest prose in the catalogue and are rendered entirely on the server,
 * so they are held back. Adding a `useTranslations("booking")` to a Client
 * Component will fail loudly with MISSING_MESSAGE rather than silently — which
 * is the behaviour we want from a list like this.
 */
const SERVER_ONLY_NAMESPACES = [
  "meta",
  "home",
  "footer",
  "booking",
  "notFound",
] as const;

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: { locale: string } }>) {
  const { locale } = params;
  if (!hasLocale(routing.locales, locale)) notFound();

  setRequestLocale(locale);

  const all = await getMessages();
  const messages = Object.fromEntries(
    Object.entries(all).filter(
      ([key]) => !(SERVER_ONLY_NAMESPACES as readonly string[]).includes(key),
    ),
  );

  return (
    // suppressHydrationWarning: next-themes sets `class` on <html> before
    // React hydrates, which would otherwise be reported as a mismatch.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${nepali.variable}`}
    >
      <head>
        {/*
          Marks the document as JS-capable before the first paint. Everything
          in styles/globals.css that hides content for an entrance animation is
          gated on this class, so a page that never gets its bundle still
          renders fully.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('js')`,
          }}
        />
      </head>
      <body>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            {children}
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
