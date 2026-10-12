-- ---------------------------------------------------------------------------
-- A rating that remembers when it was earned.
--
-- WHAT A FLAT MEAN GETS WRONG. `rating_avg` is `avg(rating)` over every
-- published review ever written, so a plumber who was excellent two years ago
-- and mediocre since reads the same as one who improved — and the customer
-- deciding who walks into their house is shown the average of two different
-- people. Quality is a fact about somebody NOW; a mean over all time is a fact
-- about their history.
--
-- IT COMPOSES WITH `bayesianRating` RATHER THAN REPLACING IT, because the two
-- answer different complaints. The prior handles a THIN sample — a 5.0 from
-- three friends. This handles a STALE one. A 5.0 from three reviews two years
-- ago is both, and the composition is what catches it: `rating_recent_weight`
-- is an EFFECTIVE count, not a row count, and it is what goes into the prior.
-- Feeding the prior the row count would leave twenty ancient reviews at full
-- confidence while their average drifted — the figure moves and the certainty
-- behind it does not, which is the worse half.
--
-- BOTH COLUMNS ARE NULLABLE AND NULL IS "NOT COMPUTED". Rule 6, and it bites on
-- day one: every row written before this migration is silent, and reading that
-- silence as "nobody has rated them" would be wrong for the one listing that
-- has a review. `hasRating` stays the gate and still reads `rating_count`.
--
-- ONE RULE WRITTEN TWICE, DELIBERATELY AND WITH A GUARD. Ranking needs this as
-- an aggregate over a catalogue, and the card needs it as a rule over one
-- listing's reviews; `recencyWeightedRating` in `lib/provider/recency.ts` is
-- the TypeScript half. `tests/db/rating-recency.test.ts` runs both over one set
-- of reviews and compares them — the arrangement `materialsRead` and
-- `enforce_claim_refund` already use, and the one that was missing when those
-- two last diverged.
--
-- THE FUNCTION IS REBUILT FROM THE TREE'S LAST DEFINITION
-- (`20260918000002_stats_pipeline.sql`), extracted rather than retyped. Reading
-- it back out of `pg_proc` is how `enforce_booking_immutability` lost three
-- guards for weeks; `pg_proc` is what you CHECK against, never what you copy
-- from.
--
-- REMOVES: refresh_provider_stats — one line, and nothing behind it. The insert's
--   column list read
--     `provider_id, rating_avg, rating_count, jobs_completed, completion_rate,`
--   and is now split across three lines to fit the two new columns. Every column
--   it named is still there, in the same order, and no guard, branch or default
--   changed. Declared rather than reworded to keep the check quiet, because a
--   reformatting that is invisible to the checker is exactly how a real removal
--   gets through the next time somebody reformats.
--
-- NOTHING DESTRUCTIVE: no statement here carries a `delete` token, so the
-- `update` inside the `on conflict` clause is safe over the agent's transport.
-- ---------------------------------------------------------------------------

alter table public.provider_stats
  add column if not exists rating_recent_avg numeric,
  add column if not exists rating_recent_weight numeric;

comment on column public.provider_stats.rating_recent_avg is
  'The published ratings weighted by age, halving every 365 days. Null is "not computed" and never "unrated" — rows written before this column exist are silent. See lib/provider/recency.ts, which implements the same rule for one listing.';
comment on column public.provider_stats.rating_recent_weight is
  'The summed weight behind rating_recent_avg: an EFFECTIVE count, not a row count. This is what bayesianRating is given, so an old sample loses confidence at the same rate its average drifts.';

create or replace function public.refresh_provider_stats(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rating_avg numeric := 0;
  v_rating_count integer := 0;
  -- The recency-weighted pair. Null until something has weight: see the header.
  v_rating_recent_total numeric := 0;
  v_rating_recent_weight numeric := 0;
  v_rating_recent_avg numeric := null;
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

  /*
   * AND THE SAME ROWS WEIGHTED BY AGE. `recencyWeightedRating` in
   * `lib/provider/recency.ts` is the same rule in TypeScript; one fixture in
   * `tests/db/rating-recency.test.ts` runs both over one set of reviews and
   * compares them, which is the arrangement `materialsRead` and
   * `enforce_claim_refund` use and the one that was missing when those two last
   * diverged.
   *
   * `greatest(0, …)` mirrors the clamp there: a row stamped in the future must
   * not be worth MORE than one written today, which would be a way to buy a
   * rating with a wrong timestamp.
   *
   * 365.0 is RATING_HALF_LIFE_DAYS, written twice because ranking needs this as
   * an aggregate and the card needs it as a rule. The fixture is what keeps the
   * two in step.
   */
  select coalesce(sum(r.rating * w.weight), 0), coalesce(sum(w.weight), 0)
    into v_rating_recent_total, v_rating_recent_weight
    from public.provider_reviews r
    cross join lateral (
      select power(
        0.5,
        greatest(0, extract(epoch from (now() - r.published_at)) / 86400.0) / 365.0
      ) as weight
    ) w
   where r.provider_id = p_provider_id
     and r.published_at is not null
     and r.excluded_from_average_at is null;

  -- NULL AND NEVER ZERO when no weight is left. Rule 6: reviews so old that
  -- every weight has underflowed are not evidence of a bad rating, and 0 would
  -- render as the worst score a professional can have.
  if v_rating_recent_weight > 0 then
    v_rating_recent_avg := round(v_rating_recent_total / v_rating_recent_weight, 4);
  end if;

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
    provider_id, rating_avg, rating_count,
    rating_recent_avg, rating_recent_weight,
    jobs_completed, completion_rate,
    avg_response_minutes, response_samples, jobs_accepted, withdrawals,
    declines, overbook_offers, overbook_misses, offers_made, offers_answered,
    updated_at
  )
  values (
    p_provider_id,
    round(v_rating_avg, 1),
    v_rating_count,
    v_rating_recent_avg,
    round(v_rating_recent_weight, 4),
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
        rating_recent_avg = excluded.rating_recent_avg,
        rating_recent_weight = excluded.rating_recent_weight,
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
