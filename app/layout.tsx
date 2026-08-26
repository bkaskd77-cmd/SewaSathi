import type { Metadata, Viewport } from "next";
import {
  Noto_Sans_Devanagari,
  Plus_Jakarta_Sans,
  Sora,
} from "next/font/google";

import { ThemeProvider } from "@/components/shared/theme-provider";
import "@/styles/globals.css";

const sans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const display = Sora({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
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
    { media: "(prefers-color-scheme: light)", color: "#fbfefc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1413" },
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
