-- Bookings.
--
-- The first table in this product that holds a promise between two people, so
-- it is stricter than the ones before it.
--
-- Two decisions are baked into the columns and are worth stating, because both
-- are the kind of thing that is expensive to change later:
--
-- 1. The quoted price is FROZEN here, not read from `categories` at display
--    time. A customer who was quoted 1,200–1,800 was quoted that, and
--    repricing the category next month must not silently rewrite what they
--    agreed to. This is the whole reason quoted_min/quoted_max exist rather
--    than a join.
-- 2. `provider_id` is nullable. "Send whoever is available" is the common case
--    for an emergency at 11pm, and forcing a choice at booking time would make
--    the fastest path the hardest one. Null means unassigned, not broken.
--
-- Money is integer NPR. No currency column: this product is Nepal-only, and a
-- nullable currency that is always 'NPR' is a column that lies later.

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),

  -- A short human-quotable reference. "SK-7F3K2M" is what somebody reads down
  -- a phone line; a uuid is not.
  reference text not null unique,

  customer_id uuid not null references public.profiles (id) on delete cascade,

  -- Null until dispatch assigns someone. `on delete set null` rather than
  -- cascade: a provider leaving the platform must never delete the customer's
  -- record of a job that happened.
  provider_id uuid references public.providers (id) on delete set null,

  -- Soft reference to categories.slug, like provider_leads: renaming a
  -- category must not delete somebody's booking history.
  category_slug text not null,

  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'on_the_way', 'completed', 'cancelled')),

  -- Same vocabulary the triage result uses, so a booking made straight from a
  -- triage card carries its urgency through unchanged.
  urgency text not null default 'routine'
    check (urgency in ('emergency', 'soon', 'routine')),

  -- Null means "as soon as possible", which is the default and the promise the
  -- landing page makes. A timestamp means the customer picked a slot.
  scheduled_for timestamptz,

  -- Where. Ward key from lib/config/areas.ts, plus the free text that actually
  -- gets someone to the door — in Kathmandu that is a landmark, not a number.
  area_key text not null,
  address_line text not null,
  landmark text,

  -- Who to call. Copied from the profile at booking time rather than joined:
  -- changing your account number later must not redirect a professional who is
  -- already on the way to a job.
  contact_phone text not null,
  contact_name text not null,

  notes text,

  -- The band quoted at booking time. See note 1 above.
  quoted_min integer not null check (quoted_min > 0),
  quoted_max integer not null check (quoted_max >= quoted_min),

  -- Agreed on site, after the professional has seen the job. Null until then.
  final_price integer check (final_price >= 0),

  -- Chosen at completion, not at booking: this product is pay-after-work.
  payment_method text
    check (payment_method in ('cash', 'esewa', 'khalti')),

  -- Which language the booking was made in, so a confirmation SMS goes out in
  -- the language the customer was reading.
  locale text not null default 'en' check (locale in ('en', 'ne')),

  cancelled_by text check (cancelled_by in ('customer', 'provider', 'admin')),
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,

  -- A completed booking has a price and a time; a cancelled one has neither.
  -- Enforced here because a status field that disagrees with its own
  -- timestamps is how a report silently produces the wrong number.
  constraint bookings_completed_shape check (
    (status = 'completed') = (completed_at is not null)
  ),
  constraint bookings_cancelled_shape check (
    (status = 'cancelled') = (cancelled_at is not null)
  )
);

comment on table public.bookings is
  'Jobs customers have booked. quoted_min/quoted_max are frozen at booking time on purpose — repricing a category must never rewrite an agreed quote.';

-- The list page reads exactly this: one customer, newest first.
create index if not exists bookings_customer_idx
  on public.bookings (customer_id, created_at desc);

-- Dispatch reads this: what is unassigned, most urgent first.
create index if not exists bookings_dispatch_idx
  on public.bookings (status, urgency, created_at)
  where provider_id is null;

create index if not exists bookings_provider_idx
  on public.bookings (provider_id, created_at desc);

-- updated_at, without trusting the application to remember.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bookings_touch_updated_at on public.bookings;
create trigger bookings_touch_updated_at
  before update on public.bookings
  for each row execute function public.touch_updated_at();

alter table public.bookings enable row level security;

-- A customer sees their own bookings and nobody else's.
drop policy if exists "Customers read their own bookings" on public.bookings;
create policy "Customers read their own bookings"
  on public.bookings for select
  to authenticated
  using ((select auth.uid()) = customer_id);

-- And may create one only for themselves. `with check` on customer_id is what
-- stops a crafted insert booking a job in somebody else's name.
drop policy if exists "Customers create their own bookings" on public.bookings;
create policy "Customers create their own bookings"
  on public.bookings for insert
  to authenticated
  with check ((select auth.uid()) = customer_id);

-- A customer may edit their own booking, but only while it is still pending or
-- confirmed. Once a professional is on the way, changes go through support —
-- and a customer must never be able to mark their own job completed, which is
-- what would let them set final_price.
drop policy if exists "Customers change their own open bookings" on public.bookings;
create policy "Customers change their own open bookings"
  on public.bookings for update
  to authenticated
  using (
    (select auth.uid()) = customer_id
    and status in ('pending', 'confirmed')
  )
  with check (
    (select auth.uid()) = customer_id
    and status in ('pending', 'confirmed', 'cancelled')
  );

drop policy if exists "Admins read every booking" on public.bookings;
create policy "Admins read every booking"
  on public.bookings for select
  to authenticated
  using (public.is_admin());

-- No delete policy anywhere. A booking is cancelled, never erased: it is the
-- record of what was promised to somebody.
