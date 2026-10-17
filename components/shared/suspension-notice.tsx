import { getTranslations } from "next-intl/server";
import { ShieldAlert } from "lucide-react";

import { site, supportPhoneDisplay, whatsappHref } from "@/lib/config/site";

/**
 * What a suspended person is told, on the screens they will actually open.
 *
 * SOMEBODY STOPPED BY US IS OWED A SENTENCE, and before this they got nothing:
 * a professional at step 4 watched their listing vanish and their payout stop
 * with no explanation anywhere, and a suspended customer met one refusal at the
 * end of a five-screen booking flow. A product that acts on somebody without
 * telling them what changed is one they can only understand by experiment,
 * which is the trap `/providers/standards` exists to refuse — stated there for
 * thresholds and true here for consequences.
 *
 * PLAIN, AND NOT ALARMING. No warning colour on the card itself: this is
 * information, and a person reading it is already having a bad day. The icon
 * and the ink carry the weight.
 *
 * THE APPEAL IS A REAL ROUTE AND NOT AN INVITATION TO WRITE IN. WhatsApp first
 * where there is one, because it is what people in Nepal actually use and it
 * leaves the person a written thread they keep; the phone number after it, for
 * whoever would rather speak. `site.supportWhatsapp` is null when nothing is
 * configured, and then the card says the phone number alone rather than
 * offering a link that goes nowhere — a dead escape hatch on the screen
 * somebody reaches at their worst moment reads as contempt.
 */
export async function SuspensionNotice({
  audience,
  reason,
}: {
  audience: "provider" | "customer";
  /** Their own words from the admin who decided, or null if none was stored. */
  reason: string | null;
}) {
  const t = await getTranslations("suspension");

  const whatsapp = site.supportWhatsapp
    ? whatsappHref(site.supportWhatsapp, t("appealMessage"))
    : null;

  return (
    <section
      className="animate-rise rounded-lg border border-border bg-muted/40 p-5"
      aria-labelledby="suspension-notice"
    >
      <h2
        id="suspension-notice"
        className="flex items-center gap-2 text-heading-sm font-display text-foreground"
      >
        <ShieldAlert className="size-5 text-warning-ink" aria-hidden />
        {t(audience === "provider" ? "providerTitle" : "customerTitle")}
      </h2>

      <p className="mt-3 max-w-prose text-body-sm text-muted-foreground">
        {t(audience === "provider" ? "providerBody" : "customerBody")}
      </p>

      {reason ? (
        <p className="mt-3 max-w-prose text-body-sm text-foreground">
          {t("because", { reason })}
        </p>
      ) : null}

      <p className="mt-4 max-w-prose text-body-sm text-muted-foreground">
        {t("appealLead")}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {whatsapp ? (
          <a
            href={whatsapp}
            className="rounded-md bg-primary px-4 py-2 text-body-sm font-medium text-primary-foreground transition-transform active:scale-[0.98]"
          >
            {t("appealWhatsapp")}
          </a>
        ) : null}
        {supportPhoneDisplay ? (
          <a
            href={`tel:${site.supportPhone}`}
            className="text-body-sm text-foreground underline underline-offset-4"
          >
            {t("appealPhone", { number: supportPhoneDisplay })}
          </a>
        ) : null}
      </div>
    </section>
  );
}
