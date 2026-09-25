-- REMOVES: nothing. One partial unique index is added; no table, column,
-- policy, function, grant or guard clause is dropped or weakened.
--
-- ===========================================================================
-- The recovery sweep can run twice and recover once.
--
-- WHAT WAS WRONG. `applyRedoRecovery` has existed since Phase 6, is tested,
-- and had no caller anywhere in application code — no `recovery` row was ever
-- written, no `write_off` either, and there is no payout run at all. So
-- `provider_outstanding` only ever went up, and every refund agreed on
-- /admin/guarantee-claims was money gone. Worse, the netting was already
-- PROMISED: /providers/standards has told professionals since Phase 6 that the
-- debt "comes off your next earnings, at most a quarter of any one payout" and
-- shows "as a balance you can watch going down". The balance could not go
-- down. This index is the half of wiring that belongs in the database.
--
-- IDEMPOTENT BY CONSTRUCTION, WHICH IS THE ONLY KIND THAT SURVIVES A CRON.
-- The sweep is scheduled, can run late, twice, or overlapping with itself, and
-- `reconcileStuckPayments` in the same route has always been safe under
-- exactly that. Reading "has this booking been recovered against?" and then
-- inserting is the gap that recovers twice — the same race `our_reference`
-- closes on `payments`, and the same reason the open-job claim policy matches
-- on the row rather than checking first. So the database refuses the second
-- row rather than the application remembering not to write it.
--
-- ONE RECOVERY PER BOOKING, BECAUSE A BOOKING IS WHAT A PAYOUT IS HERE. There
-- is no payout run and no payout table: `payout_due_at` is stamped on the
-- booking at settlement and that is the whole of it. So the unit the published
-- 25% cap is measured against is one settled booking whose payout has come
-- due, and recovering against it twice would take half a payout from somebody
-- who was promised a quarter.
--
-- NULLS ARE EXCLUDED FOR FREE. `booking_id` is nullable — a write-off or a
-- manual adjustment need not point at a job — and Postgres treats nulls as
-- distinct in a unique index, so those rows are unconstrained without the
-- index having to say so.
--
-- WHAT THIS DOES NOT DO: stop a `redo_debt` row per booking. A booking can
-- legitimately generate a debt and later be recovered against; it is the
-- recovery that must happen once.
-- ===========================================================================

create unique index if not exists provider_ledger_recovery_once_idx
  on public.provider_ledger (booking_id)
  where kind = 'recovery';

comment on index public.provider_ledger_recovery_once_idx is
  'One recovery per booking. A booking is what a payout is in this product, so a second recovery row would take more than the quarter of a payout published on /providers/standards. The sweep relies on this rather than on a read-then-write.';
