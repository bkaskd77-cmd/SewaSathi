-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated user, created automatically on signup.
--
-- SajiloKaam authenticates by phone only — there is no email/password path —
-- so auth.users.phone is the identity and this table carries everything the
-- product needs on top of it.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  -- E.164, mirrored from auth.users.phone by the signup trigger so we can
  -- query and display it without reaching into the auth schema.
  phone text,
  preferred_language text not null default 'en'
    check (preferred_language in ('en', 'ne')),
  role text not null default 'customer'
    check (role in ('customer', 'provider', 'admin')),
  created_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile for each auth.users row. Created by trigger on signup.';

-- --- signup trigger ---------------------------------------------------------
-- Created server-side rather than by the client after sign-in: a client-side
-- insert can be skipped by closing the tab mid-flow, leaving an authenticated
-- user with no profile row and no way for the app to recover.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, phone)
  values (new.id, new.phone)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --- row level security -----------------------------------------------------

alter table public.profiles enable row level security;

-- `is_admin()` is SECURITY DEFINER on purpose. A policy on `profiles` that
-- queries `profiles` to check the caller's role re-enters its own policy and
-- Postgres raises "infinite recursion detected in policy". A definer function
-- runs with the owner's rights, skipping RLS inside the function body, which
-- breaks the cycle. `search_path = ''` stops a caller shadowing `public`.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

drop policy if exists "Profiles are readable by their owner" on public.profiles;
create policy "Profiles are readable by their owner"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Profiles are updatable by their owner" on public.profiles;
create policy "Profiles are updatable by their owner"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Admins can read every profile" on public.profiles;
create policy "Admins can read every profile"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

-- No insert policy: rows come from the trigger only. No delete policy:
-- deleting the auth.users row cascades, and nothing else should remove one.

create index if not exists profiles_role_idx on public.profiles (role);
