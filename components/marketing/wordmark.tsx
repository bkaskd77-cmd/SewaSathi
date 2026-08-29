import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { site } from "@/lib/config/site";
import { cn } from "@/lib/utils";

/**
 * The brand mark. Two-tone: "Sajilo" in ink, "Kaam" in gold.
 *
 * Gold is 2.07:1 on ivory, so the accent word uses `gold-ink` — the
 * text-safe bronze from the token set. See CLAUDE.md.
 */
export function Wordmark({
  className,
  asLink = true,
}: {
  className?: string;
  asLink?: boolean;
}) {
  const t = useTranslations("common");
  const inner = (
    // lang="en": the wordmark is a name, not a word, and it stays in the
    // brand serif on a Nepali page rather than being swapped for the
    // Devanagari face along with the headings around it.
    <span
      lang="en"
      className={cn(
        "font-display text-display-sm font-bold tracking-tight",
        className,
      )}
    >
      {site.wordmark.lead}
      <span className="text-gold-ink">{site.wordmark.accent}</span>
    </span>
  );

  if (!asLink) return inner;

  return (
    <Link
      href="/"
      className="rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
      aria-label={t("wordmarkHome", { name: site.name })}
    >
      {inner}
    </Link>
  );
}
