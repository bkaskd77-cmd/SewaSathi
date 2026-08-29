import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { BadgeCheck, HandCoins, Timer } from "lucide-react";

import { JoinForm } from "@/components/providers/join-form";
import { Card } from "@/components/ui/card";
import type { Locale } from "@/i18n/routing";
import { areaCity, areaName, areasByCity } from "@/lib/config/areas";
import { categoryCopy, SERVICE_CATEGORIES } from "@/lib/config/services";
import { openGraphFor } from "@/lib/seo";
import { joinAction } from "./actions";

/**
 * The supply side's front door.
 *
 * It was linked from the landing page — "Join as a professional", the call to
 * action for half the marketplace — and returned 404. Real onboarding is Phase
 * 10; this captures interest so it is not lost in the meantime, which is the
 * difference between launching with professionals and launching with none.
 */

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const locale = params.locale as Locale;
  const t = await getTranslations({ locale, namespace: "join" });

  return {
    title: t("title"),
    description: t("lead"),
    openGraph: openGraphFor({
      locale,
      href: "/providers/join",
      title: t("title"),
      description: t("lead"),
    }),
  };
}

const BENEFITS = [
  { key: "payouts", Icon: HandCoins },
  { key: "hours", Icon: Timer },
  { key: "verification", Icon: BadgeCheck },
] as const;

export default async function JoinPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("join");

  const trades = SERVICE_CATEGORIES.map((category) => ({
    value: category.slug,
    label: categoryCopy(category, locale).name,
  }));

  const areas = areasByCity(locale).map((group) => ({
    city: group.city,
    options: group.areas.map((area) => ({
      value: area.key,
      label: `${areaName(area, locale)} · ${areaCity(area, locale)}`,
    })),
  }));

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <p className="text-overline uppercase text-gold-ink">{t("eyebrow")}</p>
        <h1 className="mt-2 text-balance font-display text-display-md">
          {t("title")}
        </h1>
        <p className="mt-3 text-pretty text-body-md text-muted-foreground">
          {t("lead")}
        </p>
      </header>

      <ul
        className="animate-rise mt-6 grid gap-3 sm:grid-cols-3"
        style={{ animationDelay: "60ms" }}
      >
        {BENEFITS.map(({ key, Icon }, index) => (
          <li key={key}>
            <Card
              className="animate-rise flex h-full items-start gap-3 p-4"
              style={{ animationDelay: `${0.08 + index * 0.05}s` }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <Icon aria-hidden="true" className="size-[18px]" />
              </span>
              <p className="text-body-sm font-semibold leading-snug">
                {t(`benefits.${key}`)}
              </p>
            </Card>
          </li>
        ))}
      </ul>

      <div className="animate-rise mt-8" style={{ animationDelay: "240ms" }}>
        <JoinForm action={joinAction} trades={trades} areas={areas} />
      </div>
    </div>
  );
}
