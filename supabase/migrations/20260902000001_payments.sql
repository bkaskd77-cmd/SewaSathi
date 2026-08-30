-- Payments, refunds, and what the platform is owed.
--
-- This product is not a checkout. The quote is a band, the final figure is
-- agreed on site before work starts, and money moves after the work is done.
-- Three consequences shape everything below:
--
--   1. Payment status is its own column and its own state machine. A booking
--      can be completed and unpaid — that is the normal case for cash, not an
--      error — so conflating the two would make the ordinary path look broken.
--   2. The final amount is entered by a person standing in somebody's kitchen.
--      That is the fraud and dispute surface, so it is constrained here rather
--      than trusted from the app.
--   3. The raw gateway response is stored. When a payment is disputed in six
--      months, that record is the only evidence of what actually happened, and
--      it cannot be reconstructed from a status column.

-- ---------------------------------------------------------------------------
-- What the platform takes, and what the professional earns
-- ---------------------------------------------------------------------------
--
-- Payouts are a later phase, but the landing page already promises weekly
-- payouts. Recording what is owed from the first booking is far cheaper than
-- reconstructing months of it later from prices that may since have changed.
--
-- The rate lives in lib/payments/commission.ts and is applied at completion;
-- these columns are the frozen result, like quoted_min/quoted_max before them.
-- A rate change must never restate what a professional was already told.

alter table public.bookings
  add column if not exists platform_fee integer check (platform_fee >= 0),
  add column if not exists provider_earning integer check (provider_earning >= 0),
  -- Basis points, so a 15% rate is 1500 and there is no float to round badly.
  add column if not exists commission_bps integer check (commission_bps between 0 and 10000);

comment on column public.bookings.platform_fee is
  'Frozen at completion from lib/payments/commission.ts. Changing the rate must never restate what a professional was already told they had earned.';

-- The customer-approved figure when the professional quotes above the band.
alter table public.bookings
  add column if not exists final_amount_reason text
    check (char_length(final_amount_reason) <= 300),
  add column if not exists final_amount_approved_at timestamptz;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete restrict,

  method text not null check (method in ('cash', 'esewa', 'khalti')),

  -- Integer NPR, like every other amount in this schema.
  amount integer not null check (amount > 0),
  -- Nepal-only, but a gateway response carries a currency and reconciliation
  -- has to be able to say it did not match.
  currency text not null default 'NPR' check (currency = 'NPR'),

  status text not null default 'pending'
    check (status in (
      'pending', 'initiated', 'paid', 'failed', 'refunded', 'partially_refunded'
    )),

  -- Ours, generated before we ever talk to a gateway. This is the idempotency
  -- key: a duplicate callback, a double tap or a refreshed return page all
  -- carry the same one, and the unique index is what makes the handler safe to
  -- run twice.
  our_reference text not null unique,

  -- Theirs, once they give us one.
  provider_txn_id text,

  -- Everything the gateway said, verbatim. Not parsed into columns, because
  -- the fields we did not think to extract are exactly the ones a dispute
  -- turns on.
  raw_response jsonb,

  -- Why a verification failed, in words, for the reconciliation report.
  failure_reason text check (char_length(failure_reason) <= 500),

  initiated_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A settled payment has a settlement time; an unsettled one does not.
  constraint payments_settled_shape
    check ((status in ('paid', 'refunded', 'partially_refunded')) = (settled_at is not null))
);

comment on table public.payments is
  'One row per payment attempt. raw_response is kept verbatim because a dispute six months later turns on fields nobody thought to extract.';

create index if not exists payments_booking_idx
  on public.payments (booking_id, created_at desc);

-- The reconciliation sweep reads exactly this: anything that started and never
-- finished. A user who paid must never be shown as unpaid.
create index if not exists payments_stuck_idx
  on public.payments (status, initiated_at)
  where status = 'initiated';

-- ---------------------------------------------------------------------------
-- Refunds
-- ---------------------------------------------------------------------------

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,

  amount integer not null check (amount > 0),
  reason text not null check (char_length(reason) between 3 and 500),

  status text not null default 'requested'
    check (status in ('requested', 'processing', 'completed', 'rejected')),

  -- Null when the system raised it — a failed job auto-refund, say.
  requested_by uuid references public.profiles (id) on delete set null,
  requested_by_role text not null default 'customer'
    check (requested_by_role in ('customer', 'provider', 'admin', 'system')),

  provider_txn_id text,
  raw_response jsonb,

  created_at timestamptz not null default now(),
  processed_at timestamptz,

  constraint refunds_processed_shape
    check ((status in ('completed', 'rejected')) = (processed_at is not null))
);

create index if not exists refunds_payment_idx
  on public.refunds (payment_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The payment state machine
-- ---------------------------------------------------------------------------
--
-- Mirrored in lib/payments/status.ts, which the interface reads.
-- `npm run check:transitions` fails the build if the two disagree.
--
--   pending             -> initiated, paid, failed
--   initiated           -> paid, failed
--   failed              -> initiated, pending
--   paid                -> refunded, partially_refunded
--   partially_refunded  -> refunded, partially_refunded
--   refunded            -> (terminal)
--
-- `pending -> paid` exists for cash: there is no gateway to initiate with, the
-- customer confirms receipt and it settles. `failed -> initiated` is the retry,
-- and it is why a retry must reuse the booking but never the reference.

create or replace function public.payment_transition_allowed(
  from_status text,
  to_status text
) returns boolean
language sql
immutable
as $$
  select case from_status
    when 'pending'            then to_status in ('initiated', 'paid', 'failed')
    when 'initiated'          then to_status in ('paid', 'failed')
    when 'failed'             then to_status in ('initiated', 'pending')
    when 'paid'               then to_status in ('refunded', 'partially_refunded')
    when 'partially_refunded' then to_status in ('refunded', 'partially_refunded')
    else false
  end;
$$;

create or replace function public.enforce_payment_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then
      raise exception 'A payment must start as pending, not %', new.status
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not public.payment_transition_allowed(old.status, new.status) then
    raise exception 'A payment cannot go from % to %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Stamped here rather than trusted from the caller, same as bookings.
  if new.status = 'initiated' and new.initiated_at is null then
    new.initiated_at := now();
  end if;
  if new.status in ('paid', 'refunded', 'partially_refunded')
     and new.settled_at is null then
    new.settled_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists payments_enforce_transition on public.payments;
create trigger payments_enforce_transition
  before insert or update of status on public.payments
  for each row execute function public.enforce_payment_transition();

drop trigger if exists payments_touch_updated_at on public.payments;
create trigger payments_touch_updated_at
  before update on public.payments
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.payments enable row level security;
alter table public.refunds enable row level security;

-- A customer sees the payments on their own bookings and nobody else's.
drop policy if exists "Customers read their own payments" on public.payments;
create policy "Customers read their own payments"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.id = payments.booking_id
      and b.customer_id = (select auth.uid())
  ));

-- The assigned professional sees that a job was paid, and how — they need to
-- know whether to collect cash. They never see anybody else's.
drop policy if exists "Providers read payments on their jobs" on public.payments;
create policy "Providers read payments on their jobs"
  on public.payments for select to authenticated
  using (exists (
    select 1 from public.bookings b
    join public.providers p on p.id = b.provider_id
    where b.id = payments.booking_id
      and p.profile_id = (select auth.uid())
  ));

drop policy if exists "Admins read every payment" on public.payments;
create policy "Admins read every payment"
  on public.payments for select to authenticated
  using (public.is_admin());

/*
 * No insert or update policy for anyone.
 *
 * Deliberate, and the most important line in this file. Every write to
 * `payments` goes through a server route holding the service role, after
 * server-side verification against the gateway. A client that could insert a
 * payment row could mark its own booking paid; a client that could update one
 * could change the amount. RLS denying both by default is what makes that
 * impossible rather than merely uncoded.
 */

drop policy if exists "Customers read refunds on their payments" on public.refunds;
create policy "Customers read refunds on their payments"
  on public.refunds for select to authenticated
  using (exists (
    select 1
    from public.payments pay
    join public.bookings b on b.id = pay.booking_id
    where pay.id = refunds.payment_id
      and b.customer_id = (select auth.uid())
  ));

drop policy if exists "Admins read every refund" on public.refunds;
create policy "Admins read every refund"
  on public.refunds for select to authenticated
  using (public.is_admin());

-- Same reasoning as payments: refunds move money, so they are written by the
-- server or not at all.
