-- WIDENS: payouts_held_reason_check, for the enforcement ladder's step 4.
--
-- `/providers/standards` publishes step 4 as "Your listing stops appearing
-- while the review runs, and money already earned waits rather than being paid
-- out. It is not taken. If the review clears you, it is released in full with an
-- apology." The listing half landed in 20261017000001; this is the money half.
--
-- ONE LIST WRITTEN TWICE, which is why this file exists at all.
-- `PAYOUT_HELD_REASONS` in `lib/payments/destination.ts` is the other copy and
-- `tests/db/payout-run.test.ts` compares them out of `pg_constraint`. A reason
-- the constraint does not know is refused at the INSERT, so a payout that should
-- have been held would fail to draft — the run counts an error and the week goes
-- unpaid, on the one path where a silent failure means somebody is not paid.
--
-- HELD IS NOT DEDUCTED. Nothing about this touches `provider_ledger`: the sum
-- stays owed and the next run drafts it once the step is lifted, which is what
-- lets the page promise it is released in full.
--
-- `alter table … drop constraint` is the measured-instant form over the agent's
-- transport, and it is how every check constraint in this schema is changed.

alter table public.payouts
  drop constraint if exists payouts_held_reason_check;

alter table public.payouts
  add constraint payouts_held_reason_check check (
    held_reason in (
      'cooling',
      'unwitnessed',
      'unconfirmed',
      'no_destination',
      'negative',
      'under_review'
    )
  );
