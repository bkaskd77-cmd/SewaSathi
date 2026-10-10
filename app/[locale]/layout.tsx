import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import localFont from "next/font/local";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";

import { ThemeProvider } from "@/components/shared/theme-provider";
import { routing, type Locale } from "@/i18n/routing";
import { BUILD_COMMIT, BUILD_TIME } from "@/lib/build-info";
import { site } from "@/lib/config/site";
import { openGraphFor } from "@/lib/seo";
import "@/styles/globals.css";

/*
 * SELF-HOSTED, AND THAT IS A DEPLOY DECISION RATHER THAN A PERFORMANCE ONE.
 *
 * `next/font/google` fetches the CSS and the woff2 at BUILD time, so Google
 * Fonts was a build dependency. Twice in two days it answered with something
 * the loader could not parse — `TypeError: Cannot read properties of null
 * (reading '1')` in `@next/font/google/loader.js` — CI went red, the gate
 * correctly refused to ship a red commit, and production quietly kept serving
 * an older build. The second one sat for five hours and was found by a person
 * reading `/api/version`. A third-party outage that can block a deploy is a
 * dependency nobody chose.
 *
 * NOTHING ABOUT THE TYPE CHANGES. Same three families, same subsets, same
 * weights, same `display: swap`, same `preload: false` on the Devanagari face.
 * `scripts/fetch-fonts.mjs` is what produced the files and is how they are
 * refreshed; all three are SIL OFL 1.1 and `app/fonts/OFL.txt` travels with
 * them.
 *
 * THE UNICODE RANGES ARE GOOGLE'S OWN, copied from the CSS the loader used to
 * read. Without them the browser would try the Devanagari file for Latin text
 * on a Nepali page and fall through per character — the same end result by a
 * slower route, and a file downloaded for a page that needs none of it.
 */
/*
 * THE RANGES ARE WRITTEN OUT AT EACH CALL SITE, NOT HOISTED INTO A CONSTANT.
 * `next/font` refuses one — "Font loader values must be explicitly written
 * literals" — so the latin range appears twice below. That is one list written
 * twice, and this repository has a standard answer for it rather than a
 * shrug: `app/fonts/ranges.json` is what `scripts/fetch-fonts.mjs` recorded
 * from Google, and `tests/unit/self-hosted-fonts.test.ts` compares every
 * literal here against it. A range Google revises fails there rather than
 * quietly serving a face for characters it has no glyphs for.
 */
const sans = localFont({
  src: "../fonts/plus-jakarta-sans-latin.woff2",
  /* Variable, 200 to 800 — one file for every weight the product uses. */
  weight: "200 800",
  style: "normal",
  display: "swap",
  variable: "--font-sans",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
});

// Fraunces carries the brand voice in headings — a soft serif with enough
// character to read as made-in-Nepal rather than imported template. Body copy
// stays on the grotesk, which holds up better at small sizes on cheap Android.
const display = localFont({
  /*
   * TWO STATIC INSTANCES, NOT A VARIABLE RANGE. Google serves Fraunces at
   * these weights as separate files, checked rather than assumed: declaring a
   * variable range over a static file is how headings end up with synthesised
   * bold, which CLAUDE.md records as a type decision this product refused.
   */
  src: [
    {
      path: "../fonts/fraunces-latin-600.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../fonts/fraunces-latin-700.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  display: "swap",
  variable: "--font-display",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
    },
  ],
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
const nepali = localFont({
  src: [
    {
      path: "../fonts/noto-sans-devanagari-400.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/noto-sans-devanagari-600.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  display: "swap",
  /* Unchanged: an English page must not fetch 100 kB to draw two glyphs. */
  preload: false,
  variable: "--font-nepali",
  declarations: [
    {
      prop: "unicode-range",
      value:
        "U+0900-097F, U+1CD0-1CF4, U+1CF7-1CF9, U+200C-200D, U+20A8, U+20B9, U+20F0, U+25CC, U+A830-A839, U+A8E0-A8FF, U+11B00-11B0A",
    },
  ],
});

/**
 * Both locales are known at build time, so Next can shape the route tree
 * without a request. Pages underneath are still free to be dynamic — most of
 * them read a session or a query string and are.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
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
    // The locale root, which is what this layout actually describes. Pages with
    // their own generateMetadata build their own; anything without one is
    // noindex and never shared.
    openGraph: openGraphFor({
      locale: locale as Locale,
      href: "/",
      title: t("homeTitle"),
      description: t("homeDescription"),
    }),
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

export default async function LocaleLayout(
  props: Readonly<{
    children: React.ReactNode;
    /* A promise from Next 16: the locale is not known until the request is routed. */
    params: Promise<{ locale: string }>;
  }>,
) {
  const { children } = props;
  const { locale } = await props.params;
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
          Which build this page came from. Raw tags rather than Metadata's
          `other`, for the same reason `openGraph` needed lib/seo.ts: a page
          that sets its own metadata replaces the parent's rather than merging
          with it, and a stamp that silently disappears on the pages you most
          want to check is worse than none. scripts/check-deployed.mjs reads
          this to tell "pushed" from "deployed".
        */}
        <meta name="x-build-commit" content={BUILD_COMMIT} />
        <meta name="x-build-time" content={BUILD_TIME} />
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
