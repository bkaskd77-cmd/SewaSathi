-- ---------------------------------------------------------------------------
-- One payout in flight per professional, refused by the database.
--
-- THE DOUBLE PAYMENT THIS CLOSES, found by re-reading the run's own diff rather
-- than by a failure. `net_rupees` is the professional's WHOLE position — the
-- balance after the week's rows are written — which is what makes a carried
-- negative and a recovery come out right. It also means two drafts that nobody
-- resolved describe the same money.
--
-- Concretely: a week is drafted at 2,500 and nobody approves it. The next Tuesday
-- no new work has settled, so the ledger has not moved — `provider_balance` still
-- says 2,500 and `ledger_rows_at_draft` is the same number as before, so the
-- staleness check in `approvePayout` sees nothing wrong. Two unheld drafts for
-- 2,500 now exist, both approvable, both sendable, and each send writes its own
-- `payout` row. `provider_ledger_payout_once_idx` does not help: it is unique per
-- payout, and these are two payouts. The balance ends at -2,500 and the ledger
-- reconciles perfectly, which is the worst kind of wrong.
--
-- THE GUARD IS AN INDEX AND NOT A CHECK IN THE APPLICATION, the same choice as
-- `our_reference` on `payments` and `provider_ledger_recovery_tranche_idx`: a read
-- then a write is a race, and two overlapping runs would both pass a filter.
--
-- WHAT IT COSTS, STATED RATHER THAN DISCOVERED LATER. An unresolved payout stops
-- the next week being drafted for that professional. That is deliberate — you
-- cannot total a new week while the last one is unsettled — and it is loud: the
-- run reports it, and `/admin/payouts` shows the open row with the reason it is
-- stuck. The way out is a person: approve it, or fail it with a reason, which
-- `draft -> failed` exists for. A rail that never confirms therefore stops drafts
-- rather than silently paying twice, and a stopped draft is the failure worth
-- having.
-- ---------------------------------------------------------------------------

create unique index if not exists payouts_one_in_flight_idx
  on public.payouts (provider_id)
  where status in ('draft', 'approved', 'sent');
