import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { PhoneForm } from "@/components/auth/phone-form";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { safeRedirect } from "@/lib/auth/routes";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("loginTitle"), description: t("loginDescription") };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("auth.login");
  const next = safeRedirect(searchParams.next);

  if (hasSupabaseConfig()) {
    const {
      data: { user },
    } = await createClient().auth.getUser();
    if (user) redirect({ href: next, locale });
  }

  return (
    <AuthShell title={t("title")} lead={t("lead")}>
      <PhoneForm next={next} />
    </AuthShell>
  );
}
