import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { AiLimitsForm } from "@/components/admin/ai-limits-form";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { adminGate } from "@/lib/auth/admin-gate";
import {
  AI_LIMIT_BOUNDS,
  AI_LIMIT_KEYS,
  nepalDayEndsAt,
} from "@/lib/config/ai-limits";
import { readAiLimits, readSpendToday } from "@/lib/data/ai-ceilings";
import { LIMITS } from "@/lib/server/rate-limit";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Every ceiling on what the AI may cost, on one screen, editable.
 *
 * ONE SCREEN BECAUSE THE ABUSE SURFACE IS ONLY READABLE AT ONCE — which is also how you
 * notice the one that is missing. `lib/server/rate-limit.ts` makes the same argument
 * about its own `LIMITS`, and the rate ceilings are printed here beside the AI ones for
 * that reason: a person asking "what stops this costing money" should not have to know
 * that the answer lives in two files with different lifetimes.
 *
 * THE RATE LIMITS ARE READ-ONLY HERE AND THE AI ONES ARE NOT, deliberately. A rate limit
 * is a shape of the product — twelve a minute is "not a script" — and changing one is a
 * code change somebody reviews. The AI ceilings are a budget, which is a thing an owner
 * changes on a Tuesday because the bill came in.
 *
 * TODAY'S SPEND IS SHOWN ABOVE THE FORM, not below it: the number somebody came here to
 * change is almost always the budget, and the only honest basis for changing it is what
 * it has actually cost. A form with no measurement above it invites a guess.
 */
export default async function AiLimitsPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.aiLimits");

  const gate = await adminGate();
  if (!gate.ok) {
    if (gate.reason === "signedOut")
      redirect({ href: "/login?next=/admin/ai-limits", locale });
    if (gate.reason === "notAdmin") notFound();
    redirect({ href: "/account/security?next=/admin/ai-limits", locale });
  }

  const limits = await readAiLimits();
  const [spend, messages] = await Promise.all([
    readSpendToday(limits),
    getMessages(),
  ]);

  const money = (usd: number) => `$${usd.toFixed(4)}`;

  return (
    <section className="animate-rise mx-auto w-full max-w-3xl px-4 py-8">
      <h1 className="text-h3 font-semibold text-foreground">{t("title")}</h1>
      <p className="text-body-sm mt-2 text-muted-foreground">{t("lead")}</p>

      {/* WHAT TODAY HAS COST, measured from what the provider reported on each call —
          never from our own token estimate, which drifts from the bill in the direction
          nobody notices. A failed read says so rather than printing a zero. */}
      <div className="mt-6 rounded-xl border border-border bg-card p-4">
        <h2 className="text-body-sm font-semibold text-foreground">
          {t("today", { day: spend.dayKey })}
        </h2>
        {!spend.read ? (
          <p className="text-caption mt-2 text-warning-ink">{t("spendUnread")}</p>
        ) : (
          <ul className="text-body-sm mt-2 space-y-1 text-muted-foreground">
            <li>
              {t("spent", {
                spent: money(spend.spentUsd),
                budget: money(limits.dailyBudgetUsd),
                calls: String(spend.calls),
              })}
            </li>
            <li>
              {t("visitorSpent", {
                spent: money(spend.visitorSpentUsd),
                left: money(spend.visitorRemainingUsd),
                calls: String(spend.visitorCalls),
              })}
            </li>
            <li>{t("userLeft", { left: money(spend.userRemainingUsd) })}</li>
            <li>{t("photoCalls", { calls: String(spend.photoCalls) })}</li>
            {spend.unknownModelCalls > 0 ? (
              /* The one line here that is a warning. Non-zero means somebody changed the
                 model and the budget has been pricing at the dearest rate it knows. */
              <li className="text-warning-ink">
                {t("unknownModel", { calls: String(spend.unknownModelCalls) })}
              </li>
            ) : null}
            <li>{t("resets", { time: nepalDayEndsAt().toISOString().slice(11, 16) })}</li>
          </ul>
        )}
      </div>

      <NextIntlClientProvider locale={locale} messages={{ admin: messages.admin }}>
        <AiLimitsForm
          limits={limits}
          bounds={AI_LIMIT_BOUNDS}
          keys={AI_LIMIT_KEYS}
        />
      </NextIntlClientProvider>

      {/*
        THE RATE LIMITS, READ-ONLY. Printed from `LIMITS` itself rather than copied, so a
        ceiling added in code appears here without anybody remembering — the same reason
        `SECURITY.md`'s table has a test behind it.
      */}
      <div className="mt-8 rounded-xl border border-border bg-card p-4">
        <h2 className="text-body-sm font-semibold text-foreground">
          {t("rateTitle")}
        </h2>
        <p className="text-caption mt-1 text-muted-foreground">{t("rateLead")}</p>
        <table className="mt-3 w-full text-left">
          <thead>
            <tr className="text-caption text-muted-foreground">
              <th className="py-1 font-normal">{t("rateName")}</th>
              <th className="py-1 font-normal">{t("ratePerMinute")}</th>
              <th className="py-1 font-normal">{t("ratePerHour")}</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(LIMITS).map(([name, limit]) => (
              <tr key={name} className="text-body-sm border-t border-border">
                <td className="py-1 font-mono">{name}</td>
                <td className="py-1">{limit.perMinute}</td>
                <td className="py-1">{limit.perHour}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
