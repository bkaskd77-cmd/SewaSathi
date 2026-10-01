-- ---------------------------------------------------------------------------
-- A recovery is two facts, and the balance only ever recorded one of them.
--
-- WHAT WAS WRONG. `provider_outstanding` counts the guarantee account:
-- `redo_debt` minus `recovery` and `write_off`. `provider_balance` counted the
-- money account and excluded every guarantee kind, which was right for
-- `redo_debt` — somebody owing us for a redo is not somebody we owe less to —
-- and wrong for `recovery`.
--
-- A recovery is money the professional had earned, spent on the debt they owed
-- us. The debt gets smaller, which `provider_outstanding` already said. And what
-- we owe them gets smaller too, because that money has been settled against
-- their own account rather than sent to their bank — which nothing said. So every
-- rupee ever recovered stayed on the books for ever as money we still owed, on
-- top of having already been given to them as debt relief.
--
-- IT ONLY BECAME VISIBLE WHEN SOMETHING TRIED TO PAY THE BALANCE OUT. With no
-- payout run there was nothing to read `provider_balance` for real, so the error
-- had no consequence and no symptom. That is the shape this repository keeps
-- finding: an arrangement that is wrong and quiet until the first caller arrives.
--
-- `recovery` IS NAMED IN `lib/config/ledger.ts` AS THE ONE CROSS-KIND, not
-- derived as an intersection, and the unit and db suites assert that the overlap
-- between the two accounts IS that list. A second kind landing on both sides by
-- accident fails there rather than joining the exception.
--
-- NOTHING ELSE CHANGES. `provider_outstanding` is untouched and remains the debt
-- number. `redo_debt` and `write_off` stay off the money side: a debt is not a
-- reduction in what we owe, and a write-off is us giving up on a debt rather than
-- paying anybody.
-- ---------------------------------------------------------------------------

create or replace function public.provider_balance(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(
    case kind
      when 'earning'         then amount_rupees
      when 'payout_reversal' then amount_rupees
      when 'commission_due'  then -amount_rupees
      when 'payout'          then -amount_rupees
      when 'tax_withheld'    then -amount_rupees
      -- The cross-kind. Money they earned, applied to their own debt: it
      -- discharges what we owe exactly as a payout does.
      when 'recovery'        then -amount_rupees
      else 0
    end
  ), 0)::integer
  from public.provider_ledger
  where provider_id = target;
$$;

comment on function public.provider_balance(uuid) is
  'Signed net position: positive means we owe them, negative means they owe us. Counts the money kinds and `recovery`, which is the one kind on both accounts — it discharges what we owe by paying their own debt with it. `redo_debt` and `write_off` stay out: a debt is not a reduction in what we owe, and a write-off pays nobody. provider_outstanding is the debt number.';

-- Service role only, unchanged from 20260930000001. Restated because
-- `create or replace` keeps existing grants and a reader of this file should not
-- have to go and check that.
revoke execute on function public.provider_balance(uuid) from public, anon, authenticated;
