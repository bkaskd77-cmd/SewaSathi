import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { CategoryEditor } from "@/components/admin/category-editor";
import {
  AddCategory,
  CategoryStandingPanel,
} from "@/components/admin/category-standing";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { KEYWORD_RULES } from "@/lib/ai/mockTriage";
import { adminGate } from "@/lib/auth/admin-gate";
import { categoryReadiness } from "@/lib/config/category-readiness";
import { CATEGORY_ICONS } from "@/lib/config/icons";
import { categoryCopy } from "@/lib/config/services";
import { allCategories, getSubBands } from "@/lib/data/categories";

import {
  addCategoryAction,
  reopenCategoryAction,
  retireCategoryAction,
} from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The ten services, editable.
 *
 * WHY STRAIGHT TO `categories` AND NOT AN OVERRIDE TABLE. The interface strings get an
 * override because `messages/*.json` is the source of truth and has to stay that way —
 * three guards read it. Category copy is the opposite: the table is already the live
 * source, `lib/data/seed/categories.json` is already its fallback, and adding a layer on
 * top of something already editable would be two places to look for one answer.
 *
 * A FALLBACK IS NAMED RATHER THAN HIDDEN. If this render came from the seed, the table
 * was unreachable — so an edit would write somewhere nobody is reading from and appear to
 * do nothing. The screen says so and does not offer the forms, which is the `/services`
 * rule: a failed read must never look like a measured zero, and here it must not look
 * like a working editor either.
 *
 * NO PRICES. The band is `/admin/bands`.
 *
 * AND WHETHER WE SELL IT AT ALL IS HERE TOO, which is new. `is_active` has been
 * on this table since the first migration, read by its own policy AND by
 * `getCategories`' query, and nothing in the product could ever write it — so
 * withdrawing a trade meant a migration. One screen for "the trades we sell"
 * rather than a second one listing the same ten: the words and the standing are
 * two facts about one row, and splitting them would be two places to look.
 *
 * IT READS `allCategories`, NOT `getCategories`. A withdrawn trade has to stay
 * on this screen or it could never be sold again — and that read exists for a
 * second reason this screen found: `getCategory` misses a retired slug, and
 * both `/bookings/[id]` and `/provider/jobs` then print the bare slug, so
 * retiring a trade would have put `water-tank-cleaning` on a customer's own
 * booking page.
 */
export default async function CategoriesPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.content.categories");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/content/categories", locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/content/categories", locale });
  }

  /* ONE WAVE — the standing latency rule, and none of the three depends on
     another. `getSubBands` is here because `categoryReadiness` asks whether a
     trade has products to narrow to, which is one of the gaps nobody can see
     from the catalogue. */
  const [categories, subBands, messages] = await Promise.all([
    allCategories(),
    getSubBands(),
    getMessages(),
  ]);

  /*
   * `allCategories` ANSWERS NULL ON A FAILED READ rather than falling back to
   * the seed, which is what this screen needs: if the table was unreachable, an
   * edit would write where nothing is reading from and appear to do nothing. An
   * UNCONFIGURED clone gets the seed and is editable in name only — same
   * sentence, because in both cases a form here would be theatre.
   */
  const editable = categories !== null;

  /* The slugs the keyword matcher can actually return. `KEYWORD_RULES` is a
     hand-written list, and that matcher is what answers on every fallback
     path — so a trade missing from it is unreachable whenever the key is. */
  const keywordSlugs = new Set(KEYWORD_RULES.map((rule) => rule.category));

  const rows = (categories ?? []).map((category) => ({
    category,
    standing: {
      /* `categoryReadiness` carries the slug, so it is spread first and the
         fields below add to it rather than quietly overwriting one of them. */
      ...categoryReadiness({ category, keywordSlugs, subBands }),
      name: categoryCopy(category, locale).name,
      retiredAt: category.retiredAt,
      retiredReason: category.retiredReason,
    },
  }));

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10">
      <p className="animate-rise text-caption text-muted-foreground">
        <Link href="/admin/content" className="underline underline-offset-4">
          {t("backToStrings")}
        </Link>
      </p>

      <h1 className="animate-rise mt-2 font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      {editable ? (
        <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
          <ul className="mt-8 space-y-4">
            {rows.map(({ category, standing }, index) => (
              <li
                key={category.slug}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.04, 0.25)}s` }}
              >
                <CategoryEditor category={category} />
                <CategoryStandingPanel
                  category={standing}
                  retire={retireCategoryAction}
                  reopen={reopenCategoryAction}
                />
              </li>
            ))}
          </ul>

          {/* Below the ten, because opening a trade is the rarer act and the
              list is what somebody came here for. */}
          <div className="animate-rise mt-8">
            <AddCategory add={addCategoryAction} icons={CATEGORY_ICONS} />
          </div>
        </NextIntlClientProvider>
      ) : (
        <p
          role="status"
          className="animate-rise mt-8 rounded-lg border border-warning/30 bg-warning/[0.07] p-4 text-body-sm text-warning-ink"
        >
          {t("notEditable")}
        </p>
      )}
    </section>
  );
}
