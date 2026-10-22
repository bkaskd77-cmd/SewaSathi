import { AlertTriangle, Megaphone } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";

import {
  announcementBody,
  bannerFor,
  type AnnouncementViewer,
} from "@/lib/config/announcements";
import { liveAnnouncements } from "@/lib/data/announcements";
import { cn } from "@/lib/utils";

/**
 * The one sentence above the page, or nothing at all.
 *
 * A SERVER COMPONENT WITH NO CLIENT JAVASCRIPT, AND THAT DECIDES THE DESIGN.
 * This renders above every page in the product, including the landing page,
 * whose bundle budget is the tightest in the repository and which a lot of this
 * traffic reaches on a mid-range Android over 3G. A dismiss button would be a
 * Client Component plus `localStorage` plus a hydration boundary on a strip
 * that is usually absent — so there is no dismissal, and the shape of the
 * feature is what makes that right rather than a compromise: a banner shows
 * only inside a window somebody chose, and the answer to "this is in my way" is
 * that it stops. `ends_at` is the dismissal, and it is ours rather than each
 * visitor's, which is the honest arrangement for "we are closed on Sunday".
 *
 * IT IS NOT A LIVE REGION. `role="status"` and `aria-live` announce a change a
 * screen reader did not ask for; this is static markup in the document, present
 * before the first paint, so it is an ordinary labelled region — the same
 * reason `use-booking-channel` is the only thing in the product that claims to
 * be live, and nothing says "live" when it is.
 *
 * ONE BANNER, EVER. `bannerFor` picks it, in a stated order, for the reason
 * `attentionFor` returns one call to action per booking: two of these stacked
 * above a page is two things nobody reads.
 *
 * THE VIEWER IS THE CALLER'S TO NAME, because it is the one thing only the call
 * site knows — `(work)` is a professional, `(app)` and the landing page are a
 * customer. That is `notificationPath`'s `audience` argument one surface over,
 * and the reason it is a required prop rather than something derived from the
 * session: a signed-in professional reading `/services` is shopping, and the
 * frame around them is what says so.
 */
export async function AnnouncementBanner({
  viewer,
}: {
  viewer: AnnouncementViewer;
}) {
  const [announcements, locale, t] = await Promise.all([
    liveAnnouncements(),
    getLocale(),
    getTranslations("announcement"),
  ]);

  const banner = bannerFor(announcements, { now: new Date(), viewer });
  if (!banner) return null;

  const urgent = banner.tone === "urgent";
  const Icon = urgent ? AlertTriangle : Megaphone;

  return (
    <div
      className={cn(
        "animate-rise border-b",
        urgent
          ? "border-warning/30 bg-warning/[0.09]"
          : "border-border bg-muted/50",
      )}
    >
      <section
        aria-label={urgent ? t("urgentLabel") : t("label")}
        className="container flex items-start gap-2.5 py-2.5"
      >
        <Icon
          className={cn(
            "mt-0.5 size-4 shrink-0",
            urgent ? "text-warning-ink" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <p
          className={cn(
            "text-body-sm",
            urgent ? "font-medium text-warning-ink" : "text-foreground",
          )}
        >
          {announcementBody(banner, locale)}
        </p>
      </section>
    </div>
  );
}
