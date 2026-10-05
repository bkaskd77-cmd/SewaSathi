import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { StringEditor } from "@/components/admin/string-editor";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { editableStrings } from "@/lib/data/content";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Changing what the product says, without a deploy.
 *
 * WHAT THIS IS FOR. Every interface string lives in `messages/en.json` and
 * `messages/ne.json`, and every change to one has meant a commit, a review and a
 * deploy. That is the right process for behaviour and the wrong one for wording: the
 * person who knows a sentence is wrong is usually not the person who can push.
 *
 * BOTH LANGUAGES ON ONE ROW, because they are one decision. Editing the English of a
 * price explanation and leaving the Nepali is how the two catalogues come to say
 * different things — which `check:messages` cannot catch, since it compares keys and
 * placeholders rather than meanings. Seeing them side by side is the only guard against
 * that which exists.
 *
 * THE CATALOGUE IS STILL THE SOURCE OF TRUTH. This screen lists what the JSON holds and
 * shows overrides on top of it, so a key removed from the catalogue disappears here
 * without anybody tidying a table, and `check:keys` goes on proving every key the code
 * asks for exists.
 *
 * `admin.*` IS NOT ON THIS SCREEN. 551 of the 1,855 keys are strings only staff read —
 * including the ones on this page. An admin who breaks the save button has broken the
 * thing they would need to fix it, and no customer ever sees the benefit.
 *
 * NO AI ANYWHERE HERE, as decided. Nothing suggests a translation, nothing rewrites a
 * sentence. The words a customer reads are a person's responsibility.
 */
export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.content");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/content", locale });
    }
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/content", locale });
  }

  const params = await searchParams;
  const first = (value: string | string[] | undefined) =>
    Array.isArray(value) ? (value[0] ?? null) : (value ?? null);

  const namespace = first(params.namespace);
  const tier = first(params.tier);

  const [rows, messages] = await Promise.all([
    editableStrings({
      namespace: namespace ?? undefined,
      tier: tier ?? undefined,
    }),
    getMessages(),
  ]);

  /*
   * THE NAMESPACES THAT EXIST, derived from the keys rather than listed. A hardcoded
   * list would be a third copy of a structure the catalogue already has, and would go
   * stale the first time somebody adds a namespace.
   */
  const namespaces = Array.from(
    new Set(rows.map((row) => row.key.split(".")[0])),
  ).sort();

  /* Capped, because 1,300 editable keys in one page is a browser that stops responding
     and a screen nobody can find anything on. The filter is how you narrow it. */
  const CAP = 120;
  const shown = rows.slice(0, CAP);

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 max-w-2xl text-body-md text-muted-foreground">
        {t("lead")}
      </p>

      <p className="animate-rise mt-3 text-body-sm">
        <Link
          href="/admin/content/categories"
          className="underline underline-offset-4 hover:text-primary"
        >
          {t("goToCategories")}
        </Link>
        {" · "}
        <Link
          href="/admin/content/documents"
          className="underline underline-offset-4 hover:text-primary"
        >
          {t("goToDocuments")}
        </Link>
      </p>

      {/* A plain GET form, so a filtered view is a shareable URL and this page ships
          no client JavaScript for its own navigation — the `/services` arrangement. */}
      <form method="get" className="animate-rise mt-6 flex flex-wrap items-end gap-3">
        <label className="text-body-sm">
          <span className="block font-medium">{t("namespace")}</span>
          <select
            name="namespace"
            defaultValue={namespace ?? ""}
            className="mt-1 h-11 rounded-lg border border-input bg-background px-3 text-body-sm"
          >
            <option value="">{t("allNamespaces")}</option>
            {namespaces.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-body-sm">
          <span className="block font-medium">{t("tier")}</span>
          <select
            name="tier"
            defaultValue={tier ?? ""}
            className="mt-1 h-11 rounded-lg border border-input bg-background px-3 text-body-sm"
          >
            <option value="">{t("allTiers")}</option>
            <option value="money">{t("tiers.money")}</option>
            <option value="safety">{t("tiers.safety")}</option>
            <option value="legal">{t("tiers.legal")}</option>
            <option value="none">{t("tiers.none")}</option>
          </select>
        </label>

        <button
          type="submit"
          className="btn-tactile h-11 rounded-lg border border-border px-4 text-body-sm font-medium"
        >
          {t("filter")}
        </button>
      </form>

      <p className="animate-rise mt-4 text-caption text-muted-foreground">
        {rows.length > CAP
          ? t("showingCapped", {
              n: String(shown.length),
              total: String(rows.length),
            })
          : t("showing", { n: String(rows.length), count: rows.length })}
      </p>

      {rows.length === 0 ? (
        <p className="animate-rise mt-8 text-body-md text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
          <ul className="mt-6 space-y-3">
            {shown.map((row, index) => (
              <li
                key={row.key}
                className="animate-rise rounded-lg border border-border p-4"
                style={{ animationDelay: `${Math.min(index * 0.02, 0.2)}s` }}
              >
                <StringEditor row={row} />
              </li>
            ))}
          </ul>
        </NextIntlClientProvider>
      )}
    </section>
  );
}
