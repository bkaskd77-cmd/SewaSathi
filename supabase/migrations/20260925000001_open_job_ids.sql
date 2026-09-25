-- ---------------------------------------------------------------------------
-- The open-job board asks the database which jobs are its own.
--
-- WHAT WENT WRONG. `listOpenJobs` selected from `bookings` with two filters —
-- unassigned, still pending — and a comment saying "RLS does the whole
-- filter". It was true: "Providers see open jobs they can do" adds the trade
-- and the ward through `provider_can_serve`, and the trade and the ward are
-- the whole point, because an open job is a stranger's address.
--
-- But a Postgres policy is PERMISSIVE. "Admins read every booking" was added
-- later for the admin queues and ORs straight past that clause, so an admin
-- who is also a linked professional would have been shown every pending job in
-- the country, and the ward of each one resolved with the service role two
-- lines further down. The same shape as `listBookings` handing an admin
-- fourteen of somebody else's bookings; see `SECURITY.md`.
--
-- WHY A FUNCTION RATHER THAN A PREDICATE IN THE QUERY. The filter is
-- `provider_can_serve(category_slug, address_id)` — a function, not a column —
-- so there is no `.eq()` that restores it. Writing the trade-and-ward rule a
-- second time in TypeScript is the mistake `applyDispatch` exists to avoid:
-- two implementations of a rule diverge, and the divergence stays invisible
-- until somebody is shown a job three wards away. So the rule is written once,
-- here, and both the policy and the application call it.
--
-- COST. It is STABLE and takes no argument, so Postgres evaluates it once per
-- query as an InitPlan and hashes the result; the per-row test that replaces
-- the old inline predicate is then a hash probe. The scan inside it is over
-- open jobs only, which is a handful of rows by construction — a job stops
-- being open the moment somebody takes it.
-- ---------------------------------------------------------------------------

create or replace function public.open_job_ids()
returns table (id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id
    from public.bookings b
   where b.provider_id is null
     and b.status = 'pending'
     and b.opened_at is not null
     and public.provider_can_serve(b.category_slug, b.address_id)
     and not public.provider_refused(b.id);
$$;

-- Three roles, not one: Supabase grants `execute` to `anon` and
-- `authenticated` through a default privilege on `public`, so `revoke ... from
-- public` on its own clears neither. Same shape as 20260903000001.
revoke execute on function public.open_job_ids() from public, anon;
grant execute on function public.open_job_ids() to authenticated;

-- The SELECT policy now calls the one implementation instead of carrying its
-- own copy of the predicate. Behaviour is identical; what changes is that the
-- application can ask the same question.
drop policy if exists "Providers see open jobs they can do" on public.bookings;
create policy "Providers see open jobs they can do"
  on public.bookings for select to authenticated
  using (bookings.id in (select o.id from public.open_job_ids() o));

-- "Providers claim an open job" DELIBERATELY KEEPS ITS INLINE PREDICATE, and
-- this is the one place the duplication is correct. That policy is what makes
-- the claim a race exactly one person wins: its `using` clause matches only
-- rows that are STILL unassigned, and Postgres re-evaluates it against the
-- freshly locked row when two statements collide. A STABLE function in a
-- subquery is evaluated once at statement start and cached, so the re-check
-- would consult a snapshot taken before the other claimant committed — and two
-- professionals would be sent to one house. Per-row is the whole mechanism
-- there; the set is the wrong shape for it.
