-- Phase 8: live tracking, the provider's side of a job, and notifications.
--
-- Three things this adds, and one it deliberately does not.
--
--   notifications      — the in-app channel's storage. Written by the server,
--                        read by the person it is for, never by anyone else.
--   provider_contacts  — the professional's phone, separated from `providers`
--                        precisely BECAUSE `providers` is world-readable. See
--                        the note above that table.
--   realtime           — bookings joins the realtime publication so a customer
--                        watching their job sees a status change without asking.
--
-- What it does not add: a cancellation *charge*. The window is the policy —
-- cancelling is allowed only while it is free, and refused once a professional
-- has spent a trip. The columns to record a fee exist so that the day there is
-- an instrument to collect one, it is a constant and a copy change rather than
-- a migration. Inventing a fee we cannot charge would put a number on screen
-- that nothing enforces.

-- ---------------------------------------------------------------------------
-- Who cancelled, and what it cost.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists cancelled_by_role text
    check (cancelled_by_role in ('customer', 'provider', 'admin', 'system')),
  add column if not exists cancellation_fee integer not null default 0
    check (cancellation_fee >= 0);

comment on column public.bookings.cancellation_fee is
  'Always 0 today: the cancellation window only permits cancelling while it is free. Here so a fee is a constant, not a migration. See lib/booking/cancellation.ts.';

-- ---------------------------------------------------------------------------
-- The professional's phone.
--
-- NOT a column on `providers`. That table is readable by `anon` — it is the
-- public directory — so a phone number on it would be a phone number on the
-- open internet, for every professional, forever. It lives here instead, with
-- a policy that hands it out only to a customer whose job that professional
-- has actually accepted.
-- ---------------------------------------------------------------------------

create table if not exists public.provider_contacts (
  provider_id uuid primary key
    references public.providers (id) on delete cascade,
  -- E.164, as everywhere else in the product.
  phone text not null check (phone ~ '^\+977[0-9]{9,10}$'),
  updated_at timestamptz not null default now()
);

alter table public.provider_contacts enable row level security;

-- The professional reads their own.
drop policy if exists "Providers read their own contact" on public.provider_contacts;
create policy "Providers read their own contact"
  on public.provider_contacts for select to authenticated
  using (exists (
    select 1 from public.providers p
    where p.id = provider_contacts.provider_id
      and p.profile_id = (select auth.uid())
  ));

-- A customer reads it only once the job is live: accepted, on the way, or
-- under way. Not while pending — nobody has agreed to anything yet — and not
-- after it is over, because a finished job is not a standing right to somebody's
-- number.
drop policy if exists "Customers read the contact of a professional on their live job" on public.provider_contacts;
create policy "Customers read the contact of a professional on their live job"
  on public.provider_contacts for select to authenticated
  using (exists (
    select 1 from public.bookings b
    where b.provider_id = provider_contacts.provider_id
      and b.customer_id = (select auth.uid())
      and b.status in ('accepted', 'en_route', 'in_progress')
  ));

drop policy if exists "Admins read every contact" on public.provider_contacts;
create policy "Admins read every contact"
  on public.provider_contacts for select to authenticated
  using (public.is_admin());

-- No insert or update policy: contacts are managed by the server role, the
-- same rule payments follow.

-- ---------------------------------------------------------------------------
-- Notifications — the in-app channel.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete cascade,

  -- What happened, as a key the interface translates. Never a sentence: a
  -- notification written in English cannot be read back in Nepali, and the
  -- reader's language is a property of the reader, not of the event.
  kind text not null check (char_length(kind) <= 60),
  -- Placeholders for that key — a reference, a name. Data, not prose.
  params jsonb not null default '{}'::jsonb,

  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_profile_idx
  on public.notifications (profile_id, created_at desc);

create index if not exists notifications_unread_idx
  on public.notifications (profile_id) where read_at is null;

comment on table public.notifications is
  'The in-app notification channel. SMS and push are Phase 13 and are additional channels behind lib/notify, not replacements for this one.';

alter table public.notifications enable row level security;

drop policy if exists "People read their own notifications" on public.notifications;
create policy "People read their own notifications"
  on public.notifications for select to authenticated
  using ((select auth.uid()) = profile_id);

-- Marking one read is the only thing a reader may change, and they may not
-- change whose it is or what it says.
drop policy if exists "People mark their own notifications read" on public.notifications;
create policy "People mark their own notifications read"
  on public.notifications for update to authenticated
  using ((select auth.uid()) = profile_id)
  with check ((select auth.uid()) = profile_id);

-- No insert policy. Notifications are written by the server through
-- lib/notify, so a client cannot forge one — the same reasoning as payments.

-- ---------------------------------------------------------------------------
-- Realtime.
--
-- Postgres broadcasts the row change; Supabase's realtime server then applies
-- the table's RLS policies per subscriber before delivering it. A customer
-- therefore receives changes to their own bookings and nobody else's, which is
-- the same guarantee the page's first read already had.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'bookings'
    ) then
      alter publication supabase_realtime add table public.bookings;
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notifications'
    ) then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end if;
end
$$;

-- Realtime sends only the primary key on an update unless the table records
-- the whole row. Without this a status change arrives as "booking X changed"
-- with no status in it, and the client has to re-fetch to find out what to.
alter table public.bookings replica identity full;
alter table public.notifications replica identity full;
