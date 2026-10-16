"use client";

import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";

/**
 * What an admin sees when a money action refused for want of a fresh code.
 *
 * ONE SENTENCE FOR NINE SCREENS, and that is the point rather than a tidiness
 * preference. Every one of these refusals is identical — the role was right,
 * the eight-hour step-up was satisfied, and the fifteen-minute proof had run
 * out — so nine copies of the sentence would be nine chances for one of them to
 * say something slightly different about the same rule. The existing two were
 * already drifting: `/admin/payouts` said "prove who you are again" and
 * `/admin/ai-limits` said "enter a code from your authenticator", about the
 * same window and the same remedy.
 *
 * IT CARRIES THE WAY FORWARD, which is the half a refusal usually leaves out.
 * `/providers/standards` settled this argument for professionals and the rule
 * transfers: a gate nobody can see how to pass reads as a broken product.
 * Without the link the admin has to know that the code lives on the account
 * security page, which is a thing somebody learns by being told once and
 * forgets by Tuesday.
 *
 * A NEW TAB, DELIBERATELY. These forms carry typed work — the reason on a
 * refund, the adjudicated figure on a mismatch, the note on an appeal — and
 * navigating away to fetch a code would throw it away and teach everybody to
 * type the reason twice. The second time is always shorter.
 */
export function ReauthNotice() {
  const t = useTranslations("admin.reauth");

  return (
    <p
      role="alert"
      className="animate-pop-in text-body-sm text-destructive-ink"
    >
      {t.rich("needed", {
        link: (chunks) => (
          <Link
            href="/account/security"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}

/**
 * The reasons that mean "a code, not a bug".
 *
 * TWO SPELLINGS BECAUSE THE TWO HALVES REFUSE IN DIFFERENT PLACES, which is
 * `lib/config/admin-money.ts`'s `fresh-actor` and `threaded` split reaching the
 * screen: the gated actions answer `reauthNeeded`, and `lib/data/payouts.ts`
 * has answered `notFresh` since it shipped. Renaming one of them would be a
 * change to a money path for the sake of a string, so the screen knows both.
 */
export function isReauthReason(reason: string | undefined): boolean {
  return reason === "reauthNeeded" || reason === "notFresh";
}
