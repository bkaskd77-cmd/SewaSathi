import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/auth/onboarding-form";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { safeRedirect } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("onboardingTitle"), robots: { index: false } };
}

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("auth.onboarding");
  const next = safeRedirect(searchParams.next);
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards this route; this is the belt to its braces.
  if (!user) {
    redirect({
      href: `/login?next=${encodeURIComponent("/onboarding")}`,
      locale,
    });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();

  // Already onboarded — nobody should be asked their name twice.
  if (profile?.full_name) redirect({ href: next, locale });

  return (
    <AuthShell title={t("title")} lead={t("lead")}>
      <OnboardingForm next={next} />
    </AuthShell>
  );
}
