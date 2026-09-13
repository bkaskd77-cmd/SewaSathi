-- ---------------------------------------------------------------------------
-- Availability the system can verify, and a customer who is no longer stuck
-- waiting on somebody who is not answering.
--
-- WHAT WAS WRONG. A professional had one switch: "available now", expiring at
-- the end of the working day. It could not say the thing that is true for much
-- of a working day — that they are on one of OUR jobs right now — even though
-- the booking status says so in plain text. So somebody could be listed
-- "available now" while `en_route` to a customer's house, and availability
-- carries 0.40 in an emergency search, the largest single term in that blend.
-- The person least able to come ranked as the most able, and the customer who
-- paid for that was the one with a burst pipe at 2am.
--
-- THREE FACTS DECIDE THE STATE AND ONLY TWO ARE THE PROFESSIONAL'S:
--
--   * `on_job_since`  — ours, written by a trigger. Not settable, not
--                       overridable. It is the one of the three we can verify.
--   * `busy_until`    — theirs, carrying an end time.
--   * `available_until` — theirs, expiring at the end of the day.
--
-- The precedence lives in `providerState` in lib/provider/availability.ts and
-- the order is the whole design: the verified fact beats both declarations.
--
-- BEING BUSY COSTS NOTHING. `/providers/standards` publishes, in both
-- languages, on a page linked before anybody signs up: "Turning work down. You
-- are allowed to be busy." Nothing in this migration counts, ranks or remembers
-- a busy window against anybody, and nothing added later should either.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- What a professional declares
-- ---------------------------------------------------------------------------

/**
 * "Not today", with an end on it.
 *
 * The window is computed server-side from a preset, never posted by a browser:
 * a professional who could name their own expiry could name one in 2035, and
 * busy would become exactly the flag that never decays that `available_until`
 * was designed not to be.
 */
alter table public.providers
  add column if not exists busy_until timestamptz;

comment on column public.providers.busy_until is
  'Self-declared unavailability with an end. Expired by the clock, never swept. Never counted against anybody — see /providers/standards.';

-- ---------------------------------------------------------------------------
-- What the system knows
-- ---------------------------------------------------------------------------

/**
 * Set while a booking of theirs is `en_route` or `in_progress`.
 *
 * NOT `accepted`. Somebody can accept a job for Thursday and still be free
 * this afternoon; treating an acceptance as "on a job" would hide half the
 * platform from every customer who wanted somebody today.
 *
 * A COLUMN RATHER THAN A JOIN, because the catalogue is read by the cookie-free
 * anon client and `bookings` is not readable by `anon` — correctly. A
 * denormalised column keeps the public read on one table and exposes nothing
 * about anybody's job. It is the same shape as the `provider_stats` counters.
 */
alter table public.providers
  add column if not exists on_job_since timestamptz;

comment on column public.providers.on_job_since is
  'System-maintained: set while a booking of theirs is en_route or in_progress. A professional cannot write it, and it overrides both of their own stamps.';

-- The recount below reads by provider and status; today there is only
-- (provider_id, created_at desc), which cannot serve it.
create index if not exists bookings_provider_status_idx
  on public.bookings (provider_id, status);

/**
 * Recompute one professional's on-a-job stamp from their bookings.
 *
 * A RECOUNT, NOT A COUNTER. An established professional may hold several live
 * jobs at once (`PROBATION.maxConcurrentJobs` caps only provisional ones), so
 * "finished one" does not mean "free" — a counter would have to be decremented
 * correctly on every path including the ones nobody has written yet, and one
 * missed decrement leaves somebody invisible for ever. Asking the question is
 * cheap with the index above and cannot drift.
 *
 * `coalesce(on_job_since, now())` keeps the ORIGINAL stamp while they remain
 * busy, so the column means "since they started working", not "since the most
 * recent status change".
 */
create or replace function public.recount_provider_on_job(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if target is null then
    return;
  end if;

  update public.providers p
     set on_job_since = case
       when exists (
         select 1 from public.bookings b
          where b.provider_id = target
            and b.status in ('en_route', 'in_progress')
       ) then coalesce(p.on_job_since, now())
       else null
     end
   where p.id = target;
end;
$$;

revoke execute on function public.recount_provider_on_job(uuid)
  from public, anon, authenticated;

/**
 * Both sides of a change, because a job can move between people.
 *
 * When `provider_id` changes, the professional who LOST the job may now be
 * free and the one who gained it may now be busy. Recomputing only the new one
 * would leave the old one marked as working on a job they no longer have.
 */
create or replace function public.sync_provider_on_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.recount_provider_on_job(new.provider_id);
    return null;
  end if;

  if new.status is distinct from old.status
     or new.provider_id is distinct from old.provider_id then
    perform public.recount_provider_on_job(old.provider_id);
    perform public.recount_provider_on_job(new.provider_id);
  end if;

  return null;
end;
$$;

revoke execute on function public.sync_provider_on_job() from public;

drop trigger if exists bookings_sync_provider_on_job on public.bookings;
create trigger bookings_sync_provider_on_job
  after insert or update on public.bookings
  for each row execute function public.sync_provider_on_job();

-- Backfill, so the column is true for work already in flight rather than only
-- for whatever moves next.
update public.providers p
   set on_job_since = now()
 where p.on_job_since is null
   and exists (
     select 1 from public.bookings b
      where b.provider_id = p.id
        and b.status in ('en_route', 'in_progress')
   );

-- ---------------------------------------------------------------------------
-- The customer stops waiting on silence
-- ---------------------------------------------------------------------------
--
-- A professional who simply ignores the notification produced NOTHING on the
-- customer's screen. The job held with them for the first-refusal window, and
-- the replacement chooser only appears when somebody actively refuses — so
-- silence looked exactly like progress. A customer watching a job sit quiet
-- for an hour is a customer opening another app.

/**
 * When the customer chose to stop waiting and open the job to everybody.
 *
 * A SEPARATE STAMP RATHER THAN A CANCELLATION OR A REFUSAL, and the reason is
 * the trap below.
 */
alter table public.bookings
  add column if not exists widened_by_customer_at timestamptz;

comment on column public.bookings.widened_by_customer_at is
  'The customer stopped waiting and opened the job to everybody. Not a refusal by the professional: nothing is counted against them and they may still claim it.';

/**
 * The trap, and the one line that closes it.
 *
 * Clearing `provider_id` on a pending booking is how a DECLINE is detected —
 * `record_provider_release` reads exactly that and writes `declines + 1` plus a
 * `booking_refusals` row. Both would be wrong here:
 *
 *   * the counter would mark somebody as having turned work down when they did
 *     nothing at all, which contradicts a published promise; and
 *   * the refusal row would make `provider_refused` hide the job from them for
 *     ever, so a professional who picked up their phone thirty seconds later
 *     could not take the job they had been offered.
 *
 * So a release carrying a fresh `widened_by_customer_at` is not a refusal and
 * is recorded as nothing. The job is simply open.
 */
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

  if new.status = 'pending' and old.status in ('accepted', 'en_route') then
    refusal := 'withdrawn';
  elsif new.status = 'pending' and old.status = 'pending' then
    refusal := 'declined';
  else
    -- Any other way of losing a professional is not a refusal: a cancellation
    -- is the customer's, and a completed job keeps its provider.
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

-- ---------------------------------------------------------------------------
-- The seeded listings stop claiming to be free
-- ---------------------------------------------------------------------------
--
-- Seed rows carry a stored `availability = 'now'` with no stamp, so nothing
-- ever expires them: filtering for "available now" returned a list of
-- fixtures. Now that a real professional can be marked as on a job, leaving
-- this would mean demo rows outranking people. `now` becomes the stamp's to
-- grant and time's to take away, for everybody.
update public.providers
   set availability = 'today'
 where availability = 'now'
   and available_until is null;

-- ---------------------------------------------------------------------------
-- An unmeasured response time is not a slow one
-- ---------------------------------------------------------------------------
--
-- `provider_stats.avg_response_minutes` defaults to 120, which is exactly the
-- ceiling the ranking scores against — so a professional nobody has ever timed
-- was indistinguishable from one measured at two hours, and scored zero on that
-- axis for ever. Nothing computes the column from real bookings yet (Phase 12),
-- so EVERY real approved professional forfeited the whole 0.25 of the emergency
-- blend while the seeded fixtures at 12 minutes kept 0.90. Real people ranked
-- below demo rows, and no screen said so.
--
-- A count, not a nullable average: the ranking needs to know "has anybody timed
-- this?", and Phase 12 needs somewhere to record how many samples the average
-- is made of. One column answers both.

alter table public.provider_stats
  add column if not exists response_samples integer not null default 0
    check (response_samples >= 0);

comment on column public.provider_stats.response_samples is
  'How many replies the average is made of. Zero means unmeasured, which scores neutral rather than slow — see UNMEASURED_RESPONSE in lib/data/ranking.ts.';

-- The seeded fixtures carry authored response times, so they keep them: the
-- demo listings are meant to look like established professionals. Real rows
-- approved through onboarding have never been timed and stay at zero.
update public.provider_stats s
   set response_samples = greatest(s.rating_count, 1)
  from public.providers p
 where p.id = s.provider_id
   and p.application_id is null
   and s.response_samples = 0
   and s.jobs_completed > 0;
