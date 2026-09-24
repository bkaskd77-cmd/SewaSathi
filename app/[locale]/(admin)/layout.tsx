import { getTranslations } from "next-intl/server";

import { AdminHeader } from "@/components/admin/admin-header";
import { getSessionProfile } from "@/lib/auth/session";
import { site, supportPhoneDisplay } from "@/lib/config/site";

/**
 * Frame for the deciding side of the product.
 *
 * A THIRD ROUTE GROUP, FOR THE SAME REASON THERE WAS A SECOND. The admin
 * queues used to sit in `(app)` and inherited the customer frame whole — the
 * marketing header with "Book a service" in it, the catalogue footer, and an
 * account menu offering Bookings and Account. Opening `/admin` showed the
 * customer product with a queue in the middle of it, which is how somebody
 * holding the most dangerous permissions here ends up unable to tell which
 * half of the product they are looking at.
 *
 * The URLs did not move. `/admin` and everything under it are the same paths
 * with the same guards; only the frame changed.
 *
 * THE GATE IS NOT HERE, AND THAT IS DELIBERATE. Every page calls `adminGate()`
 * for itself, because a layout that refused would still have to be repeated by
 * each server action anyway — and a guard somebody can forget to add is worse
 * than one that is obviously per-page. What the layout must not do is leak:
 * the header is chrome, so it renders for anybody who reaches a page, and
 * every page underneath has already decided whether they may see its contents.
 *
 * NO MARKETING FOOTER. One line and a phone number, like the work group: an
 * admin resolving somebody's refund does not need the about page, and the
 * support number is the one thing that is still useful from here.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [profile, t] = await Promise.all([
    getSessionProfile(),
    getTranslations("admin.chrome"),
  ]);

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AdminHeader name={profile?.fullName ?? t("unnamed")} />

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
