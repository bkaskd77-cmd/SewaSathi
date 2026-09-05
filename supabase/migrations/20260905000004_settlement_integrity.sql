-- Under-reporting, and the four things that make it not worth doing.
--
-- THE HOLE. A professional takes Rs 2,000 in cash and types 1,000. Nothing in
-- this product could tell: the figure is inside the published band, the
-- customer is standing there and may even have agreed to it, and no server
-- anywhere watched the notes change hands. The same trick works online — "pay
-- 3,000 through eSewa and give me 1,000 in hand" — and it is the ordinary way
-- marketplaces leak, everywhere, for ever.
--
-- Validating harder cannot fix it, because in the collusion case nobody in the
-- room is lying to anybody in the room. So:
--
--   1. REMOVE THE MOTIVE. The fee is charged on max(final_amount, quoted_min).
--      The band is ours and frozen onto the booking, so reporting less earns
--      nothing. `commission_floor_waived` is how support forgives a job that
--      genuinely came in under band, and `category_pricing_signals` is how we
--      find out that a whole category's band is simply wrong — that is our
--      pricing bug to fix, not a professional's fault.
--   2. MAKE THE CUSTOMER THE WITNESS. For cash they type what they actually
--      handed over, without being shown the professional's figure first.
--      `customer_reported_amount` and `amount_mismatch_at` are the two halves
--      of that, and a mismatch settles nothing.
--   3. GIVE THEM A RECEIPT. Somebody who paid 2,000 and gets a receipt for
--      1,000 notices — after the professional has gone, which is exactly when
--      it is safe to say so.
--   4. SHRINK THE CASH SHARE. `payout_due_at` is the honest lever: digital is
--      verified by a gateway and can be paid out quickly, cash has to be
--      reconciled from a typed confirmation and waits.

alter table public.bookings
  add column if not exists commission_basis integer
    check (commission_basis is null or commission_basis >= 0),
  add column if not exists commission_floor_waived boolean not null default false,
  add column if not exists customer_reported_amount integer
    check (customer_reported_amount is null or customer_reported_amount >= 0),
  add column if not exists amount_mismatch_at timestamptz,
  add column if not exists payout_due_at timestamptz;

comment on column public.bookings.commission_basis is
  'The figure the platform fee was charged on: max(final_amount, quoted_min) unless the floor was waived. Frozen at settlement alongside the fee.';
comment on column public.bookings.customer_reported_amount is
  'What the customer says they actually paid, typed without being shown the professional''s figure. The only independent witness a cash handover has.';
comment on column public.bookings.amount_mismatch_at is
  'When the two figures disagreed. Nothing settles while this is set — a booking with a mismatch is a support queue, not a payment.';
comment on column public.bookings.payout_due_at is
  'When this settlement becomes payable. Stored rather than recomputed: a professional told Thursday is paid on Thursday even if the hold times change on Wednesday.';

-- The customer's figure and the mismatch stamp are written by the server after
-- it has compared them. Neither is a browser's to set, and the same goes for
-- the fee basis and the payout clock.
create or replace function public.enforce_booking_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    return new;
  end if;

  if new.customer_id is distinct from old.customer_id
     or new.reference is distinct from old.reference
     or new.category_slug is distinct from old.category_slug then
    raise exception 'A booking cannot be re-identified'
      using errcode = 'check_violation';
  end if;

  if new.quoted_min is distinct from old.quoted_min
     or new.quoted_max is distinct from old.quoted_max
     or new.final_amount is distinct from old.final_amount
     or new.final_amount_approved_at is distinct from old.final_amount_approved_at
     or new.platform_fee is distinct from old.platform_fee
     or new.provider_earning is distinct from old.provider_earning
     or new.commission_bps is distinct from old.commission_bps
     or new.commission_basis is distinct from old.commission_basis
     or new.commission_floor_waived is distinct from old.commission_floor_waived
     or new.customer_reported_amount is distinct from old.customer_reported_amount
     or new.amount_mismatch_at is distinct from old.amount_mismatch_at
     or new.payout_due_at is distinct from old.payout_due_at
     or new.payment_status is distinct from old.payment_status then
    raise exception 'Prices and payment state are not editable from a browser'
      using errcode = 'check_violation';
  end if;

  if new.provider_id is distinct from old.provider_id
     and old.provider_id is not null
     and new.provider_id is not null then
    raise exception 'A booking that is already assigned cannot be reassigned'
      using errcode = 'check_violation';
  end if;

  if new.provider_id is distinct from old.provider_id
     and old.provider_id is null
     and new.provider_id is not null then
    if not public.provider_serves(new.provider_id, new.category_slug, new.address_id) then
      raise exception 'That professional does not cover this job'
        using errcode = 'check_violation';
    end if;
    if exists (
      select 1 from public.booking_refusals r
      where r.booking_id = new.id and r.provider_id = new.provider_id
    ) then
      raise exception 'That professional has already turned this job down'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_immutability()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE APPEAL.
--
-- The floor is deliberately blunt, and a blunt rule without an appeal is how a
-- platform loses the honest half of its supply. A tap that only needed a
-- washer is a real job that really was worth Rs 300 in a category whose floor
-- is 900, and the professional who did it quickly and cheaply is exactly the
-- one we least want to drive away.
--
-- So: one appeal per booking, in their own words, resolved by a person. It is
-- not a form that disappears — the professional can see its state, which is
-- what makes it a right rather than a gesture.
-- ---------------------------------------------------------------------------

create table if not exists public.commission_appeals (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  reason text not null check (char_length(reason) between 4 and 600),
  status text not null default 'open' check (status in ('open', 'upheld', 'rejected')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now()
);

comment on table public.commission_appeals is
  'A professional saying this job genuinely came in under the band. Upholding one sets bookings.commission_floor_waived and the split is recomputed.';

create index if not exists commission_appeals_open_idx
  on public.commission_appeals (status, created_at)
  where status = 'open';

alter table public.commission_appeals enable row level security;

drop policy if exists "Providers read their own appeals" on public.commission_appeals;
create policy "Providers read their own appeals"
  on public.commission_appeals for select to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.id = commission_appeals.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every appeal" on public.commission_appeals;
create policy "Admins read every appeal"
  on public.commission_appeals for select to authenticated
  using (public.is_admin());

-- No insert or update policy for anybody, on purpose, and for the same reason
-- `payments` has none: an appeal decides money. It is written by
-- lib/data/payments.ts under the service role, after that code has established
-- who is asking and that the floor was actually applied to this booking.

-- ---------------------------------------------------------------------------
-- IS OUR BAND WRONG?
--
-- If one professional lands under the floor, that is a small job. If a whole
-- category does it a third of the time, the floor is not a floor — it is a
-- price we published that does not match the work, and every one of those jobs
-- has been overcharged in fee by us. That is our correction to make, which is
-- why this counts by CATEGORY and never by person: read the other way it would
-- become a list of people to punish for our own mispricing.
-- ---------------------------------------------------------------------------

create or replace view public.category_pricing_signals as
  select
    b.category_slug,
    count(*) as settled_jobs,
    count(*) filter (where b.final_amount < b.quoted_min) as below_floor_jobs,
    round(
      100.0 * count(*) filter (where b.final_amount < b.quoted_min)
        / nullif(count(*), 0)
    , 1) as below_floor_pct,
    count(*) filter (where b.final_amount > b.quoted_max) as above_band_jobs,
    min(b.quoted_min) as quoted_min,
    max(b.quoted_max) as quoted_max,
    percentile_cont(0.5) within group (order by b.final_amount)::int as median_final,
    percentile_cont(0.25) within group (order by b.final_amount)::int as p25_final,
    percentile_cont(0.75) within group (order by b.final_amount)::int as p75_final
  from public.bookings b
  where b.payment_status = 'paid' and b.final_amount is not null
  group by b.category_slug;

comment on view public.category_pricing_signals is
  'Per category: how often settled jobs land under the published floor or over the band. A high below-floor share means our price is wrong, not that our professionals are.';

-- A view over `bookings` runs with the caller's own policies, so a customer
-- reading it would see only their own rows and get a meaningless aggregate.
-- It is read by lib/data under the service role, for support.
revoke all on public.category_pricing_signals from public, anon, authenticated;
