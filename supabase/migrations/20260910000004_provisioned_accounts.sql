-- Provisioned accounts: a role that is waiting before the person arrives.
--
-- WHY THIS EXISTS. Phone OTP is the only way into this product, and role is a
-- column on `profiles` that the signup trigger sets to 'customer'. So every
-- walkthrough of the provider or admin surfaces went: sign in, then have
-- somebody run an UPDATE by hand against production. That is manual work that
-- was already automatable, it needs the service role every time, and the SQL
-- was pasted from a chat window — which is exactly the shape of mistake that
-- ends with the wrong profile made admin.
--
-- The grant is now a row. `handle_new_user` reads it at signup and the account
-- arrives with the role it is supposed to have, whether the person signs in
-- today or in a month.
--
-- IT IS ALSO THE BREAK-GLASS. If the SMS gateway never delivers, or the only
-- admin account is lost, admin is restored by adding a row here and signing in
-- on that number — no dashboard SQL, no service-role key in somebody's
-- clipboard, and nothing that depends on a message arriving.
--
-- THIS IS A REAL PRIVILEGE PATH AND IT IS TREATED AS ONE. A row here means
-- "whoever proves control of this number is an admin". That is already true of
-- every account in a phone-only product, but writing it down makes it
-- available to anybody with the service role, so:
--   * the table is service-role only for writes and admin-readable for reads;
--   * every application is written to `security_events`, which is append-only
--     and refuses UPDATE and DELETE for every caller including the service
--     role, so a grant cannot be used and then tidied away;
--   * `provisioned_accounts` entries paired with Supabase test OTPs are a
--     launch blocker (`test-account-otps`), because a fixed code on a live
--     admin number is a password that never rotates.

create table if not exists public.provisioned_accounts (
  -- E.164, matching `auth.users.phone`'s own normalisation, which has no '+'.
  -- Stored the way the trigger will compare it so the lookup cannot miss on a
  -- formatting difference — the mistake that made the provider-lead lookup
  -- silently find nothing.
  phone text primary key,

  role text not null check (role in ('customer', 'provider', 'admin')),

  -- Who this is for, in words. A table of bare numbers is unreadable six
  -- months later, and the person deciding whether a grant is still needed
  -- needs to know what it was for.
  label text not null,

  -- Optional: link the new account to an existing provider listing, so a
  -- provider walkthrough reaches `/provider/jobs` with jobs on it rather than
  -- the "your account is not linked to a listing" dead end.
  provider_id uuid references public.providers (id) on delete set null,

  -- Set when the grant is actually used. A grant that has never been claimed
  -- and a grant that is in daily use are different risks, and telling them
  -- apart is what makes a clean-up decidable.
  claimed_at timestamptz,
  claimed_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now(),
  note text
);

comment on table public.provisioned_accounts is
  'Role (and optional provider listing) waiting for a phone number to sign in. Read by handle_new_user. A row is a privilege grant: service-role writes only, every application audited.';

create index if not exists provisioned_accounts_unclaimed_idx
  on public.provisioned_accounts (created_at)
  where claimed_at is null;

-- --- the grant is applied at signup ------------------------------------------
--
-- Extends the existing trigger rather than adding a second one: two triggers
-- writing the same row race, and the order between them is not something the
-- application controls.
--
-- `search_path = ''` is kept, so every name here is schema-qualified. It is
-- also why the lookup is written against `auth.users.phone` exactly as
-- Supabase stores it.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grant_row public.provisioned_accounts%rowtype;
begin
  select * into grant_row
  from public.provisioned_accounts
  where phone = new.phone;

  insert into public.profiles (id, phone, role)
  values (new.id, new.phone, coalesce(grant_row.role, 'customer'))
  on conflict (id) do nothing;

  if grant_row.phone is not null then
    -- The listing, if one was named. `is not distinct from` rather than `is
    -- null`: re-pointing a listing that is already linked to somebody else
    -- would quietly take a professional's jobs away from them.
    if grant_row.provider_id is not null then
      update public.providers
         set profile_id = new.id
       where id = grant_row.provider_id
         and profile_id is null;
    end if;

    update public.provisioned_accounts
       set claimed_at = coalesce(claimed_at, now()),
           claimed_by = coalesce(claimed_by, new.id)
     where phone = grant_row.phone;

    -- Append-only, and refused UPDATE and DELETE for every caller including
    -- the service role. A privilege grant that leaves no trace is not a grant,
    -- it is a back door.
    -- `system` as the actor, because nobody decided this at signup time: the
    -- decision was made when the row was written, and the person arriving
    -- merely proved control of the number. `actor_id` is still theirs, which
    -- is what makes the grant traceable to an account afterwards.
    insert into public.security_events (kind, actor_role, actor_id, subject_type, subject_id, detail)
    values (
      'role.changed',
      'system',
      new.id,
      'profile',
      new.id::text,
      jsonb_build_object(
        'via', 'provisionedAccount',
        'role', grant_row.role,
        'label', grant_row.label,
        'providerId', grant_row.provider_id
      )
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- --- row level security -------------------------------------------------------
--
-- No insert, update or delete policy for anybody: writes are the service
-- role's alone, the same rule as `payments`. Admins may read, because deciding
-- whether a grant is still needed requires seeing it, and an admin can already
-- read every profile.

alter table public.provisioned_accounts enable row level security;

drop policy if exists "Admins read provisioned accounts" on public.provisioned_accounts;
create policy "Admins read provisioned accounts"
  on public.provisioned_accounts
  for select
  to authenticated
  using (public.is_admin());

-- --- existing accounts --------------------------------------------------------
--
-- The trigger only fires on insert, so anybody who already signed in would
-- never see their grant. Applied once here, matching on phone, so the table is
-- the single answer to "who has what" rather than being true only for accounts
-- created after this migration.

update public.profiles p
   set role = g.role
  from public.provisioned_accounts g
 where p.phone = g.phone
   and p.role is distinct from g.role;

update public.providers pr
   set profile_id = p.id
  from public.provisioned_accounts g
  join public.profiles p on p.phone = g.phone
 where pr.id = g.provider_id
   and pr.profile_id is null;

update public.provisioned_accounts g
   set claimed_at = coalesce(g.claimed_at, now()),
       claimed_by = coalesce(g.claimed_by, p.id)
  from public.profiles p
 where p.phone = g.phone;
