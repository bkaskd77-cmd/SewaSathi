import { getTranslations } from "next-intl/server";

import { SiteFooter } from "@/components/marketing/footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { headerIdentity } from "@/lib/auth";
import { getSessionProfile } from "@/lib/auth/session";

/**
 * Frame for the signed-in pages.
 *
 * Same header and footer as the landing page, so signing in does not drop you
 * into a different-looking product. The profile is read here rather than in
 * each page: the header needs it, and one request per navigation is enough.
 *
 * THAT RULE IS ABOUT CUSTOMERS AND WAS ONCE APPLIED TOO WIDELY. A customer who
 * signs in is still shopping, so the catalogue chrome is right for them. A
 * professional is working, and wearing the same clothes made the two halves of
 * the product indistinguishable for the one person who uses both. The
 * professional screens live in `(work)` now and have their own frame.
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

  /*
   * One function decides every door — see `headerIdentity`. This layout used
   * to be the only caller that got all three props right; the landing page and
   * the not-found shell each worked them out separately and each got a
   * different subset, which is how the Admin item appeared here and vanished
   * on the homepage.
   */
  const identity = headerIdentity({
    signedIn: profile != null,
    fullName: profile?.fullName ?? null,
    role: profile?.role ?? null,
    providerId: profile?.providerId ?? null,
    fallbackName: t("account"),
  });

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        A signed-in visitor with no name yet (they closed the tab during
        onboarding) still gets the account menu rather than a "Sign in" button
        that would take them nowhere new.
      */}
      <SiteHeader {...identity} />

      <main id="main" className="container flex-1 py-10 sm:py-14">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
