/*
 * Did the warning reach a device, and a fourth hold reason for when it did not.
 *
 * WHAT WAS ALREADY TRUE, SO THAT THIS IS NOT MISREAD AS THE GATE IT IS NOT.
 * Every destination change was ALREADY held until a person confirmed it:
 * `first_payout_confirmed_at` is null on every new row, `destinationReadiness`
 * returns `unconfirmed`, and `heldReasonFor` refuses to draft a payable row.
 * An admin has always had to act before money follows a changed address.
 *
 * WHAT WAS MISSING IS THE DIFFERENCE BETWEEN TWO CONFIRMATIONS THAT LOOK THE
 * SAME. `DESTINATION_COOLDOWN_HOURS` holds a new account for 72 hours expressly
 * so the professional can object — and that is only a protection if somebody
 * could be told. Until push shipped, nobody could be: the notice had no
 * delivery address at all, which is what `LAUNCH-BLOCKERS.md §
 * payout-notice-undeliverable` records. Now some accounts have a device and
 * some do not, and an admin looking at a row to confirm had no way to tell
 * which they were looking at.
 *
 *   notice reached a device   the 72 hours meant something; nobody objected;
 *                             confirming is a formality with a fact behind it
 *   notice reached nothing    the window protected nobody, and this
 *                             confirmation is the ONLY control standing
 *                             between an account takeover and somebody's
 *                             earnings. Ring them.
 *
 * A COUNT RATHER THAN A BOOLEAN, because "we sent to three devices" and "we
 * sent to one" are different confidences, and because a boolean named
 * `notice_delivered` would be the past-tense-verb trap this repository has
 * recorded three times: a push service accepting a message is not a person
 * reading it. This column says how many devices we could address at that
 * instant and claims nothing further.
 *
 * NULL IS "NOT RECORDED", NEVER "NO DEVICES" — rule 6. No row carries it today
 * (the table is empty), so nothing is backfilled and nothing has to be guessed.
 * The rule below treats null on a REPLACEMENT as unwitnessed, which is the safe
 * direction: being wrong that way costs one phone call.
 */

alter table public.payout_destinations
  add column if not exists notice_devices integer
    check (notice_devices is null or notice_devices >= 0);

comment on column public.payout_destinations.notice_devices is
  'Live push subscriptions this professional had when the change was recorded. Null is "not recorded", never "no devices" — rule 6. A count, not a delivery receipt: a push service accepting a message is not a person reading it.';

/*
 * `unwitnessed` joins the closed set a payout may be held for.
 *
 * `ALTER TABLE ... DROP CONSTRAINT` is the one destructive-looking statement
 * that is instant over the agent transport — see the schema notes — which is
 * why every check constraint in this schema is changed by dropping and adding
 * rather than by any other idiom.
 */
alter table public.payouts
  drop constraint if exists payouts_held_reason_check;

alter table public.payouts
  add constraint payouts_held_reason_check
    check (held_reason in ('cooling', 'unconfirmed', 'unwitnessed', 'no_destination', 'negative'));
