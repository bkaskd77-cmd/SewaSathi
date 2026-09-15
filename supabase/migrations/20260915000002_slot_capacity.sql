-- Two customers booking the same professional at 2pm.
--
-- Nothing stopped it. `canServeAt` answers "are they in somebody's house right
-- now", which is a different question from "is Thursday 2pm already spoken
-- for", and the customer who lost found out on the day — from somebody who did
-- not arrive.
--
-- THE CHECK IS A TRIGGER BECAUSE A BOOKING GAINS A PROFESSIONAL FIVE WAYS:
-- the customer choosing one, `claimJob`, `chooseProvider` after a withdrawal,
-- the dispatch sweep and an admin. Writing the check at each is four chances to
-- forget one, and the one forgotten is the one that double-books.
--
-- THE UNIT IS A TWO-HOUR WINDOW AND THAT IS A WORKAROUND, NOT A MODEL. A job
-- has a duration and this product does not record one — see the named
-- structural item in ARCHITECTURE.md. Counting overlapping windows is roughly
-- right for booking collisions and roughly meaningless as a model of anybody's
-- week. `lib/booking/capacity.ts` is the same rule in TypeScript, for the
-- screens; this is the one that cannot be bypassed.

-- ---------------------------------------------------------------------------
-- How many at once
-- ---------------------------------------------------------------------------

alter table public.categories
  add column if not exists max_concurrent_jobs integer not null default 2
    check (max_concurrent_jobs between 1 and 10);

comment on column public.categories.max_concurrent_jobs is
  'Jobs one professional may hold in one overlapping window. A WORKAROUND for the missing job-duration field, not a considered model of capacity: painting is 3 because a painter must not be blocked from a second job while the first one dries, NOT because anybody paints three flats at once.';

-- The ten, and two of them are 1 because the professional is physically in one
-- place for the whole job: a cleaner cleans one flat, a tank team drains one
-- tank. Movers is 1 as well AND is the reason the per-listing override below
-- exists — one man with a pickup does one move a day, a verified firm with
-- three trucks does three, and a category number cannot tell them apart.
update public.categories set max_concurrent_jobs = v.cap
from (values
  ('plumbing', 2), ('electrical', 3), ('home-cleaning', 1),
  ('appliance-repair', 2), ('carpentry', 2), ('pest-control', 2),
  ('painting', 3), ('ac-servicing', 2), ('water-tank-cleaning', 1),
  ('movers-packers', 1)
) as v(slug, cap)
where public.categories.slug = v.slug;

-- ---------------------------------------------------------------------------
-- The per-listing override, and why nobody may set their own
-- ---------------------------------------------------------------------------

alter table public.providers
  add column if not exists max_concurrent_jobs integer
    check (max_concurrent_jobs between 1 and 10);

comment on column public.providers.max_concurrent_jobs is
  'ADMIN-SET AT ONBOARDING FROM VERIFIED CREW SIZE, NEVER SELF-SET. Null means take the category default. A professional setting their own would make every listing say 10 and the cap would mean nothing, so no policy grants this column to anybody: it is written under the service role by an admin. Probation still caps it.';

-- ---------------------------------------------------------------------------
-- The offer, which is the only way past the cap
-- ---------------------------------------------------------------------------
--
-- Deliberate overbooking exists because a professional sometimes genuinely can
-- fit somebody in, and refusing it would send that customer away for nothing.
-- It is bounded three ways and each one is load-bearing:
--
--   * PER BOOKING, never a standing setting. A setting is made once, in an
--     optimistic mood, and then applies to every job for ever.
--   * NEVER CUSTOMER-INITIATED. The customer cannot buy themselves a seat, so
--     the columns below are refused to every browser caller by
--     `enforce_booking_immutability`.
--   * WORTH EXACTLY ONE SEAT. Otherwise offers stack until the cap is
--     decorative.

alter table public.bookings
  add column if not exists overbook_offered_by uuid
    references public.providers (id) on delete set null,
  add column if not exists overbook_offered_at timestamptz;

comment on column public.bookings.overbook_offered_by is
  'The professional who offered to fit this customer in beside a job they already held. Worth exactly one extra seat, on this booking only. Written under the service role after an RLS read proves the listing is the caller''s own.';

-- ---------------------------------------------------------------------------
-- Offers and misses, so the ranking has a denominator
-- ---------------------------------------------------------------------------

alter table public.provider_stats
  add column if not exists overbook_offers integer not null default 0,
  add column if not exists overbook_misses integer not null default 0;

comment on column public.provider_stats.overbook_offers is
  'How many times they offered to fit somebody in. RARE BY CONSTRUCTION — there is no standing setting and a customer cannot ask — which is why OVERBOOK_MIN_OFFERS is 10 and not 30: a floor of 30 on a signal nobody generates freely would never activate.';
comment on column public.provider_stats.overbook_misses is
  'Offers that then ran past the second customer''s window. Costs list position through `overbookRankingPenalty`, capped at half what withdrawing costs — they turned up and were taking MORE work, and punishing that as hard as not turning up teaches everybody never to offer.';

-- ---------------------------------------------------------------------------
-- The rule
-- ---------------------------------------------------------------------------

create or replace function public.booking_slot_capacity(
  p_provider_id uuid,
  p_category_slug text,
  p_overbook_offered boolean
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    1,
    least(
      coalesce(p.max_concurrent_jobs, c.max_concurrent_jobs),
      -- PROBATION ALWAYS CAPS, whatever the override says. A new listing has
      -- not shown it can hold two jobs, let alone a firm's three. Mirrors
      -- PROBATION.maxConcurrentJobs in lib/verification/probation.ts.
      case when p.standing = 'provisional' then 2 else 10 end
    )
  ) + case when p_overbook_offered then 1 else 0 end
  from public.providers p
  cross join public.categories c
  where p.id = p_provider_id and c.slug = p_category_slug;
$$;

revoke execute on function public.booking_slot_capacity(uuid, text, boolean)
  from public, anon, authenticated;

create or replace function public.enforce_slot_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Must match WORKING_HOURS.slotHours in lib/booking/schedule.ts. Two hours.
  slot interval := interval '120 minutes';
  wanted_start timestamptz;
  taken integer;
  allowed integer;
begin
  if new.provider_id is null then
    return new;
  end if;

  -- Only when the ASSIGNMENT or the WINDOW moves. A job already legally held
  -- must not be re-judged on its way to `completed`, or settling a payment on
  -- a row somebody was allowed to overbook would raise.
  if tg_op = 'UPDATE'
     and new.provider_id is not distinct from old.provider_id
     and new.scheduled_for is not distinct from old.scheduled_for then
    return new;
  end if;

  -- SERIALISE ON THE PROFESSIONAL, or the count below is a read that lies.
  -- Two transactions claiming two different jobs for the same person at the
  -- same moment each see zero taken under read committed, both pass, and both
  -- commit — which is precisely the double-booking this file exists to stop.
  -- The claim policy settles a race for ONE booking; this is a race for one
  -- professional's time across two. Transaction-scoped, keyed on the provider,
  -- so it is released at commit and never blocks anybody else's booking.
  perform pg_advisory_xact_lock(hashtextextended(new.provider_id::text, 0));

  -- An as-soon-as-possible job starts now, which is what the customer asked
  -- for. `created_at` rather than now() so re-checking an existing row gives
  -- the same answer it gave when it was written.
  wanted_start := coalesce(new.scheduled_for, new.created_at, now());

  select count(*) into taken
  from public.bookings b
  where b.provider_id = new.provider_id
    and b.id <> new.id
    and b.status in ('pending', 'accepted', 'en_route', 'in_progress')
    -- Half-open on both sides: a job ending exactly as this one starts does
    -- NOT collide, or a full day of back-to-back work would read as a day of
    -- conflicts and grey out a working schedule.
    and coalesce(b.scheduled_for, b.created_at) < wanted_start + slot
    and wanted_start < coalesce(b.scheduled_for, b.created_at) + slot;

  -- coalesce, never null: `taken >= null` is null, which is not a raise, and a
  -- capacity check that silently passes is worse than one that is wrong.
  allowed := coalesce(
    public.booking_slot_capacity(
      new.provider_id,
      new.category_slug,
      new.overbook_offered_at is not null
    ),
    1
  );

  if taken >= allowed then
    raise exception 'That professional is already booked for this time'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_slot_capacity()
  from public, anon, authenticated;

-- Sorts after `bookings_enforce_immutability`, which is what refuses a
-- browser-written offer — so by the time capacity is counted the +1 has already
-- been proved legitimate. Trigger order in Postgres is alphabetical by name.
drop trigger if exists bookings_enforce_slot_capacity on public.bookings;
create trigger bookings_enforce_slot_capacity
  before insert or update on public.bookings
  for each row execute function public.enforce_slot_capacity();

-- ---------------------------------------------------------------------------
-- The offer is not the customer's to write
-- ---------------------------------------------------------------------------
--
-- RLS is row-level, so "customers cancel their own open bookings" would
-- otherwise let a customer stamp `overbook_offered_at` on their own booking and
-- buy themselves the extra seat — turning the one rule that says "never
-- customer-initiated" into a checkbox. Same mechanism, same file, one more
-- column pair: `auth.uid()` is null for the service role, which is how the
-- professional's own offer (written in lib/data after an RLS read proves the
-- listing is theirs) passes through.

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

  -- NEVER CUSTOMER-INITIATED, and RLS cannot say so: the cancel policy makes
  -- the row updatable and row-level means every column on it. Without this a
  -- customer stamps the offer on their own booking and buys the extra seat,
  -- turning the rule into a checkbox.
  if new.overbook_offered_by is distinct from old.overbook_offered_by
     or new.overbook_offered_at is distinct from old.overbook_offered_at then
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

create index if not exists bookings_provider_window_idx
  on public.bookings (provider_id, scheduled_for)
  where status in ('pending', 'accepted', 'en_route', 'in_progress');
