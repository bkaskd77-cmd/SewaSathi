import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { AuthShell } from "@/components/auth/auth-shell";
import { PhoneForm } from "@/components/auth/phone-form";
import { Link, redirect } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth/session";
import { hasSupabaseConfig } from "@/lib/env";

export async function generateMetadata({
  params,
}: {
  params: { locale: string };
}): Promise<Metadata> {
  const t = await getTranslations({
    locale: params.locale,
    namespace: "admin.login",
  });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export const dynamic = "force-dynamic";

/**
 * The admin's own door.
 *
 * A DIFFERENT DOOR, THE SAME LOCK. Everything about how somebody proves who
 * they are is unchanged and reused: `PhoneForm`, the OTP path through
 * `lib/auth/otp.ts`, `strandsCustomer()`'s decision about when to offer a
 * phone number, and the shared `/verify` step. A second sign-in flow would be
 * a second place that knows which SMS gateway is in play, which is precisely
 * what the adapter rule exists to prevent — so this page contributes no auth
 * code at all. What it contributes is arriving somewhere that says "admin"
 * rather than through the customer's login screen.
 *
 * NO PASSWORD AND NO SIGN-UP, and both were asked for. A password is a
 * reusable secret that gets phished and leaked from other people's breaches;
 * a phone plus a TOTP device is something you hold. And a sign-up page anybody
 * can reach that mints admin accounts is an open door to every customer phone
 * number and identity document in the product. Admin accounts are provisioned,
 * never self-registered — see SECURITY.md.
 *
 * `next` IS FIXED TO /admin AND NOT READ FROM THE QUERY STRING. This page has
 * exactly one destination, so there is no intent to preserve and therefore no
 * `?next=` to validate — the open-redirect surface simply is not opened. The
 * customer `/login` still honours `?next=` through `safeRedirect`, because it
 * genuinely has somewhere to send people back to.
 */
export default async function AdminLoginPage() {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("admin.login");

  if (hasSupabaseConfig()) {
    const profile = await getSessionProfile();

    // Already an admin: this page has nothing to offer them.
    if (profile?.role === "admin") redirect({ href: "/admin", locale });

    /*
     * Signed in, but not an admin. A sign-in form cannot help somebody who is
     * already signed in, and rendering one is the dead end
     * `components/shared/empty-state.tsx` exists to rule out. It says which
     * account they are on — the usual cause is being on the wrong one — and
     * offers the way back rather than leaving them on a form that will not
     * work however many times they use it.
     */
    if (profile) {
      return (
        <AuthShell title={t("wrongAccountTitle")}>
          <p className="text-body-md text-muted-foreground">
            {t("wrongAccountBody", { name: profile.fullName ?? t("unnamed") })}
          </p>
          <Link
            href="/"
            className="animate-rise mt-4 inline-block text-body-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t("backHome")}
          </Link>
        </AuthShell>
      );
    }
  }

  return (
    <AuthShell title={t("title")} lead={t("lead")}>
      <PhoneForm next="/admin" />
    </AuthShell>
  );
}
