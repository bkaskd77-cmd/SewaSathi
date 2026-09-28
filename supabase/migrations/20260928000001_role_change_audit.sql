-- A role change leaves a trace, on every path, in the same transaction.
--
-- WHAT WAS WRONG. `lib/data/review.ts` promoted an approved applicant with a
-- bare `update({ role: 'provider' })` and logged only on failure. So the live
-- audit log holds two `role.changed` rows and BOTH say `customer` — they are
-- written by `handle_new_user` at provisioning. The two elevations that actually
-- produced the provider and the admin account left nothing behind, and neither
-- did the demotion of an admin back to customer. Nothing suggests those were
-- anything but the owner's own SQL; the point is that the log cannot say so, and
-- an absent record read as a clean one is the same mistake as a column default
-- read as a measurement.
--
-- A TRIGGER, NOT A CALL IN THE APPLICATION, and the choice is the whole design.
-- A `recordSecurityEvent` after the update would miss precisely the paths that
-- went unrecorded — a dashboard query, an MCP call, a future admin tool — and it
-- would not be in the same transaction, so a failure between the two would leave
-- the change without its record. `handle_new_user` already writes `role.changed`
-- from inside a trigger; this is that idiom for every other path.
--
-- IT IS IN THE TRANSACTION, WHICH MEANS NO RECORD, NO CHANGE. If the insert
-- fails the role change rolls back with it. That is the opposite of `lib/audit`,
-- which never throws because the thing it logs has already happened — here the
-- thing has NOT happened yet, and a privilege granted without a trace is the
-- exact failure this exists to prevent.

create or replace function public.record_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stated_via text;
  stated_actor uuid;
  session_actor uuid;
  final_actor uuid;
  final_role text;
begin
  /*
   * WHAT THE APPLICATION SAID, if anything. `set_profile_role` sets these two
   * as transaction-local settings immediately before its update, so they are
   * visible here and nowhere else. The third argument of `current_setting` is
   * `missing_ok`: without it an unset name raises rather than returning null,
   * and every direct update would fail.
   */
  stated_via := nullif(current_setting('app.role_change_via', true), '');
  stated_actor := nullif(current_setting('app.role_change_actor', true), '')::uuid;
  session_actor := auth.uid();

  /*
   * AND WHAT THE DATABASE CAN PROVE WHEN NOBODY SAID. `current_user` is no use
   * inside a `security definer` function — it is the owner, always — so the
   * caller's effective role comes from `current_setting('role')`, which is what
   * `set role` writes and what PostgREST sets per request. That is the
   * distinction that could not be made in September: `service-role` is our own
   * server, `direct-sql` is a dashboard, an MCP call or a psql session, and
   * `session` is somebody's browser. It names the route rather than guessing at
   * the intent, which is the only honest thing to record here.
   */
  final_actor := coalesce(stated_actor, session_actor);

  if stated_via is null then
    stated_via := case current_setting('role', true)
      when 'service_role' then 'service-role'
      when 'authenticated' then 'session'
      when 'anon' then 'session'
      else 'direct-sql'
    end;
  end if;

  -- `security_events_actor_role_check` allows five values and no others.
  if final_actor is null then
    final_role := 'system';
  else
    select case when p.role in ('customer', 'provider', 'admin') then p.role
                else 'system' end
      into final_role
      from public.profiles p
     where p.id = final_actor;

    final_role := coalesce(final_role, 'system');
  end if;

  insert into public.security_events
    (kind, actor_role, actor_id, subject_type, subject_id, detail)
  values (
    'role.changed',
    final_role,
    final_actor,
    'profile',
    new.id::text,
    jsonb_build_object('via', stated_via, 'from', old.role, 'to', new.role)
  );

  return new;
end;
$$;

revoke execute on function public.record_role_change() from public, anon, authenticated;

-- `is distinct from` rather than `<>`, and the WHEN clause rather than an `if`
-- in the body: seven db tests upsert fixtures with `on conflict do update set
-- role = excluded.role`, and a trigger that fired on those would fill the log
-- with changes that did not happen.
drop trigger if exists profiles_record_role_change on public.profiles;
create trigger profiles_record_role_change
  after update of role on public.profiles
  for each row
  when (old.role is distinct from new.role)
  execute function public.record_role_change();

-- --- the one funnel the application uses --------------------------------------
--
-- The trigger records every path. This is how a path SAYS which one it is: the
-- two settings are transaction-local (`set_config(..., true)`), so the trigger
-- reads them in the same transaction and nothing leaks into the next statement.
--
-- SECURITY INVOKER, DELIBERATELY. A `security definer` function that writes
-- `profiles.role` would be a new door of exactly the kind 20260927000005 closed
-- — anybody who could execute it could promote themselves. As invoker the
-- caller's own privileges apply, so `authenticated` is refused by the column
-- grant even if this execute grant were ever restored. The revoke below is the
-- outer lock; being an invoker is the one that cannot be unlocked by accident.
create or replace function public.set_profile_role(
  target uuid,
  new_role text,
  via text,
  actor uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform set_config('app.role_change_via', via, true);
  perform set_config('app.role_change_actor', coalesce(actor::text, ''), true);

  update public.profiles set role = new_role where id = target;
end;
$$;

-- Three roles, not one: Supabase grants execute to anon and authenticated
-- through a default privilege on `public`, so revoking from PUBLIC alone leaves
-- both in place and clears nothing.
revoke execute on function public.set_profile_role(uuid, text, text, uuid)
  from public, anon, authenticated;

-- --- the unused write surface on notifications --------------------------------
--
-- "People mark their own notifications read" granted UPDATE on all seven columns
-- of a person's own rows, and NOTHING in the product used it: `markBookingRead`
-- writes `read_at` under the service role precisely so the write cannot be
-- redirected by an id from a URL, and `lib/notify/in-app.ts` inserts the same
-- way. Own rows only, so no privilege crossed to anybody else — but a write
-- surface nothing needs is one nobody is watching, and the sweep in
-- `tests/db/write-grants.test.ts` is easier to read with one fewer entry on it.
drop policy if exists "People mark their own notifications read" on public.notifications;
