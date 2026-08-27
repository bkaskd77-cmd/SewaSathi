import type { Metadata, Viewport } from "next";
import {
  Fraunces,
  Noto_Sans_Devanagari,
  Plus_Jakarta_Sans,
} from "next/font/google";

import { ThemeProvider } from "@/components/shared/theme-provider";
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
  display: "swap",
  variable: "--font-display",
  axes: ["SOFT", "WONK"],
});

// Nepali copy renders in Devanagari; `:lang(ne)` in globals.css picks this up.
const nepali = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  display: "swap",
  variable: "--font-nepali",
});

export const metadata: Metadata = {
  title: {
    default: "Sewa[X] — Home services for Nepal",
    template: "%s · Sewa[X]",
  },
  description:
    "Verified plumbers, electricians, cleaners and repair professionals across Nepal — booked in minutes.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfcfb" },
    { media: "(prefers-color-scheme: dark)", color: "#171316" },
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
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
