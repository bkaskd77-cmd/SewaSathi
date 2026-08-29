import { getLocale, getTranslations } from "next-intl/server";
import { Compass } from "lucide-react";

import { SiteFooter } from "@/components/marketing/footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { getSessionProfile } from "@/lib/auth/session";

/**
 * The 404, inside the locale segment.
 *
 * With `localePrefix: "as-needed"` an unknown path is rewritten to the reader's
 * locale before it gets here (see app/[locale]/[...rest]/page.tsx), so a Nepali
 * visitor who mistypes a URL is told so in Nepali — and lands on a page with
 * the Nepali header still attached, rather than being dropped into a bare
 * English shell.
 *
 * `lang` is on this wrapper rather than only on <html>: Next renders a
 * not-found from a dynamic segment inside its own error shell, and that shell
 * carries no `lang`. Without this the Devanagari face never loads here and a
 * screen reader announces Nepali in an English voice.
 */
export default async function NotFound() {
  const [profile, locale, t] = await Promise.all([
    getSessionProfile(),
    getLocale(),
    getTranslations("notFound"),
  ]);

  return (
    <div lang={locale} className="flex min-h-dvh flex-col">
      <SiteHeader accountName={profile?.fullName ?? null} />

      <main id="main" className="container flex-1 py-16">
        <div className="mx-auto w-full max-w-xl">
          <EmptyState
            icon={Compass}
            title={t("title")}
            description={t("body")}
            action={
              <Button variant="gold" size="lg" asChild className="btn-tactile">
                <Link href="/services">{t("action")}</Link>
              </Button>
            }
          />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
