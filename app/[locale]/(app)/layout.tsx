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

  return (
    <div className="flex min-h-dvh flex-col">
      {/*
        A signed-in visitor with no name yet (they closed the tab during
        onboarding) still gets the account menu rather than a "Sign in" button
        that would take them nowhere new.
      */}
      <SiteHeader
        accountName={profile ? (profile.fullName ?? t("account")) : null}
        /* The door to the working side, and it opens on OWNING A LISTING
           rather than on a role. `admin` passes the route guard so support can
           reach a professional's screen, but an admin with no listing has no
           work — and putting "My work" in their menu is the entity blur this
           split exists to remove. Permission to reach a screen and a reason to
           go there are different questions. */
        worksHere={profile?.providerId != null}
      />

      <main id="main" className="container flex-1 py-10 sm:py-14">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
