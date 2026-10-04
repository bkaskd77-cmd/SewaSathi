import { MessageCircle, Phone } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { site, supportPhoneDisplay, whatsappHref } from "@/lib/config/site";

/**
 * How to reach a person, from the two constants and nowhere else.
 *
 * A SERVER COMPONENT WITH NO STATE, so it costs nothing on any page that mounts it —
 * the one rule the header already enforces about `lib/supabase/client`, applied to a
 * contact line.
 *
 * WHATSAPP BESIDE THE NUMBER, NOT INSTEAD OF IT. There is no in-app chat in this
 * product and will not be before launch; `wa.me` reaches the app people already have,
 * costs nothing to run, and leaves them a history of what was said. There is no masked
 * relay either — a paid service, deferred until there is income — so this is our own
 * number, which is the one thing that makes it safe to publish.
 *
 * EITHER SIDE CAN BE MISSING AND NOTHING IS INVENTED. `site.supportPhone` and
 * `site.supportWhatsapp` are each null until somebody sets them, and a dead `wa.me`
 * link fails worse than a missing one: it opens an app and then a wall. Both unset
 * renders nothing at all, which is the honest state of a product with no support line.
 */
export async function SupportContact({ className }: { className?: string }) {
  const t = await getTranslations("common");
  if (!site.supportPhone && !site.supportWhatsapp) return null;

  return (
    <div className={className}>
      {site.supportPhone ? (
        <a
          href={`tel:${site.supportPhone}`}
          className="inline-flex items-center gap-1.5 text-caption font-medium text-primary underline-offset-4 hover:underline"
        >
          <Phone aria-hidden="true" className="size-3.5" />
          {supportPhoneDisplay}
        </a>
      ) : null}
      {site.supportWhatsapp ? (
        <a
          href={whatsappHref(site.supportWhatsapp)}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-4 inline-flex items-center gap-1.5 text-caption font-medium text-primary underline-offset-4 hover:underline"
        >
          <MessageCircle aria-hidden="true" className="size-3.5" />
          {t("whatsapp")}
        </a>
      ) : null}
    </div>
  );
}
