import { getTranslations } from "next-intl/server";

import { WorkHeader } from "@/components/provider/work-header";
import { site, supportPhoneDisplay } from "@/lib/config/site";
import { getSessionProfile } from "@/lib/auth/session";

/**
 * Frame for the working side of the product.
 *
 * A SEPARATE ROUTE GROUP, NOT A DIFFERENT SET OF CARDS. The professional
 * screens used to sit in `(app)` and inherited its whole frame — the marketing
 * header with "Book a service" in it, the full footer with the catalogue, the
 * about page and the legal links. That frame is right for a customer, who is
 * still shopping after they sign in. It is wrong for a professional, who is
 * working, and it made the two halves of the product indistinguishable at a
 * glance for the one person who uses both.
 *
 * The URLs did not move. `/provider` and `/provider/jobs` are the same paths
 * with the same guards; only the frame around them changed.
 *
 * THE FOOTER IS ONE LINE AND IT IS A PHONE NUMBER. A professional standing in
 * somebody's kitchen with a problem needs to reach a person, not to read about
 * us. Everything else that was down there — services, careers, the legal pages
 * — is for somebody deciding whether to buy, which is not what this surface is
 * for.
 */
export default async function WorkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, t] = await Promise.all([
    getSessionProfile(),
    getTranslations("provider.chrome"),
  ]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      {/* The LISTING's name, not the account's. They are not always the same,
          and the one that matters here is the one a customer is expecting at
          their door. */}
      <WorkHeader
        name={profile?.providerName ?? profile?.fullName ?? t("unnamed")}
      />

      <main id="main" className="container flex-1 py-8 sm:py-10">
        {children}
      </main>

      <footer className="border-t border-border py-6">
        <div className="container flex flex-wrap items-center justify-between gap-2">
          <p className="text-caption text-muted-foreground">{t("footerNote")}</p>
          {site.supportPhone ? (
            <a
              href={`tel:${site.supportPhone}`}
              className="text-caption font-medium text-primary underline-offset-4 hover:underline"
            >
              {supportPhoneDisplay}
            </a>
          ) : null}
        </div>
      </footer>
    </div>
  );
}
