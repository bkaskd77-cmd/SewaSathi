import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyForm } from "@/components/auth/verify-form";
import { redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { checkNepaliMobile } from "@/lib/auth";
import { safeRedirect } from "@/lib/auth";

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const params = await props.params;
  const t = await getTranslations({ locale: params.locale, namespace: "meta" });
  return { title: t("verifyTitle"), robots: { index: false } };
}

export default async function VerifyPage(props: {
  searchParams: Promise<{ phone?: string; next?: string }>;
}) {
  const searchParams = await props.searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("auth.verify");
  const next = safeRedirect(searchParams.next);
  const check = checkNepaliMobile(searchParams.phone ?? "");

  // Landing here without a valid number means a stale link or a refresh after
  // the query was lost — send them back to enter it rather than showing six
  // boxes that can never succeed.
  if (!check.ok) {
    redirect({ href: `/login?next=${encodeURIComponent(next)}`, locale });
  }

  return (
    <AuthShell title={t("title")} lead={t("lead")}>
      <VerifyForm phone={check.e164} next={next} />
    </AuthShell>
  );
}
