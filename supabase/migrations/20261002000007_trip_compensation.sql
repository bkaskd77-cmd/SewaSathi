-- REMOVES: provider_balance — nothing. It gains one `when` arm for
--   `trip_compensation` and keeps every other line, including the `recovery`
--   cross-kind comment. Declared because `check:migrations` watches this
--   function and `create or replace` is a full rebuild.

-- ---------------------------------------------------------------------------
-- Pay the professional for the trip nobody answered the door for.
--
-- THE GAP THIS CLOSES, which is the third of its exact kind in this product.
-- `settleNoShowClaim` has written `no_show_claims.trip_rupees_paid = 350` since
-- Phase 10. The column's own comment says "What we paid the professional. Paid on
-- upholding, never conditional on recovery." The terms say we pay it.
-- `/providers/standards` says we pay it. The audit row says we paid it.
--
-- **No money has ever moved.** There was no `provider_ledger` row, so there was
-- nothing for the payout run to find, nothing in `provider_balance`, and nothing on
-- the professional's own money screen. A column asserting a payment, and no payment
-- — `getProviderDashboard.owedRupees` and `applyRedoRecovery` were the first two.
--
-- WHY IT IS A MONEY KIND AND NOT A GUARANTEE ONE. The two accounts answer different
-- questions: `provider_outstanding` is "what does this professional still owe us on
-- guarantees", `provider_balance` is "what is the net position between us". A trip
-- payment is ours to them, full stop. The matching debt belongs to the CUSTOMER, on
-- `customer_risk.trip_debt_rupees`, and recovering it later never credits this row
-- back — we paid, and whether the customer repays us is our problem, which is
-- exactly what the terms promise them.
--
-- ONE PAYMENT PER BOOKING, REFUSED BY THE DATABASE. A claim can be re-decided — the
-- queue allows a person to look again — and `settleNoShowClaim` is an ordinary
-- update that does not know whether it has run before. A partial unique index is
-- the idiom this schema already uses for exactly this (`our_reference`,
-- `provider_ledger_recovery_once_idx`, `provider_ledger_payout_once_idx`): a read
-- then a write is a race, and the application remembering not to do it twice is not
-- a guarantee. `booking_id` is the key because a booking has at most one no-show.
--
-- APPLICABLE FROM THE SANDBOX, unlike `20261002000006` beside it: every statement
-- here leads with `alter` or `create`, and only a leading `DROP` is gated by the MCP
-- transport. See CLAUDE.md § Schema.
-- ---------------------------------------------------------------------------

-- One list written twice; `tests/unit/ledger-kinds.test.ts` reads this constraint
-- and compares it to `LEDGER_KINDS`, so the two cannot drift.
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
    'tax_withheld',
    'trip_compensation'
  ));

create unique index if not exists provider_ledger_trip_once_idx
  on public.provider_ledger (booking_id)
  where kind = 'trip_compensation';

comment on index public.provider_ledger_trip_once_idx is
  'One trip payment per booking. A re-decided no-show claim is refused by the database rather than remembered against by settleNoShowClaim.';

-- ---------------------------------------------------------------------------
-- The balance counts it.
--
-- NAMED EXPLICITLY, which is the whole point of this function having no catch-all
-- `else`: a kind added later is counted deliberately or not at all. Added here
-- rather than left out, because money we owe somebody that the balance cannot see
-- is money no payout run will ever send — which is the state this migration exists
-- to end.
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
      when 'earning'           then amount_rupees
      when 'payout_reversal'   then amount_rupees
      -- Ours to them for a wasted trip: it raises what we owe exactly as an
      -- earning does. The customer's side of it is not on this account at all.
      when 'trip_compensation' then amount_rupees
      when 'commission_due'    then -amount_rupees
      when 'payout'            then -amount_rupees
      when 'tax_withheld'      then -amount_rupees
      -- The cross-kind. Money they earned, applied to their own debt: it
      -- discharges what we owe exactly as a payout does.
      when 'recovery'          then -amount_rupees
      else 0
    end
  ), 0)::integer
  from public.provider_ledger
  where provider_id = target;
$$;

comment on function public.provider_balance(uuid) is
  'Signed net position: positive means we owe them, negative means they owe us. Counts the money kinds — including trip_compensation, ours to them for a wasted trip — and `recovery`, the one kind on both accounts. `redo_debt` and `write_off` stay out: a debt is not a reduction in what we owe, and a write-off pays nobody. provider_outstanding is the debt number.';

-- Service role only, unchanged. Restated because `create or replace` keeps existing
-- grants and a reader should not have to go and check that.
revoke execute on function public.provider_balance(uuid) from public, anon, authenticated;
