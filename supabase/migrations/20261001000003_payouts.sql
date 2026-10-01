-- ---------------------------------------------------------------------------
-- The table that closes the chain.
--
-- WHAT WAS MISSING. `settleSplit` freezes the split onto a booking, `payoutDueAt`
-- dates it, `payoutPlan` splits a long-guarantee earning into two tranches,
-- `applyRedoRecovery` nets a debt forward, and `provider_ledger` records all of
-- it append-only. Nothing grouped those earnings, nothing sent money, and
-- nothing recorded that it had. Every individual link was built and the chain was
-- never closed — the same shape as `applyRedoRecovery` having no caller for four
-- phases, at product scale.
--
-- A PAYOUT IS A PERIOD, NOT A BOOKING. One professional, one week, one net
-- figure: the two-way sum of what we owe them on digital jobs and what they owe
-- us in commission on cash ones. Paying per booking would mean a transfer fee per
-- job and a statement nobody can reconcile against a week's work.
--
-- THE RUN ONLY EVER CREATES DRAFTS. Approval is a person on an admin screen, and
-- `payout_transition_allowed` is what makes that structural rather than a
-- convention — a cron cannot reach `sent` from `draft` in one step however it is
-- called.
-- ---------------------------------------------------------------------------

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),

  provider_id uuid not null references public.providers (id) on delete restrict,

  /*
   * THE PERIOD, AND `period_start` IS THE IDEMPOTENCY KEY. Derived from the run
   * date by `payoutPeriod`, never from "now minus seven days" — which would give
   * two runs an hour apart two different answers and let the second one through
   * the unique index below.
   */
  period_start timestamptz not null,
  period_end timestamptz not null,
  constraint payouts_period_ordered check (period_end > period_start),

  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'confirmed', 'failed')),

  /*
   * WHAT THE PROFESSIONAL EARNED AND WHAT THEY OWE, SEPARATELY.
   *
   * Kept apart rather than stored as one net figure because a statement reading
   * "Rs 4,200" answers none of the questions somebody asks about their own week.
   * `net_rupees` is the two subtracted, and it is the only one that may be
   * negative — which is the ordinary case for a week of nothing but cash jobs.
   */
  earnings_rupees integer not null default 0 check (earnings_rupees >= 0),
  commission_rupees integer not null default 0 check (commission_rupees >= 0),
  net_rupees integer not null,

  /*
   * Withheld at source. ZERO IS A DECISION HERE AND NOT AN ABSENCE: the rate is
   * `PAYOUT_RUN.withholdingTaxBps`, which is 0 until an accountant confirms it,
   * and at 0 no `tax_withheld` ledger row is written at all. A row for zero
   * rupees would assert a withholding was calculated and came to nothing.
   */
  tax_withheld_rupees integer not null default 0 check (tax_withheld_rupees >= 0),

  /*
   * The destination this was drafted against, kept even after it retires — which
   * is the entire reason `payout_destinations` is append-and-retire. Months
   * later, "where did my money go" has an answer that is not today's answer.
   */
  destination_id uuid references public.payout_destinations (id) on delete restrict,

  /*
   * WHY NOTHING WAS SENT, WHEN NOTHING WAS SENT.
   *
   * Null means not held. `cooling` is a destination inside its 72-hour window
   * after a change — we pay neither the old address nor the new one, because the
   * whole point of the window is that nobody has confirmed which is right.
   * `unconfirmed` is a first payout to a destination no person has checked.
   * `no_destination` is a professional who has not told us where to send it.
   * `negative` is a week they owe us rather than the other way round.
   */
  held_reason text
    check (held_reason in ('cooling', 'unconfirmed', 'no_destination', 'negative')),

  /** What the rail gave back. Null until something is sent. */
  external_reference text check (char_length(external_reference) <= 200),
  failure_reason text check (char_length(failure_reason) <= 500),

  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles (id),
  sent_at timestamptz,
  settled_at timestamptz
);

comment on table public.payouts is
  'One professional, one week, one net figure. The run creates drafts only; a person approves, a rail sends, and a failure writes a payout_reversal to the ledger. The ledger is the truth — this table is the instruction.';

/*
 * ONE PAYOUT PER PROFESSIONAL PER PERIOD, refused by the database rather than
 * remembered by the caller. The `our_reference` idiom: a second run in the same
 * week — a retry, an overlapping cron, somebody pressing a button — inserts zero
 * rows rather than a second payout nobody reconciled.
 */
create unique index if not exists payouts_provider_period_idx
  on public.payouts (provider_id, period_start);

create index if not exists payouts_status_idx
  on public.payouts (status, created_at desc);

-- ---------------------------------------------------------------------------
-- The state machine, mirrored from lib/payments/payout-status.ts.
-- `npm run check:transitions` fails the build if the two disagree.
-- ---------------------------------------------------------------------------
create or replace function public.payout_transition_allowed(from_status text, to_status text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_status
    when 'draft'     then to_status in ('approved', 'failed')
    when 'approved'  then to_status in ('sent', 'failed')
    when 'sent'      then to_status in ('confirmed', 'failed')
    when 'confirmed' then false
    when 'failed'    then false
    else false
  end;
$$;

create or replace function public.enforce_payout_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and not public.payout_transition_allowed(old.status, new.status) then
    raise exception 'a payout cannot go from % to %', old.status, new.status;
  end if;

  /*
   * THE MONEY FIGURES ARE FROZEN ONCE DRAFTED. A payout that can be edited after
   * a person approved it is a payout nobody approved — the same reasoning as
   * `enforce_booking_immutability` guarding the quoted band. No service-role
   * bypass: every write here is service-role, so a bypass would guard nothing.
   */
  if old.status <> 'draft'
     and (new.earnings_rupees is distinct from old.earnings_rupees
          or new.commission_rupees is distinct from old.commission_rupees
          or new.net_rupees is distinct from old.net_rupees
          or new.tax_withheld_rupees is distinct from old.tax_withheld_rupees
          or new.period_start is distinct from old.period_start
          or new.period_end is distinct from old.period_end) then
    raise exception 'a payout past draft is a figure somebody approved, not a draft';
  end if;

  return new;
end;
$$;

revoke execute on function public.payout_transition_allowed(text, text) from public, anon, authenticated;
revoke execute on function public.enforce_payout_transition() from public, anon, authenticated;

drop trigger if exists payouts_transition on public.payouts;
create trigger payouts_transition
  before update on public.payouts
  for each row execute function public.enforce_payout_transition();

-- ---------------------------------------------------------------------------
-- Who may read it.
--
-- A professional reads their own; nobody writes from a browser. Same posture as
-- `payments`: every write goes through the service role in `lib/data/payouts.ts`,
-- so a row saying money was sent cannot be forged by the person receiving it.
-- ---------------------------------------------------------------------------
alter table public.payouts enable row level security;

drop policy if exists "Providers read their own payouts" on public.payouts;
create policy "Providers read their own payouts"
  on public.payouts for select to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.id = payouts.provider_id and p.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every payout" on public.payouts;
create policy "Admins read every payout"
  on public.payouts for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- The ledger's own idempotency, which the payouts index does not provide.
--
-- WHY BOTH. `payouts_provider_period_idx` stops a second payout row; it does not
-- stop a second run writing a second `earning` row for the same booking before it
-- gets there. These are the `provider_ledger_recovery_tranche_idx` idiom one kind
-- over: the filter in the application is an optimisation, the index is the rule.
-- Without them a retried run double-counts a week's earnings into a balance that
-- still looks arithmetically consistent.
-- ---------------------------------------------------------------------------
create unique index if not exists provider_ledger_earning_once_idx
  on public.provider_ledger (booking_id, tranche)
  where kind = 'earning';

create unique index if not exists provider_ledger_commission_once_idx
  on public.provider_ledger (booking_id, tranche)
  where kind = 'commission_due';
