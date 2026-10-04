"use client";

import { useTranslations } from "next-intl";
import { MessageCircle, Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Reach the customer, and record that you tried.
 *
 * ONE COMPONENT FOR BOTH PLACES THE NUMBER APPEARS — the job card's quiet link and
 * the arrival panel's full-width buttons. They used to be two separate `tel:` links
 * and only one of them existed; now the recording lives here, so a second surface
 * cannot be added without it. A tap logged on one screen and not the other would make
 * the count depend on which button somebody happened to use.
 *
 * WHATSAPP BESIDE THE CALL, NOT INSTEAD OF IT. There is no in-app chat in this
 * product and there is not going to be one before launch — a `wa.me` link reaches the
 * app every customer already has, with their own notifications and their own history,
 * and costs nothing to run. There is no masked relay either: that is a paid service
 * and is deferred until there is income to pay for it, so these open the customer's
 * real number, inside the window `provider_contacts` already releases it in.
 *
 * THE LOGGING NEVER DELAYS THE NAVIGATION. The anchor is a real anchor and the write
 * is fired beside it, unawaited. Somebody standing at a locked gate must never find
 * the dialler hesitating because a log row was in flight — and a failed write costs a
 * count, where a blocked tap costs the call.
 */
export type ContactChannel = "call" | "whatsapp";

export function ContactButtons({
  phone,
  whatsappHref,
  label,
  layout,
  onAttempt,
  className,
}: {
  /** E.164. Null means there is nothing to offer and nothing is rendered. */
  phone: string | null;
  /** Built on the server by `whatsappHref`, so the `+` is stripped one way. */
  whatsappHref: string | null;
  /** What to call the person — their name where we have it. */
  label: string;
  /** `link` for the quiet version on the card, `buttons` while waiting at a door. */
  layout: "link" | "buttons";
  onAttempt: (channel: ContactChannel) => void;
  className?: string;
}) {
  const t = useTranslations("provider.arrival");
  if (!phone) return null;

  if (layout === "link") {
    return (
      <div className={cn("mt-3 flex flex-wrap items-center gap-4", className)}>
        <a
          href={`tel:${phone}`}
          onClick={() => onAttempt("call")}
          className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          <Phone aria-hidden="true" className="size-3.5" />
          {label}
        </a>
        {whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onAttempt("whatsapp")}
            className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            <MessageCircle aria-hidden="true" className="size-3.5" />
            {t("whatsapp")}
          </a>
        ) : null}
      </div>
    );
  }

  /*
   * TWO TARGETS, 48px TALL, SIDE BY SIDE. Whoever is pressing these is on a phone in
   * the street with a wet thumb — the arrival panel's whole argument — and a text link
   * at that moment is a miss waiting to happen.
   */
  return (
    <div className={cn("mt-3 grid gap-2", whatsappHref ? "grid-cols-2" : "", className)}>
      <Button variant="outline" className="btn-tactile h-12 w-full" asChild>
        <a href={`tel:${phone}`} onClick={() => onAttempt("call")}>
          <Phone aria-hidden="true" />
          {t("callCustomer")}
        </a>
      </Button>
      {whatsappHref ? (
        <Button variant="outline" className="btn-tactile h-12 w-full" asChild>
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onAttempt("whatsapp")}
          >
            <MessageCircle aria-hidden="true" />
            {t("whatsapp")}
          </a>
        </Button>
      ) : null}
    </div>
  );
}
