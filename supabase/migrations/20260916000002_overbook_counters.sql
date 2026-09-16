-- Counting the offers, so the miss rate has a denominator.
--
-- `overbookRankingPenalty` is a RATE with a floor: below OVERBOOK_MIN_OFFERS
-- (ten) it does not touch ranking at all, because one miss out of two offers
-- reads as a 50% failure rate and is statistically nothing. That floor only
-- works if the denominator is counted where every path can be seen — a counter
-- incremented by today's button is a counter the next path forgets.
--
-- TEN, NOT THIRTY, because offers are RARE BY CONSTRUCTION: a professional only
-- generates one by choosing to fit somebody in beside a job they already hold,
-- there is no standing setting, and a customer cannot ask. A floor of thirty on
-- a signal nobody generates freely would mean it never activates.

create or replace function public.record_overbook_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the moment an offer appears. Clearing one (a claim that lost its
  -- race) must not count backwards, and re-stamping the same booking cannot
  -- happen — the write guards on `overbook_offered_at is null`.
  if new.overbook_offered_by is null
     or old.overbook_offered_by is not null then
    return null;
  end if;

  insert into public.provider_stats (provider_id, overbook_offers)
  values (new.overbook_offered_by, 1)
  on conflict (provider_id) do update
    set overbook_offers = public.provider_stats.overbook_offers + 1,
        updated_at = now();

  return null;
end;
$$;

revoke execute on function public.record_overbook_offer()
  from public, anon, authenticated;

drop trigger if exists bookings_record_overbook_offer on public.bookings;
create trigger bookings_record_overbook_offer
  after update of overbook_offered_by on public.bookings
  for each row execute function public.record_overbook_offer();

-- ---------------------------------------------------------------------------
-- A miss, which is the thing that actually costs anything
-- ---------------------------------------------------------------------------
--
-- A MISS IS NOT A WITHDRAWAL AND IS NOT COUNTED AS ONE. They turned up, and
-- they were trying to take MORE work — the offer is the only reason the second
-- customer got a slot at all. `OVERBOOK_RANKING_PENALTY_MAX` is half the
-- withdrawal ceiling for exactly that reason, and the release below writes NO
-- refusal row: a professional still on the first job when the second window
-- opened was working, not refusing, and a refusal would keep them out of that
-- customer's replacement list for a job they never turned down.

alter table public.bookings
  add column if not exists overbook_missed_at timestamptz;

comment on column public.bookings.overbook_missed_at is
  'Set when a professional who offered to fit this customer in could not reach them inside the window and handed the job back. Counted in provider_stats.overbook_misses for ranking only — never a refusal, never a withdrawal, and never money.';

create or replace function public.record_overbook_miss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.overbook_missed_at is null
     or old.overbook_missed_at is not null
     or old.provider_id is null then
    return null;
  end if;

  insert into public.provider_stats (provider_id, overbook_misses)
  values (old.provider_id, 1)
  on conflict (provider_id) do update
    set overbook_misses = public.provider_stats.overbook_misses + 1,
        updated_at = now();

  return null;
end;
$$;

revoke execute on function public.record_overbook_miss()
  from public, anon, authenticated;

drop trigger if exists bookings_record_overbook_miss on public.bookings;
create trigger bookings_record_overbook_miss
  after update of overbook_missed_at on public.bookings
  for each row execute function public.record_overbook_miss();

-- Neither timestamp is the browser's to write, for the same reason the offer
-- itself is not: a counter a caller can move is a counter that measures
-- nothing. Rebuilt from the CURRENT definition — rebuilding this function from
-- an older migration silently dropped every settlement check once already.
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

  if new.quote_model is distinct from old.quote_model
     or new.surveyed_at is distinct from old.surveyed_at
     or new.quote_expires_at is distinct from old.quote_expires_at
     or new.quote_approved_at is distinct from old.quote_approved_at
     or new.quote_declined_at is distinct from old.quote_declined_at then
    raise exception 'A surveyed price is recorded by the server, not a browser'
      using errcode = 'check_violation';
  end if;

  if new.overbook_offered_by is distinct from old.overbook_offered_by
     or new.overbook_offered_at is distinct from old.overbook_offered_at
     or new.overbook_missed_at is distinct from old.overbook_missed_at then
    raise exception 'An overbooking offer is the professional''s to make, not a browser''s'
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
-- A miss releases the job WITHOUT recording a refusal
-- ---------------------------------------------------------------------------
--
-- `record_provider_release` writes a `booking_refusals` row on every release,
-- which is what stops a refused job being offered straight back to the person
-- who refused it and what keeps them out of the customer's replacement list.
-- Both are right for a refusal and wrong for this: somebody who offered to fit
-- a customer in and then ran late did not turn the job down, and barring them
-- from it would punish exactly the behaviour the offer exists to encourage.
--
-- The same shape as `widened_by_customer_at`, which already suppresses a
-- refusal when the customer opened the job early — the professional was slow,
-- not unwilling.
create or replace function public.record_provider_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid := old.provider_id;
  refusal text;
begin
  if who is null or new.provider_id is not null then
    return null;
  end if;

  -- The customer widened it. Nobody said no.
  if new.widened_by_customer_at is distinct from old.widened_by_customer_at then
    return null;
  end if;

  -- An honest overrun on a job they OFFERED to squeeze in. Counted for ranking
  -- through `overbook_misses`, never as a refusal: barring them from a job they
  -- never turned down would punish exactly the behaviour the offer exists to
  -- encourage, and a refusal row also keeps them out of that customer's
  -- replacement list.
  if new.overbook_missed_at is distinct from old.overbook_missed_at then
    return null;
  end if;

  if new.status = 'pending' and old.status in ('accepted', 'en_route') then
    refusal := 'withdrawn';
  elsif new.status = 'pending' and old.status = 'pending' then
    refusal := 'declined';
  else
    return null;
  end if;

  if refusal = 'withdrawn' then
    insert into public.provider_stats (provider_id, withdrawals, last_withdrawal_at)
    values (who, 1, now())
    on conflict (provider_id) do update
      set withdrawals = public.provider_stats.withdrawals + 1,
          last_withdrawal_at = now(),
          updated_at = now();
  else
    insert into public.provider_stats (provider_id, declines)
    values (who, 1)
    on conflict (provider_id) do update
      set declines = public.provider_stats.declines + 1,
          updated_at = now();
  end if;

  insert into public.booking_refusals (booking_id, provider_id, kind)
  values (old.id, who, refusal)
  on conflict (booking_id, provider_id) do nothing;

  return null;
end;
$$;

revoke execute on function public.record_provider_release()
  from public, anon, authenticated;
