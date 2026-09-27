import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { Eye, EyeOff, LogOut, Phone, User } from "lucide-react";

import { setActivityOptOutAction } from "@/app/[locale]/(app)/account/actions";
import { signOutAction } from "@/app/[locale]/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { readActivityOptOut } from "@/lib/data/profile-prefs";
import { formatE164ForDisplay } from "@/lib/auth";
import { site, supportPhoneDisplay } from "@/lib/config/site";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("accountTitle"), robots: { index: false, follow: false } };
}

// Each language names itself. Rendering "Nepali" in English to somebody whose
// preference is Nepali is the one place a translated label would be wrong.
const LANGUAGE_LABEL = {
  en: "English",
  ne: "नेपाली",
} as const;

/**
 * PLACEHOLDER — read-only until Phase 10, which adds the profile editor along
 * with addresses and payment. It exists now because the account menu links to
 * it and a 404 from your own menu reads as a broken product.
 *
 * Read-only is not a dead end: anything wrong here can be changed by phone
 * today, which is how most of this will be corrected anyway.
 */
export default async function AccountPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("booking.account");
  const tNav = await getTranslations("nav");

  // The middleware already guards this route. Repeated here because a page
  // that reads a session should not depend on something else having checked.
  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Faccount", locale });
  }

  /*
   * A SECOND WAVE, because it needs the profile id — and NOT a widening of
   * `getSessionProfile`. That object is held by the site header on every page in
   * the product; a preference one screen needs does not belong in it, and the
   * read it already makes is not made cheaper by carrying a column nobody else
   * asks for.
   */
  const hiddenFromActivity = await readActivityOptOut(profile.id);

  const rows = [
    {
      icon: User,
      label: t("name"),
      value: profile.fullName?.trim() || t("nameUnset"),
      muted: !profile.fullName?.trim(),
      lang: undefined,
    },
    {
      icon: Phone,
      label: t("mobile"),
      value: profile.phone
        ? formatE164ForDisplay(profile.phone)
        : t("mobileUnset"),
      muted: !profile.phone,
      lang: undefined,
    },
    {
      icon: null,
      label: t("language"),
      value: LANGUAGE_LABEL[profile.preferredLanguage],
      muted: false,
      // Devanagari has its own face; :lang(ne) in globals.css picks it up.
      lang: profile.preferredLanguage === "ne" ? "ne" : undefined,
    },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="font-display text-display-md">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
      </header>

      <Card
        className="animate-rise mt-8 divide-y divide-border"
        style={{ animationDelay: "60ms" }}
      >
        {rows.map(({ icon: Icon, label, value, muted, lang }) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 px-5 py-4"
          >
            <span className="flex items-center gap-2.5 text-body-sm text-muted-foreground">
              {Icon ? (
                <Icon aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <span aria-hidden="true" className="size-4 shrink-0" />
              )}
              {label}
            </span>
            <span
              lang={lang}
              className={
                muted
                  ? "text-right text-body-md text-muted-foreground"
                  : "text-right text-body-md font-semibold"
              }
            >
              {value}
            </span>
          </div>
        ))}
      </Card>

      <p
        className="animate-rise mt-4 text-caption text-muted-foreground"
        style={{ animationDelay: "120ms" }}
      >
        {/* Without a line to ring, the useful half of the sentence survives
            on its own — when editing arrives — and the half that would send
            somebody to a dead number does not. */}
        {site.supportPhone
          ? t.rich("changeNote", {
              number: supportPhoneDisplay ?? "",
              phone: (chunks) => (
                <a
                  href={`tel:${site.supportPhone}`}
                  className="text-foreground underline underline-offset-2"
                >
                  {chunks}
                </a>
              ),
            })
          : t("changeNoteNoPhone")}
      </p>

      {/* ---------------- the activity strip opt-out ---------------- */}
      {/*
        THE ONE THING ON THIS SCREEN THAT CAN BE CHANGED, and it is here rather
        than in the booking flow on purpose: one setting somebody can find and
        reason about once, applying to everything they have booked and everything
        they book later, rather than a checkbox they must notice every time.

        A PLAIN FORM AND A SUBMIT BUTTON, so this page still ships no client
        JavaScript. The hidden field carries the value being asked for rather
        than a flip, so a stale page or a double tap cannot put somebody back
        into a feed they have just left.

        UNAVAILABLE IS NOT OFF. `readActivityOptOut` returns null when it could
        not ask, and a toggle rendered as "off" on a failed read would tell
        somebody they are visible when nobody knows — the same mistake as a
        failed catalogue read rendering as an empty catalogue.
      */}
      <Card
        className="animate-rise mt-8 p-5"
        style={{ animationDelay: "150ms" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2.5 text-body-md font-semibold">
              {hiddenFromActivity ? (
                <EyeOff aria-hidden="true" className="size-4 shrink-0" />
              ) : (
                <Eye aria-hidden="true" className="size-4 shrink-0" />
              )}
              {t("activityTitle")}
            </h2>
            <p className="mt-2 text-body-sm text-muted-foreground">
              {t("activityBody")}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {hiddenFromActivity === null
                ? t("activityUnknown")
                : hiddenFromActivity
                  ? t("activityHidden")
                  : t("activityShown")}
            </p>
          </div>
        </div>

        {hiddenFromActivity === null ? null : (
          <form action={setActivityOptOutAction} className="mt-4">
            <input
              type="hidden"
              name="hidden"
              value={hiddenFromActivity ? "false" : "true"}
            />
            <Button type="submit" variant="outline" className="btn-tactile">
              {hiddenFromActivity ? t("activityShowMe") : t("activityHideMe")}
            </Button>
          </form>
        )}
      </Card>

      {/*
        Log out is in the header menu too, but that menu is a hover-sized
        target on desktop and a second tap on mobile. Somebody who came here
        to leave should find the door on the page.
      */}
      <form
        action={signOutAction}
        className="animate-rise mt-8"
        style={{ animationDelay: "180ms" }}
      >
        <Button type="submit" variant="outline" className="btn-tactile">
          <LogOut aria-hidden="true" />
          {tNav("logOut")}
        </Button>
      </form>
    </div>
  );
}
