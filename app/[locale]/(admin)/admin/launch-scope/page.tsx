import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { LaunchScopePanel } from "@/components/admin/launch-scope-panel";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { areaLabel } from "@/lib/config/areas";
import { categoryCopy } from "@/lib/config/services";
import { allAreas } from "@/lib/data/areas";
import { allCategories } from "@/lib/data/categories";
import { launchScope } from "@/lib/data/launch-scope";

import { setLaunchScopeAction } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Start small, widen without a deploy.
 *
 * WHAT THIS IS NOT. It is not retirement. `/admin/areas` and
 * `/admin/content/categories` decide which wards and trades EXIST, and
 * withdrawing one there records that we stopped, with a reason and an actor.
 * This screen decides which of the live ones are open to CUSTOMERS today, which
 * is a third state — not yet opened — and the whole reason `launch_scope` is a
 * table rather than a loop over the other two. Soft-launching thirteen wards
 * through retirement would demand thirteen reasons for a thing nobody withdrew
 * and would write a history saying we pulled out of Kathmandu and went back in.
 *
 * `allAreas()` AND `allCategories()`, which is `/admin/areas`' own choice and
 * its reason: this is the one kind of screen that wants the retired rows.
 * Hiding them would silently drop a retired key from the form on the next save
 * — a change nobody made, appearing in the audit row — and the live/retired
 * split is what `scopeStanding` needs to tell "narrowed" from "closed".
 *
 * PROFESSIONALS ARE DELIBERATELY NOT NARROWED BY ANY OF THIS, and it is worth
 * saying on the screen as well as here: `/providers/join` keeps reading
 * `bookableAreas()`, because you have to be able to recruit in a ward before
 * you can open it, and a soft launch that stopped recruitment would prevent the
 * thing that ends it.
 */
export default async function LaunchScopePage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.launchScope");
  /* The word "Ward" is catalogue copy, not data — `lib/config/areas.ts` holds
     only the place names. Same helper the booking flow builds. */
  const tServices = await getTranslations("services");
  const ward = (n: number) => tServices("ward", { n: String(n) });

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/launch-scope", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about
    // what exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/launch-scope", locale });
  }

  const [scope, areas, categories, messages] = await Promise.all([
    launchScope(),
    allAreas(),
    allCategories(),
    getMessages(),
  ]);

  /*
   * AN UNREADABLE SCOPE IS A SENTENCE HERE, never an empty form.
   *
   * This is the `allAnnouncements()` rule: nobody came to the landing page for
   * a banner, so a failed read renders nothing there — but somebody IS asking
   * on this screen, and rendering the form with every box unticked would invite
   * a save that writes "nothing is open" over a scope we simply could not read.
   * `allCategories` is null on its own failure for the same reason: with no
   * list of trades there is nothing to tick.
   */
  if (scope === null || categories === null) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-10">
        <header className="animate-rise">
          <h1 className="text-heading-lg font-display">{t("title")}</h1>
        </header>
        <p className="animate-rise mt-6 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-md">
          {t("unreadable")}
        </p>
      </section>
    );
  }

  const areaOptions = areas.map((area) => ({
    value: area.key,
    label: areaLabel(area, locale, ward(area.wardNumber)),
    retired: area.retiredAt !== null,
  }));

  const categoryOptions = categories.map((category) => ({
    value: category.slug,
    label: categoryCopy(category, locale).name,
    retired: category.retiredAt !== null,
  }));

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="text-heading-lg font-display">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("notRetirement")}
        </p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("providersUnaffected")}
        </p>
      </header>

      <NextIntlClientProvider locale={locale} messages={messages}>
        <div className="animate-rise" style={{ animationDelay: "60ms" }}>
          <LaunchScopePanel
            scope={scope}
            areas={areaOptions}
            categories={categoryOptions}
            save={setLaunchScopeAction}
          />
        </div>
      </NextIntlClientProvider>
    </section>
  );
}
