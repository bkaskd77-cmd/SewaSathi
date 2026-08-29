import { getTranslations } from "next-intl/server";
import { Search, X } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { Link } from "@/i18n/navigation";

/**
 * Search the catalogue by whatever people call the trade.
 *
 * A plain `<form method="get">` — no client component, no router, no
 * JavaScript at all. The whole page stays a Server Component and the search
 * works on a phone that never finishes loading a bundle, which is a real
 * fraction of this traffic. Submitting is a navigation, so the result is a
 * shareable URL and the back button behaves.
 *
 * The matching lives in lib/data/synonyms.ts, shared with the triage keyword
 * matcher, because the word somebody types here and the word they type into
 * the hero are the same word.
 *
 * `buttonVariants` rather than `<Button>`: the component is `"use client"` for
 * its `asChild` prop, and importing it here put Radix Slot and 12 kB of client
 * bundle on a page that runs no JavaScript at all.
 */
export async function CategorySearch({ query }: { query: string | null }) {
  const t = await getTranslations("services");

  return (
    <form
      method="get"
      action="/services"
      role="search"
      className="mt-6 flex flex-wrap items-center gap-2"
    >
      <label htmlFor="category-search" className="sr-only">
        {t("searchLabel")}
      </label>

      {/* Full width on a phone, with the buttons wrapping underneath — at
          390px the three of them on one row left the input about 200px wide,
          which is not enough to read back what you typed. */}
      <div className="flex h-11 w-full min-w-0 items-center gap-2.5 rounded-lg border border-input bg-card px-3 transition-colors focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background sm:w-auto sm:max-w-md sm:flex-1">
        <Search
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <input
          id="category-search"
          name="q"
          type="search"
          defaultValue={query ?? ""}
          placeholder={t("searchPlaceholder")}
          autoComplete="off"
          className="h-full w-full min-w-0 bg-transparent text-body-sm outline-none placeholder:text-muted-foreground/80"
        />
      </div>

      <button
        type="submit"
        className={buttonVariants({
          variant: "gold",
          className: "btn-tactile",
        })}
      >
        {t("searchSubmit")}
      </button>

      {query ? (
        <Link href="/services" className={buttonVariants({ variant: "ghost" })}>
          <X aria-hidden="true" />
          {t("searchClear")}
        </Link>
      ) : null}
    </form>
  );
}
