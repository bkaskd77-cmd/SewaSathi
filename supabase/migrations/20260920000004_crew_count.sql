-- `max_concurrent_jobs` was two different facts wearing one name.
--
-- FACT ONE: "do not block a painter from a second job while the first one
-- dries." That was never concurrency, it was DURATION, and every category
-- value above 1 existed for it — painting 3, electrical 3, plumbing 2. The
-- interval scheduler models it properly now: a job holds its own length and a
-- multi-day one holds a site, so a painter is bookable on Tuesday afternoon
-- without anybody having to fake it with a cap of 3. That half retires.
--
-- FACT TWO: "one man with a pickup does one move a day; a verified firm with
-- three trucks does three." That is CREW SIZE, and duration says nothing about
-- it. A four-hour move is four hours whether you have one van or three; what
-- changes is how many can run at once. That half survives, and it is the only
-- thing this number ever legitimately meant.
--
-- So the category column goes and the provider column is renamed to what it
-- always was. THE RENAME IS THE POINT: a column called `max_concurrent_jobs`
-- invites the next reader to set it to 3 because a painter is idle on
-- Wednesday, and that is now exactly wrong — the scheduler already knows.
--
-- Leaving the category column pinned at 1 was the alternative and is worse: a
-- constant nobody may change is a trap, and it would keep suggesting that
-- concurrency is a property of a trade.

alter table public.providers
  rename column max_concurrent_jobs to crew_count;

comment on column public.providers.crew_count is
  'How many jobs this listing can genuinely run at once — a firm with three trucks, three. ADMIN-SET AT ONBOARDING FROM VERIFIED CREW SIZE, NEVER SELF-SET: a professional setting their own would make every listing say 10. Null means one. It is NOT a way to be available while a job dries — the scheduler knows how long jobs take now, which is why this is no longer called max_concurrent_jobs.';

alter table public.categories
  drop column if exists max_concurrent_jobs;

-- ---------------------------------------------------------------------------
-- The cap, with the trade's opinion removed
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
      -- Null means one. A listing nobody has verified a crew for is one
      -- person, which is also what every listing is until an admin says
      -- otherwise.
      coalesce(p.crew_count, 1),
      -- PROBATION ALWAYS CAPS, whatever the override says. A new listing has
      -- not shown it can hold two jobs, let alone a firm's three. Mirrors
      -- PROBATION.maxCrew in lib/verification/probation.ts.
      case when p.standing = 'provisional' then 2 else 10 end
    )
  ) + case when p_overbook_offered then 1 else 0 end
  from public.providers p
  where p.id = p_provider_id;
$$;

comment on function public.booking_slot_capacity(uuid, text, boolean) is
  'How many jobs one listing may hold in one overlapping window: their verified crew size, capped by probation, plus one if they explicitly offered to fit somebody in. The category no longer has an opinion — what it used to express was job length, which the scheduler now models directly.';

revoke execute on function public.booking_slot_capacity(uuid, text, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- p_category_slug is kept, deliberately
-- ---------------------------------------------------------------------------
--
-- It is unused now. Dropping it would mean dropping and recreating the
-- function, which means `enforce_slot_capacity` has to be rewritten to match —
-- and rewriting that function is precisely the operation that has taken a
-- version nobody intended three times, most recently losing the advisory lock.
-- An unused parameter costs a line of explanation; a fourth rewrite costs a
-- guard. `tests/db/guard-clauses.test.ts` would catch it, which is the reason
-- that file exists, and it is still not a trade worth making today.
