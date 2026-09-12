-- ---------------------------------------------------------------------------
-- The guarantee, made real: claims, the visit that verifies them, and the
-- ledger a verdict writes to.
--
-- `lib/config/guarantee.ts` has stated the promise since Phase 7 — the window
-- per trade, the four verdicts, who pays for each. Nothing could act on it.
-- The cash confirmation screen tells every customer "your guarantee covers up
-- to the amount you enter", and until this migration that sentence pointed at
-- no table, no button and no record. It was the one written promise the
-- product could not honour.
--
-- THE VISIT IS THE VERIFICATION, and the schema is shaped to make that
-- literal rather than aspirational:
--
--   * `resolved` is reachable ONLY from `attended`. Not a convention in the
--     interface — `claim_transition_allowed` refuses every other route, and
--     `lib/booking/claim-status.ts` is its pair, checked against it by
--     `npm run check:transitions`.
--   * A verdict cannot be recorded without an attending professional, and a
--     claim cannot resolve without a verdict. Both in the trigger.
--   * MONEY BACK NEEDS A PERSON. `refund_rupees > 0` requires
--     `refund_decided_by`, and no verdict sets it. That is the anti-farming
--     design in one constraint: the generous half of this policy is labour we
--     do not pay for, and the expensive half never runs on its own.
--
-- WHY A CLAIM DISPATCHES A REAL BOOKING. `visit_booking_id` points at an
-- ordinary row in `bookings`, so the visit gets the dispatch sweep, the live
-- tracking, the provider job screen and the cancellation rules for free. A
-- parallel "visit" table would have been a second booking system that
-- immediately fell behind the first. The link is one-directional and unique —
-- a booking is at most one claim's visit — so nothing was added to `bookings`.
--
-- WHO MAY WRITE. Nobody, through RLS. Reads are granted to the three parties
-- who have a right to them; every write goes through `lib/data/claims.ts`
-- under the service role, which re-reads the booking rather than believing
-- what it was handed. Same rule as `payments`, for the same reason: the
-- eligibility question ("is this job finished, settled, inside its window, and
-- under the limit?") is `claimIsAllowed`, and a policy cannot express it
-- without embedding the whole of `lib/config/guarantee.ts` in SQL.
-- ---------------------------------------------------------------------------

create table if not exists public.guarantee_claims (
  id uuid primary key default gen_random_uuid(),

  booking_id uuid not null references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,

  -- The professional whose job it was. `set null` rather than cascade: a claim
  -- is a record of what happened, and it stays true after somebody leaves.
  provider_id uuid references public.providers (id) on delete set null,

  -- Frozen from the booking, because the window is per trade and a category
  -- re-slug months later must not change how long somebody had.
  category_slug text not null,

  status text not null default 'open'
    check (status in ('open', 'dispatched', 'attended', 'resolved', 'withdrawn', 'rejected')),

  -- What went wrong, in the customer's own words. The floor is low on purpose:
  -- "leaking again" is a complete report and demanding a paragraph from
  -- somebody standing in a wet kitchen is how a claim goes unmade.
  description text not null check (char_length(description) between 4 and 1000),

  -- The visit. Null until somebody is dispatched.
  visit_booking_id uuid unique references public.bookings (id) on delete set null,
  attending_provider_id uuid references public.providers (id) on delete set null,

  verdict text
    check (verdict in ('sameFault', 'differentProblem', 'nothingWrong', 'customerCaused')),
  -- What they found, for the customer to read and for a person to review later.
  verdict_note text check (char_length(verdict_note) <= 1000),

  -- Filled from `claimOutcome(verdict)` at resolution. Stored rather than
  -- derived so a later policy change cannot rewrite who paid last March.
  payer text check (payer in ('provider', 'customer')),

  refund_rupees integer not null default 0 check (refund_rupees >= 0),
  /**
   * The person who decided it. NOT NULL whenever money goes back — see
   * `enforce_claim_transition`. There is no verdict, and no combination of
   * verdicts, that fills this in.
   */
  refund_decided_by uuid references public.profiles (id) on delete set null,

  -- Why it ended without a visit. Only `withdrawn` and `rejected` carry one.
  closed_reason text check (char_length(closed_reason) <= 400),

  opened_at timestamptz not null default now(),
  dispatched_at timestamptz,
  attended_at timestamptz,
  closed_at timestamptz
);

comment on table public.guarantee_claims is
  'A guarantee claim, from "it has gone wrong again" to who pays for the visit. resolved is reachable only from attended: the visit is the verification.';

comment on column public.guarantee_claims.refund_decided_by is
  'A refund requires a person. No verdict produces money back on its own — that is what stops the policy being a repeatable route to free work.';

create index if not exists guarantee_claims_booking_idx
  on public.guarantee_claims (booking_id, opened_at desc);

create index if not exists guarantee_claims_customer_idx
  on public.guarantee_claims (customer_id, opened_at desc);

create index if not exists guarantee_claims_provider_idx
  on public.guarantee_claims (provider_id, opened_at desc);

create index if not exists guarantee_claims_open_idx
  on public.guarantee_claims (status, opened_at)
  where status in ('open', 'dispatched', 'attended');

/*
 * ONE LIVE CLAIM PER BOOKING, as a database fact rather than a read followed by
 * a write. `claimIsAllowed` checks `openClaims` too, and that check is the one
 * a customer sees a sentence from — but two taps a second apart both pass it.
 * The same shape as the dispatch claim race: the policy settles it, not a read.
 */
create unique index if not exists guarantee_claims_one_live_idx
  on public.guarantee_claims (booking_id)
  where status in ('open', 'dispatched', 'attended');

-- ---------------------------------------------------------------------------
-- The state machine, paired with lib/booking/claim-status.ts
-- ---------------------------------------------------------------------------

create or replace function public.claim_transition_allowed(
  from_status text,
  to_status text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case from_status
    when 'open'       then to_status in ('dispatched', 'withdrawn', 'rejected')
    when 'dispatched' then to_status in ('attended', 'open', 'withdrawn', 'rejected')
    when 'attended'   then to_status in ('resolved')
    else false
  end;
$$;

comment on function public.claim_transition_allowed(text, text) is
  'Paired with CLAIM_TRANSITIONS in lib/booking/claim-status.ts. npm run check:transitions parses both and fails if they disagree.';

revoke execute on function public.claim_transition_allowed(text, text)
  from public, anon, authenticated;

/**
 * The rules that have no legitimate exception, so they are enforced here and
 * have no service-role bypass.
 *
 * `auth.uid()` is null for the service role, which is how the server's own
 * writes pass through the ownership checks elsewhere in this schema. These are
 * different: a claim resolved with no verdict, or a refund nobody signed, is
 * wrong no matter who is asking.
 */
create or replace function public.enforce_claim_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'A claim must start as open, not %', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- A claim is a record of one job. Re-pointing it at another booking or
  -- another customer would rewrite history rather than continue it.
  if new.booking_id <> old.booking_id or new.customer_id <> old.customer_id then
    raise exception 'A claim cannot be moved to another booking or customer'
      using errcode = 'check_violation';
  end if;

  if new.status <> old.status then
    if not public.claim_transition_allowed(old.status, new.status) then
      raise exception 'A claim cannot go from % to %', old.status, new.status
        using errcode = 'check_violation';
    end if;

    case new.status
      when 'dispatched' then new.dispatched_at := coalesce(new.dispatched_at, now());
      when 'attended'   then new.attended_at := coalesce(new.attended_at, now());
      when 'resolved'   then new.closed_at := coalesce(new.closed_at, now());
      when 'withdrawn'  then new.closed_at := coalesce(new.closed_at, now());
      when 'rejected'   then new.closed_at := coalesce(new.closed_at, now());
      -- Back to the pool: the professional sent to look declined it. Clear the
      -- assignment, exactly as the booking machine does on a release.
      when 'open' then
        new.dispatched_at := null;
        new.attending_provider_id := null;
        new.visit_booking_id := null;
      else null;
    end case;
  end if;

  -- THE VISIT IS THE VERIFICATION. Somebody has to have been there.
  if new.status = 'attended' and new.attending_provider_id is null then
    raise exception 'A claim cannot be attended by nobody'
      using errcode = 'check_violation';
  end if;

  if new.status = 'resolved' then
    if new.verdict is null then
      raise exception 'A claim cannot be resolved without a verdict'
        using errcode = 'check_violation';
    end if;
    if new.payer is null then
      raise exception 'A resolved claim must say who pays'
        using errcode = 'check_violation';
    end if;
  end if;

  -- MONEY BACK NEEDS A PERSON, and this is the line that says so.
  if new.refund_rupees > 0 and new.refund_decided_by is null then
    raise exception 'A refund has to be decided by somebody'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_claim_transition() from public;

drop trigger if exists guarantee_claims_transition on public.guarantee_claims;
create trigger guarantee_claims_transition
  before insert or update on public.guarantee_claims
  for each row execute function public.enforce_claim_transition();

/**
 * You may only claim on your own finished job, and never more than twice.
 *
 * No service-role bypass, for the same reason
 * `enforce_booking_address_ownership` has none: there is no path in this
 * product that raises a guarantee claim on somebody else's booking, so an
 * exception for the server would only be a hole nobody meant to leave.
 *
 * A withdrawn claim does not count. Somebody who raised one and then found the
 * real cause themselves has done us a favour; charging them one of their two
 * for it teaches the opposite lesson. `countsAgainstLimit` is the same rule in
 * TypeScript.
 */
create or replace function public.enforce_claim_eligibility()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  booking public.bookings%rowtype;
  prior integer;
begin
  select * into booking from public.bookings where id = new.booking_id;

  if booking.id is null then
    raise exception 'No such booking' using errcode = 'foreign_key_violation';
  end if;

  if booking.customer_id <> new.customer_id then
    raise exception 'A guarantee claim belongs to the customer whose job it was'
      using errcode = 'check_violation';
  end if;

  if booking.status <> 'completed' then
    raise exception 'Only a finished job can be claimed on (this one is %)', booking.status
      using errcode = 'check_violation';
  end if;

  select count(*) into prior
  from public.guarantee_claims
  where booking_id = new.booking_id
    and status <> 'withdrawn';

  if prior >= 2 then
    raise exception 'This booking has already had two claims'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_claim_eligibility() from public;

drop trigger if exists guarantee_claims_eligibility on public.guarantee_claims;
create trigger guarantee_claims_eligibility
  before insert on public.guarantee_claims
  for each row execute function public.enforce_claim_eligibility();

-- ---------------------------------------------------------------------------
-- RLS: three readers, no writers
-- ---------------------------------------------------------------------------

alter table public.guarantee_claims enable row level security;

drop policy if exists "Customers read their own claims" on public.guarantee_claims;
create policy "Customers read their own claims"
  on public.guarantee_claims for select
  to authenticated
  using (customer_id = (select auth.uid()));

/*
 * The professional sees a claim against their work, and one they were sent to
 * look at. Both halves matter: the first is how somebody learns a job came
 * back, and hiding it would mean the ledger entry arrives with no explanation.
 */
drop policy if exists "Providers read claims that involve them" on public.guarantee_claims;
create policy "Providers read claims that involve them"
  on public.guarantee_claims for select
  to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.profile_id = (select auth.uid())
        and p.id in (guarantee_claims.provider_id, guarantee_claims.attending_provider_id)
    )
  );

drop policy if exists "Admins read every claim" on public.guarantee_claims;
create policy "Admins read every claim"
  on public.guarantee_claims for select
  to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
--
-- WHAT A CLAIM ACTUALLY COSTS SOMEBODY, written down where they can read it.
--
-- Three cases and only one moves money, exactly as `lib/config/guarantee.ts`
-- sets out. The original professional goes back themselves and nothing is
-- owed; or somebody else attends, is paid in full for real work, and that
-- amount becomes a debt netted off the first one's FUTURE earnings; or they
-- never work for us again and it is written off.
--
-- APPEND-ONLY, and that is the whole point of a ledger rather than a balance
-- column. A number that can be edited proves nothing, and this one decides how
-- much of somebody's next payout they actually receive. The trigger refuses
-- UPDATE and DELETE for every caller, service role included.
--
-- WE NEVER CHASE A PAID-OUT PROFESSIONAL FOR CASH. There is no debt collection
-- here and there never will be: `applyRedoRecovery` takes at most a quarter of
-- a future payout, and a write-off is an ordinary row rather than a failure.
-- ---------------------------------------------------------------------------

create table if not exists public.provider_ledger (
  id uuid primary key default gen_random_uuid(),

  provider_id uuid not null references public.providers (id) on delete cascade,
  claim_id uuid references public.guarantee_claims (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,

  kind text not null check (kind in ('redo_debt', 'recovery', 'write_off')),

  -- Always positive. `kind` decides the direction, because a signed amount
  -- reads wrong in every report that sums it without looking.
  amount_rupees integer not null check (amount_rupees > 0),

  -- One sentence the professional can read. This is money off their earnings,
  -- so an unexplained row is worse than no row.
  note text check (char_length(note) <= 300),

  created_at timestamptz not null default now()
);

comment on table public.provider_ledger is
  'Redo debts and their recovery, append-only. A balance column can be edited; a ledger cannot, and this decides how much of somebody''s next payout they receive.';

create index if not exists provider_ledger_provider_idx
  on public.provider_ledger (provider_id, created_at desc);

create index if not exists provider_ledger_claim_idx
  on public.provider_ledger (claim_id);

drop trigger if exists provider_ledger_append_only on public.provider_ledger;
create trigger provider_ledger_append_only
  before update or delete on public.provider_ledger
  for each row execute function public.refuse_rewrite();

/**
 * What is still owed. Never negative: a recovery that overshoots is a
 * bookkeeping error, not money the platform owes a professional.
 *
 * `security definer` so the provider dashboard can ask for its own number
 * without a policy on every row it sums.
 */
create or replace function public.provider_outstanding(target uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    0,
    coalesce(sum(case when kind = 'redo_debt' then amount_rupees else -amount_rupees end), 0)
  )::integer
  from public.provider_ledger
  where provider_id = target;
$$;

revoke execute on function public.provider_outstanding(uuid) from public, anon;

alter table public.provider_ledger enable row level security;

drop policy if exists "Providers read their own ledger" on public.provider_ledger;
create policy "Providers read their own ledger"
  on public.provider_ledger for select
  to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.id = provider_ledger.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every ledger entry" on public.provider_ledger;
create policy "Admins read every ledger entry"
  on public.provider_ledger for select
  to authenticated
  using (public.is_admin());
