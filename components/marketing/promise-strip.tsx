import { getTranslations } from "next-intl/server";
import { BadgeCheck, ShieldAlert, Wallet } from "lucide-react";

/**
 * What the customer is promised, in the slot the invented activity feed used.
 *
 * WHAT WAS HERE. `<ActivityTicker />` — "Priya in Baneshwor booked a cleaning 3
 * minutes ago", cycling through six invented entries with a hardcoded
 * `minutesAgo`, so it said "3 minutes ago" permanently. Named individuals, real
 * Kathmandu wards, a timestamp, and not one real booking behind any of it.
 *
 * It contradicted the posture of everything underneath it: this product refuses
 * to print `0.0` for an unrated professional, gates all 36 sub-band durations
 * behind `durationSource: invented`, and switched off the entire multi-day
 * scheduler rather than publish a guessed span — then named invented customers
 * on the first screen anybody sees.
 *
 * THE SLOT IS NOT LEFT EMPTY, and the replacement is not the obvious one. The
 * trust grid immediately above already carries "Upfront pricing — agreed before
 * work starts" and "Work guaranteed — somebody comes back and redoes it, free",
 * so a strip about price and the guarantee would repeat the row above it in
 * smaller type. These three are the promises this product makes that are
 * nowhere else on the page, and each is enforced in code rather than asserted:
 *
 *   - **Paying after the work** — `lib/payments`; money moves at settlement and
 *     there is no advance anywhere in the flow.
 *   - **The safety floor** — `lib/ai/safety.ts`, server-side on every path
 *     including the keyword fallback, in all three scripts.
 *   - **Our fee never touching the customer's price** — every constant in
 *     `lib/payments/payout.ts` moves money between us and the professional, and
 *     says so in its own comment. `cashCommissionSurchargeBps` is 0.
 *
 * STATIC, NOT A MARQUEE. The ticker advanced every four seconds, and that
 * movement was half of what implied recency and volume. Motion here exists to
 * make a state change legible; a loop of fixed sentences is decoration, and the
 * entrance `Reveal` on the band above is already doing the work.
 *
 * A Server Component on purpose: the ticker was `"use client"` with an interval,
 * a reduced-motion listener and four pieces of state, all on the landing page.
 * This ships no JavaScript at all.
 *
 * WHEN THERE IS REAL VOLUME, a feed belongs here again and should be built as
 * the Supabase realtime subscription the old file described: a booking maps to
 * `{ name (first only), area, actionKey, minutesAgo }`, filtered to the
 * viewer's city, surnames stripped. That shape is recorded here because the
 * component that held it is deleted; see LAUNCH-BLOCKERS.md § activity-ticker.
 */
const PROMISES = [
  { key: "payAfter", Icon: Wallet },
  { key: "emergency", Icon: ShieldAlert },
  { key: "freeToUse", Icon: BadgeCheck },
] as const;

export async function PromiseStrip() {
  const t = await getTranslations("home.promise");

  return (
    <div className="border-t border-border/70">
      <ul className="container grid gap-x-6 gap-y-2 py-3 sm:grid-cols-3">
        {PROMISES.map(({ key, Icon }) => (
          <li key={key} className="flex items-center gap-2.5">
            <Icon
              aria-hidden="true"
              className="size-3.5 shrink-0 text-primary"
            />
            <p className="text-caption text-muted-foreground">{t(key)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
