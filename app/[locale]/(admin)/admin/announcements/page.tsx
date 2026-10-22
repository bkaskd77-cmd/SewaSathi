import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import {
  AnnouncementCard,
  PublishAnnouncement,
  type AnnouncementCardData,
} from "@/components/admin/announcement-panel";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import { announcementStanding } from "@/lib/config/announcements";
import { allAnnouncements } from "@/lib/data/announcements-admin";

import {
  editAnnouncementAction,
  publishAnnouncementAction,
  setAnnouncementEnabledAction,
} from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The sentence above every page, and the three things a person can do to it.
 *
 * WHAT THIS REPLACES IS A COMMIT. "We are closed for Dashain", "payouts are a
 * day late this week", "do not use the gas line in Baneshwor until Friday" —
 * every one of those is published copy with a start and an end, and until now
 * the only way to say any of them was a deploy. A product that cannot tell its
 * customers something today is one that says nothing on the day it matters
 * most.
 *
 * GROUPED BY STANDING, NOT BY DATE, and `announcementStanding` is the one rule
 * that decides which group a row is in — the same function `showingNow` backs,
 * so this list cannot disagree with what a visitor is actually seeing. Three
 * groups because they are three different questions: what is up now, what is
 * about to be, and what is finished.
 *
 * NOTHING IS HIDDEN AND NOTHING IS DELETED. A withdrawn banner stays, quiet and
 * below, because the one action available on it — putting it back up — would
 * otherwise be unreachable, and because `security_events` holds the history
 * that a deleted row would leave pointing at nothing. `/admin/areas`' rule.
 *
 * A FAILED READ IS ITS OWN SENTENCE, where the banner itself renders nothing.
 * That split is the `allAreas` / `bookableAreas` posture: nobody visiting the
 * product came for a banner, so an error strip above every page would be noise
 * — but somebody opening THIS screen is asking, and "no announcements" over a
 * broken query is how a person publishes a second copy of a banner already up.
 */
export default async function AnnouncementsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.announcements");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut") {
      redirect({ href: "/login?next=/admin/announcements", locale });
    }
    // A 404 rather than a refusal: a signed-in customer learns nothing about
    // what exists here.
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/announcements", locale });
  }

  const [rows, messages] = await Promise.all([
    allAnnouncements(),
    getMessages(),
  ]);

  const now = new Date();
  const cards: AnnouncementCardData[] = (rows ?? []).map((row) => ({
    id: row.id,
    bodyEn: row.bodyEn,
    bodyNe: row.bodyNe,
    audience: row.audience,
    tone: row.tone,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    enabled: row.enabled,
    standing: announcementStanding(row, now),
  }));

  const groups = [
    { key: "showing", items: cards.filter((c) => c.standing === "showing") },
    { key: "scheduled", items: cards.filter((c) => c.standing === "scheduled") },
    { key: "over", items: cards.filter((c) => c.standing === "over") },
  ] as const;

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10">
      <header className="animate-rise">
        <h1 className="text-heading-lg font-display">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("lead")}</p>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {t("historyNote")}
        </p>
      </header>

      <NextIntlClientProvider locale={locale} messages={messages}>
        <div className="animate-rise mt-8" style={{ animationDelay: "60ms" }}>
          <PublishAnnouncement publish={publishAnnouncementAction} />
        </div>

        {rows === null ? (
          <p
            role="alert"
            className="animate-rise mt-8 rounded-lg border border-warning/40 bg-warning/5 p-4 text-body-sm"
          >
            {t("unreadable")}
          </p>
        ) : null}

        {/*
          AN EMPTY GROUP IS DROPPED RATHER THAN HEADED, because a permanent
          "nothing showing" heading is true every day for a year and stops being
          read — `ACTIVITY_FLOOR`'s reasoning, and `/admin/areas`' version of
          the same choice one screen over.
        */}
        {groups.map(({ key, items }) =>
          items.length === 0 ? null : (
            <div key={key}>
              <h2
                className={
                  "mt-10 text-body-sm font-semibold" +
                  (key === "showing" ? "" : " text-muted-foreground")
                }
              >
                {t(`groups.${key}` as "groups.showing", {
                  count: items.length,
                  n: String(items.length),
                })}
              </h2>
              <ul className="mt-3 space-y-3">
                {items.map((announcement, index) => (
                  <li
                    key={announcement.id}
                    className="animate-rise"
                    style={{
                      animationDelay: `${Math.min(index * 0.05, 0.25)}s`,
                    }}
                  >
                    <AnnouncementCard
                      announcement={announcement}
                      edit={editAnnouncementAction}
                      setEnabled={setAnnouncementEnabledAction}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ),
        )}

        {/*
          NOTHING AT ALL IS A REAL STATE AND IT SAYS SO ONCE. Distinct from the
          failed read above it, which is the whole reason `allAnnouncements`
          returns null rather than an empty list.
        */}
        {rows !== null && cards.length === 0 ? (
          <p className="animate-rise mt-8 text-body-sm text-muted-foreground">
            {t("none")}
          </p>
        ) : null}
      </NextIntlClientProvider>
    </section>
  );
}
