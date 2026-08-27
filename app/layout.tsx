import type { Metadata, Viewport } from "next";
import {
  Fraunces,
  Noto_Sans_Devanagari,
  Plus_Jakarta_Sans,
} from "next/font/google";

import { MotionProvider } from "@/components/shared/motion-provider";
import { ThemeProvider } from "@/components/shared/theme-provider";
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

// Nepali copy renders in Devanagari; `:lang(ne)` in globals.css picks this up.
const nepali = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "600"],
  display: "swap",
  preload: false,
  variable: "--font-nepali",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.name} — ${site.tagline}`,
    template: `%s · ${site.name}`,
  },
  description: site.description,
  applicationName: site.name,
  keywords: [
    "plumber Kathmandu",
    "electrician Nepal",
    "home cleaning Lalitpur",
    "appliance repair Nepal",
    "घरायसी सेवा",
  ],
  openGraph: {
    type: "website",
    siteName: site.name,
    url: site.url,
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
    locale: "en_NP",
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.name} — ${site.tagline}`,
    description: site.description,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fff8e7" },
    { media: "(prefers-color-scheme: dark)", color: "#131a1e" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes sets `class` on <html> before
    // React hydrates, which would otherwise be reported as a mismatch.
    <html
      lang="en"
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
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MotionProvider>{children}</MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
