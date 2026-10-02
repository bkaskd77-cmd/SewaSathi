-- ---------------------------------------------------------------------------
-- The ledger learns which payout a row belongs to, and a draft learns when it
-- has gone stale.
--
-- WHY `payout_id` IS NOT OPTIONAL BOOKKEEPING. `provider_ledger` is keyed on
-- bookings: `provider_ledger_earning_once_idx` and its commission twin are
-- unique on `(booking_id, tranche)`, which is what stops a retried run counting
-- a week's earnings twice. A `payout` row has no booking — it is one remittance
-- covering a whole period — so there was no key on which a double send could be
-- refused. The filter in the application would have been the only guard, and
-- `sweepRedoRecovery` already records what that is worth: a filter is an
-- optimisation, an index is the rule.
--
-- WHY `ledger_rows_at_draft`. The run totals a week from the ledger and writes a
-- draft; a person approves it later. Between the two a refund can be agreed or a
-- recovery taken, and approving then pays a figure the ledger no longer supports.
-- A ROW COUNT IS A SOUND CURSOR HERE AND ONLY HERE: `provider_ledger_append_only`
-- refuses UPDATE and DELETE for every caller, the service role included, so the
-- ledger can change in exactly one way — by growing. If that trigger ever goes,
-- this column is blind, which is why `tests/db/payout-run.test.ts` asserts the
-- trigger is still attached rather than trusting it.
-- ---------------------------------------------------------------------------

alter table public.provider_ledger
  add column if not exists payout_id uuid references public.payouts (id) on delete set null;

comment on column public.provider_ledger.payout_id is
  'The remittance this row belongs to. Set on payout and payout_reversal rows, which cover a period rather than a booking; null on every booking-keyed kind.';

create index if not exists provider_ledger_payout_idx
  on public.provider_ledger (payout_id);

/*
 * ONE SEND AND ONE REVERSAL PER PAYOUT, refused by the database.
 *
 * Separate partial indexes rather than one on `(payout_id, kind)`: a failed
 * payout that is retried writes a `payout_reversal` beside its `payout`, so the
 * pair must coexist, and each must be unique on its own.
 */
create unique index if not exists provider_ledger_payout_once_idx
  on public.provider_ledger (payout_id)
  where kind = 'payout';

create unique index if not exists provider_ledger_payout_reversal_once_idx
  on public.provider_ledger (payout_id)
  where kind = 'payout_reversal';

alter table public.payouts
  add column if not exists ledger_rows_at_draft integer not null default 0
    check (ledger_rows_at_draft >= 0);

comment on column public.payouts.ledger_rows_at_draft is
  'How many provider_ledger rows this professional had when the draft was computed. The ledger is append-only, so a different count means the figures were computed against a ledger that has since moved and approval must recompute rather than pay.';
