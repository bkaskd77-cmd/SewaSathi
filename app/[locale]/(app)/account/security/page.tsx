import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";

import { MfaSetup } from "@/components/auth/mfa-setup";
import { SessionDebug } from "@/components/auth/session-debug";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import {
  accessTokenLifetimeSeconds,
  securityState,
} from "@/lib/auth/admin-gate";
import { getSessionProfile } from "@/lib/auth/session";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

/**
 * Where a second factor is set up, and where an admin proves it again.
 *
 * DELIBERATELY NOT BEHIND THE ADMIN GATE. This is the screen an admin without
 * a factor is SENT to, so gating it on having passed the gate would be a
 * locked door with its key inside — and with one admin account in production,
 * that is not a hypothetical. Any signed-in person may reach it and add a
 * factor to their own account if they want one.
 *
 * ONE SCREEN, THREE STATES: not set up, set up and this session has proved it,
 * set up and it needs proving. They are the same question to the person in
 * front of them.
 */
export default async function SecurityPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("auth.mfa");

  const profile = await getSessionProfile();
  if (!profile) {
    redirect({ href: "/login?next=%2Faccount%2Fsecurity", locale });
  }

  const [state, lifetime, messages] = await Promise.all([
    securityState(),
    // Observed from this session's own token. The configured value lives in
    // the Supabase dashboard and needs a management token to read, which is
    // one more credential than this is worth — `exp - iat` is the same number.
    accessTokenLifetimeSeconds(),
    getMessages(),
  ]);

  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-10">
      <h1 className="animate-rise font-display text-display-sm">{t("title")}</h1>
      <p className="animate-rise mt-2 text-body-md text-muted-foreground">
        {profile!.role === "admin"
          ? t("leadAdmin", { hours: String(state.stepUpHours) })
          : t("lead")}
      </p>

      <NextIntlClientProvider locale={locale} messages={{ auth: messages.auth }}>
        <MfaSetup
          hasFactor={state.hasFactor}
          needsCode={state.needsCode}
        />
        <SessionDebug
          accessTokenSeconds={lifetime}
          stepUpHours={state.stepUpHours}
        />
      </NextIntlClientProvider>
    </section>
  );
}
