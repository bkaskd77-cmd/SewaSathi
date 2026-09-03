"use client";

import { Phone } from "lucide-react";
import { useTranslations } from "next-intl";

import { buttonVariants } from "@/components/ui/button-variants";
import { site } from "@/lib/config/site";

/**
 * When we cannot sign somebody in, they still get to book.
 *
 * Sign-in went down in production because a credential in somebody else's
 * dashboard was a placeholder. The product's answer at the time was a red
 * sentence and nothing else: the customer's only remaining option was to leave.
 * For a plumbing emergency at nine at night, that is the whole business
 * failing, not one feature.
 *
 * So an outage in the gateway now costs us a *channel*, not the customer. This
 * appears only when the failure is ours and retrying cannot fix it — a mistyped
 * number or a wrong code shows the ordinary error, because telling somebody to
 * ring us when they simply need to retype a digit is worse than useless.
 *
 * The number is a `tel:` link on a Server-Component-shaped button: no
 * JavaScript, nothing to load, works on the phone of somebody whose connection
 * is already failing them.
 */
export function SignInFallback({ show }: { show: boolean }) {
  const t = useTranslations("auth.fallback");
  if (!show) return null;

  return (
    <div
      role="status"
      className="animate-pop-in mt-4 rounded-xl border border-primary/30 bg-primary/[0.05] p-4"
    >
      <p className="text-body-sm font-semibold text-primary">{t("title")}</p>
      <p className="mt-1 text-body-sm">{t("body")}</p>
      <a
        href={`tel:${site.supportPhone}`}
        className={buttonVariants({
          size: "lg",
          className: "btn-tactile mt-3 w-full",
        })}
      >
        <Phone aria-hidden="true" className="size-4" />
        {t("call")}
      </a>
      <p className="mt-2 text-caption text-muted-foreground">{t("hours")}</p>
    </div>
  );
}
