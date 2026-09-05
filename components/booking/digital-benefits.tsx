"use client";

import { useTranslations } from "next-intl";
import { RotateCcw, ReceiptText, ShieldCheck, Wallet } from "lucide-react";

/**
 * What paying digitally actually gets the customer.
 *
 * THE INCENTIVE THAT COSTS NOTHING. The obvious way to move people off cash is
 * to make cash more expensive, and that is the one thing this product will not
 * do: cash in Nepal is not a preference, it is the only instrument a lot of
 * people have. So instead of pricing them, tell them what they get — all four
 * of these are already true and none of them costs us a rupee.
 *
 * FRAMED AS BENEFIT, NEVER AS A WARNING ABOUT CASH. "Refunds come straight
 * back to you" and "cash refunds are slow and awkward" carry the same
 * information and land completely differently on somebody who has no card. The
 * second reads as being told off for being poor. Every line here says what
 * digital gives, and none mentions cash at all.
 *
 * SHOWN AT THE CHOICE, NOT AFTER IT. It sits beside the method buttons rather
 * than appearing once digital is selected, because a reward revealed after the
 * decision cannot inform the decision.
 *
 * There is deliberately no money here and no constant behind it. If a monetary
 * incentive is ever added it will be credit toward a NEXT booking rather than
 * money off this one — cheaper for us, it earns a second booking, and it does
 * not make the customers who can only pay cash feel taxed. See
 * `lib/payments/payout.ts`.
 */

const BENEFITS = [
  { key: "refund", Icon: RotateCcw },
  { key: "automatic", Icon: ShieldCheck },
  { key: "receipt", Icon: ReceiptText },
  { key: "noCash", Icon: Wallet },
] as const;

export function DigitalBenefits({ className }: { className?: string }) {
  const t = useTranslations("booking.digital");

  return (
    <div className={className}>
      <p className="text-caption font-semibold uppercase tracking-wide text-muted-foreground">
        {t("heading")}
      </p>
      <ul className="mt-2 space-y-1.5">
        {BENEFITS.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-2 text-body-sm">
            <Icon
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-primary"
            />
            <span className="text-muted-foreground">{t(key)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
