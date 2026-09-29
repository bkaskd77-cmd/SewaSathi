-- REMOVES: provider_outstanding — the catch-all `else -amount_rupees` branch.
-- Deliberate, and the whole subject of this file. That branch counted EVERY
-- kind but `redo_debt` as a credit against the guarantee balance, which made
-- adding any new kind unsafe — `lib/payments/refund.ts` and `lib/data/claims.ts`
-- both say so, as the reason they chose `redo_debt` instead. The replacement
-- names its three kinds and returns 0 for anything else, so today's answer is
-- identical and tomorrow's does not silently change when a kind is added.
-- Proven in `tests/db/ledger-kinds.test.ts` by restoring the old body.

-- ---------------------------------------------------------------------------
-- The ledger learns to hold money moving in both directions.
--
-- WHAT THIS REMOVES IS A CONSTRAINT, NOT A BUG, and the difference is the whole
-- reason this file is careful. `provider_outstanding` has always summed
-- `redo_debt` positive and — through a catch-all `else` — EVERY other kind
-- negative. That was known. It is written down twice, in `lib/payments/refund.ts`
-- and `lib/data/claims.ts`, in both cases as the reason a feature did NOT add a
-- ledger kind: a `commission_returned` row "would have quietly reduced what
-- somebody owed — wrong, and in the direction that costs us money". Two
-- features were designed around it and both chose `redo_debt` instead.
--
-- Payouts cannot. The account has to hold what we owe a professional on a
-- digital job AND what they owe us on a cash one, and cash is the primary path
-- here, so both directions are ordinary rather than exceptional. So the `else`
-- is replaced by named kinds and the constraint it imposed goes away.
--
-- WHICH MAKES THOSE TWO COMMENTS FALSE THE MOMENT THIS LANDS. They are rewritten
-- in the same commit. That is not tidying: a comment describing behaviour the
-- code does not have is the failure this repository has already paid for on
-- `sms.gateway`, on `applyRedoRecovery`, and on the `= false` / `is false`
-- claim in `enforce_claim_refund`. A reader trusting them would conclude that
-- adding a kind is unsafe at exactly the moment it became safe.
--
-- NOTHING DERIVES FROM THE NEW KINDS YET. No writer, no reader, no screen — the
-- payout run brings those. A kind nothing writes is not a feature, and shipping
-- the column one commit ahead of its capture is `booking_refusals.reason_code`'s
-- mistake in miniature. This stops deliberately one step short.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The kinds.
--
-- `amount_rupees` stays positive and `kind` keeps deciding direction — the
-- table's existing rule, because a signed amount reads wrong in every report
-- that sums it without looking.
--
--   earning          (+) a digital job settled; we hold the money and owe them
--   commission_due   (-) a cash job settled; they hold it and owe us the fee
--   payout           (-) money sent
--   payout_reversal  (+) a payout that failed, returning the balance
--   tax_withheld     (-) withholding, 0 until an accountant confirms the rule
--
-- `payout_reversal` exists because an append-only ledger cannot delete the
-- `payout` row, and should not want to: that row is the evidence a remittance
-- was attempted, which is exactly what somebody investigating a missing payment
-- needs to see.
-- ---------------------------------------------------------------------------
alter table public.provider_ledger
  drop constraint if exists provider_ledger_kind_check;

alter table public.provider_ledger
  add constraint provider_ledger_kind_check
  check (kind in (
    'redo_debt',
    'recovery',
    'write_off',
    'earning',
    'commission_due',
    'payout',
    'payout_reversal',
    'tax_withheld'
  ));

comment on table public.provider_ledger is
  'Every movement on a professional''s account, append-only: guarantee debts and their recovery, earnings owed, commission owed on cash, payouts and their reversals. A balance column can be edited; a ledger cannot, and this decides what somebody is paid.';

-- ---------------------------------------------------------------------------
-- 2. `provider_outstanding` names its kinds.
--
-- IDENTICAL TODAY. THE POINT IS THAT IT STAYS IDENTICAL TOMORROW. With the
-- catch-all gone, a kind added next year is counted deliberately or not at all
-- — and `tests/db/ledger-kinds.test.ts` proves it by restoring the old body and
-- watching the case go red, because an explicit rewrite that nothing can tell
-- apart from a cosmetic one is worth nothing.
--
-- `greatest(0, …)` STAYS, and is not the same decision. It means this function
-- can never report that the platform owes a professional money, which is right
-- for "what is still owed on guarantees" — a recovery that overshoots is a
-- bookkeeping error. The two-way net needs the opposite and gets its own
-- function below rather than bending this one.
--
-- `security definer` so the provider dashboard can ask for its own number
-- without a policy on every row it sums; `search_path = ''` per
-- 20260903000001. `execute` stays granted to `authenticated` — six policies
-- and the ledger surface depend on it, and `tests/db/guard-clauses.test.ts`
-- pins that by name.
-- ---------------------------------------------------------------------------
create or replace function public.provider_outstanding(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    0,
    coalesce(sum(
      case kind
        when 'redo_debt' then amount_rupees
        when 'recovery'  then -amount_rupees
        when 'write_off' then -amount_rupees
        else 0
      end
    ), 0)
  )::integer
  from public.provider_ledger
  where provider_id = target;
$$;

revoke execute on function public.provider_outstanding(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. The signed balance.
--
-- A SECOND FUNCTION RATHER THAN A WIDER FIRST ONE. `provider_outstanding`
-- answers "what do they still owe on guarantees" and must keep its floor;
-- this answers "where does the account stand", and a negative answer is the
-- normal state of a professional whose week was all cash. Collapsing them would
-- make one of the two answers wrong, silently, on whichever surface asked.
--
-- Guarantee kinds are deliberately OUTSIDE this sum. A redo debt is published
-- under *what is never a signal* — it is money we advanced on a claim, it comes
-- off future earnings at a quarter of a payout by `applyRedoRecovery`, and it
-- must not reach into the arrears figure that will later pause dispatch. Two
-- different facts about somebody; one function each.
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
      else 0
    end
  ), 0)::integer
  from public.provider_ledger
  where provider_id = target;
$$;

comment on function public.provider_balance(uuid) is
  'Signed net position: positive means we owe them, negative means they owe us. Guarantee kinds are excluded on purpose — provider_outstanding is that number, and a redo debt is never an arrears signal.';

-- `authenticated` keeps execute: a professional reads their own balance on
-- their dashboard, the same reason `provider_outstanding` keeps it. `anon` has
-- no business here and neither does bare `public`.
revoke execute on function public.provider_balance(uuid) from public, anon;
