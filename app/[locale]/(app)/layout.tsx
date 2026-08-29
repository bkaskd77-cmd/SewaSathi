import { getTranslations } from "next-intl/server";

import { SiteFooter } from "@/components/marketing/footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { getSessionProfile } from "@/lib/auth/session";

/**
 * Frame for the signed-in pages.
 *
 * Same header and footer as the landing page, so signing in does not drop you
 * into a different-looking product. The profile is read here rather than in
 * each page: the header needs it, and one request per navigation is enough.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, t] = await Promise.all([
    getSessionProfile(),
    getTranslations("nav"),
  ]);

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        A signed-in visitor with no name yet (they closed the tab during
        onboarding) still gets the account menu rather than a "Sign in" button
        that would take them nowhere new.
      */}
      <SiteHeader
        accountName={profile ? (profile.fullName ?? t("account")) : null}
      />

      <main id="main" className="container flex-1 py-10 sm:py-14">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
