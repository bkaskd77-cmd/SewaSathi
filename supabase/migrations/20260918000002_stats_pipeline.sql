-- `provider_stats`, computed from what happened instead of authored.
--
-- WHAT IT WAS. Every figure a customer reads to decide who walks into their
-- house was written by hand: 4.8s, 12-minute response times, 96% completion,
-- for people who have never done a job. Worse, the columns that WERE
-- maintained were INCREMENTED — and an incremented counter cannot be
-- reconciled. Once one drifts there is no way to tell by looking, and the day
-- a second path writes to it the same event is counted twice. That is not
-- hypothetical: `customer_risk.no_shows` had exactly that shape and the
-- previous migration had to unpick it.
--
-- SO EVERYTHING HERE IS RECOMPUTED FROM SOURCE. One function, called by
-- triggers on the events that change it. Recomputing is also what makes rule 6
-- honest: each figure and its denominator come out of the same query, so a
-- stat and the evidence behind it cannot disagree.

-- ---------------------------------------------------------------------------
-- The denominator that was missing
-- ---------------------------------------------------------------------------
--
-- "Saying you are available and then not answering" is named in the standards
-- as the one thing we DO measure about availability, and nothing measured it.
-- It needs a denominator like every other rate here.

alter table public.provider_stats
  add column if not exists offers_made integer not null default 0
    check (offers_made >= 0),
  add column if not exists offers_answered integer not null default 0
    check (offers_answered >= 0);

comment on column public.provider_stats.offers_made is
  'Jobs where this professional was the customer''s FIRST CHOICE — the only offers we can say they were definitely shown. An open job broadcast to everybody is not an offer to anybody in particular, and counting it would make a busy week look like ignoring people.';
comment on column public.provider_stats.offers_answered is
  'First-choice offers they accepted or declined before the hold lapsed. Answering NO counts as answering: the standards publish turning work down as never-a-signal, and a rate that punished a decline would make that a lie.';

-- ---------------------------------------------------------------------------
-- One function, every column
-- ---------------------------------------------------------------------------

create or replace function public.refresh_provider_stats(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rating_avg numeric := 0;
  v_rating_count integer := 0;
  v_completed integer := 0;
  v_accepted integer := 0;
  v_completion integer := 100;
  v_response_total numeric := 0;
  v_response_samples integer := 0;
  v_offers integer := 0;
  v_answered integer := 0;
  v_withdrawals integer := 0;
  v_declines integer := 0;
  v_overbook_offers integer := 0;
  v_overbook_misses integer := 0;
begin
  -- Published reviews only, and only the ones a person has not excluded. An
  -- exclusion moves a review out of the AVERAGE and never off the page.
  select coalesce(avg(r.rating), 0), count(*)
    into v_rating_avg, v_rating_count
    from public.provider_reviews r
   where r.provider_id = p_provider_id
     and r.published_at is not null
     and r.excluded_from_average_at is null;

  select count(*) filter (where b.status = 'completed'),
         count(*) filter (where b.accepted_at is not null)
    into v_completed, v_accepted
    from public.bookings b
   where b.provider_id = p_provider_id;

  /*
   * DISPATCH TO ACCEPT, and only on jobs they actually took.
   *
   * The clock starts when the job became theirs to answer: `reassigned_at`
   * when a customer re-picked them, `opened_at` once it went to everybody,
   * otherwise the booking itself. Measuring from `created_at` on a job that
   * sat with somebody else first would charge them for another person's
   * silence.
   */
  select coalesce(sum(
           extract(epoch from (
             b.accepted_at - coalesce(b.reassigned_at, b.opened_at, b.created_at)
           )) / 60
         ), 0),
         count(*)
    into v_response_total, v_response_samples
    from public.bookings b
   where b.provider_id = p_provider_id
     and b.accepted_at is not null
     and b.accepted_at > coalesce(b.reassigned_at, b.opened_at, b.created_at);

  -- First-choice offers, and whether they answered at all.
  select count(*),
         count(*) filter (
           where b.accepted_at is not null
              or exists (
                select 1 from public.booking_refusals f
                 where f.booking_id = b.id and f.provider_id = p_provider_id
              )
         )
    into v_offers, v_answered
    from public.bookings b
   where b.first_choice_provider_id = p_provider_id;

  -- Refusals by kind, counted from the rows rather than kept alongside them.
  select count(*) filter (where f.kind = 'withdrawn'),
         count(*) filter (where f.kind = 'declined')
    into v_withdrawals, v_declines
    from public.booking_refusals f
   where f.provider_id = p_provider_id;

  select count(*) filter (where b.overbook_offered_by = p_provider_id),
         count(*) filter (
           where b.overbook_offered_by = p_provider_id
             and b.overbook_missed_at is not null
         )
    into v_overbook_offers, v_overbook_misses
    from public.bookings b
   where b.overbook_offered_by = p_provider_id;

  /*
   * COMPLETION FALLS BACK TO THE COLUMN DEFAULT ONLY WHEN THERE IS NO
   * DENOMINATOR, and `jobs_accepted = 0` is what tells every reader that.
   * `completion_rate` defaults to 100, so a listing nobody has measured would
   * otherwise score a perfect record — `hasCompletion` is the gate and this
   * keeps the two consistent rather than inventing a second answer here.
   */
  if v_accepted > 0 then
    v_completion := round(v_completed::numeric / v_accepted * 100);
  end if;

  insert into public.provider_stats (
    provider_id, rating_avg, rating_count, jobs_completed, completion_rate,
    avg_response_minutes, response_samples, jobs_accepted, withdrawals,
    declines, overbook_offers, overbook_misses, offers_made, offers_answered,
    updated_at
  )
  values (
    p_provider_id,
    round(v_rating_avg, 1),
    v_rating_count,
    v_completed,
    v_completion,
    -- 120 is the column default and the scoring ceiling. It is NOT a
    -- measurement and `response_samples = 0` beside it is what says so.
    case when v_response_samples > 0
         then greatest(1, round(v_response_total / v_response_samples))
         else 120 end,
    v_response_samples,
    v_accepted,
    v_withdrawals,
    v_declines,
    v_overbook_offers,
    v_overbook_misses,
    v_offers,
    v_answered,
    now()
  )
  on conflict (provider_id) do update
    set rating_avg = excluded.rating_avg,
        rating_count = excluded.rating_count,
        jobs_completed = excluded.jobs_completed,
        completion_rate = excluded.completion_rate,
        avg_response_minutes = excluded.avg_response_minutes,
        response_samples = excluded.response_samples,
        jobs_accepted = excluded.jobs_accepted,
        withdrawals = excluded.withdrawals,
        declines = excluded.declines,
        overbook_offers = excluded.overbook_offers,
        overbook_misses = excluded.overbook_misses,
        offers_made = excluded.offers_made,
        offers_answered = excluded.offers_answered,
        updated_at = now();
end;
$$;

revoke execute on function public.refresh_provider_stats(uuid)
  from public, anon, authenticated;

comment on function public.refresh_provider_stats(uuid) is
  'Recomputes every provider_stats column from source. Never increments: an incremented counter cannot be reconciled, and a second write path silently doubles it. Running it twice gives the same answer, which is the property an increment cannot have.';

-- ---------------------------------------------------------------------------
-- What calls it
-- ---------------------------------------------------------------------------

create or replace function public.sync_provider_stats_from_booking()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider_id is not null then
    perform public.refresh_provider_stats(new.provider_id);
  end if;
  -- A release changes the OLD holder's numbers, not the new one's.
  if tg_op = 'UPDATE'
     and old.provider_id is not null
     and old.provider_id is distinct from new.provider_id then
    perform public.refresh_provider_stats(old.provider_id);
  end if;
  if new.first_choice_provider_id is not null
     and new.first_choice_provider_id is distinct from new.provider_id then
    perform public.refresh_provider_stats(new.first_choice_provider_id);
  end if;
  return null;
end;
$$;

revoke execute on function public.sync_provider_stats_from_booking()
  from public, anon, authenticated;

drop trigger if exists bookings_sync_provider_stats on public.bookings;
create trigger bookings_sync_provider_stats
  after insert or update on public.bookings
  for each row execute function public.sync_provider_stats_from_booking();

create or replace function public.sync_provider_stats_from_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_provider_stats(
    coalesce(new.provider_id, old.provider_id)
  );
  return null;
end;
$$;

revoke execute on function public.sync_provider_stats_from_review()
  from public, anon, authenticated;

drop trigger if exists provider_reviews_sync_stats on public.provider_reviews;
create trigger provider_reviews_sync_stats
  after insert or update or delete on public.provider_reviews
  for each row execute function public.sync_provider_stats_from_review();

-- ---------------------------------------------------------------------------
-- The fiction goes
-- ---------------------------------------------------------------------------
--
-- 94 authored reviews and every hand-written stat. NOT recomputed around: a
-- fixture that survives the pipeline is a fixture the pipeline is lying about,
-- and these are the exact rows `LAUNCH-BLOCKERS.md` calls the most serious
-- entry in the file.

delete from public.provider_reviews where booking_id is null;

do $$
declare
  p record;
begin
  for p in select id from public.providers loop
    perform public.refresh_provider_stats(p.id);
  end loop;
end;
$$;
