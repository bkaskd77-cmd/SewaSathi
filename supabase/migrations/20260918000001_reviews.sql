-- A review that hangs off a finished job, and a record about a customer that
-- is neither prose nor a score.
--
-- WHAT THIS REPLACES. `provider_reviews` was free text with an author's name
-- typed into it — 94 rows of fiction, unattached to any booking, writable by
-- nobody and therefore true of nobody. Its own comment said so: "Free text
-- until Phase 6 gives reviews a booking to hang off. Then this becomes a
-- foreign key and a review requires a finished job." This is that.

-- ---------------------------------------------------------------------------
-- The customer's review
-- ---------------------------------------------------------------------------

alter table public.provider_reviews
  add column if not exists booking_id uuid unique
    references public.bookings (id) on delete cascade,
  add column if not exists customer_id uuid
    references public.profiles (id) on delete set null,
  add column if not exists submitted_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists window_closes_at timestamptz,

  -- The reply. One, capped, and never editable once written.
  add column if not exists reply_text text
    check (reply_text is null or char_length(reply_text) between 2 and 600),
  add column if not exists replied_at timestamptz,

  -- Removed from the AVERAGE, never from the page, and only by a person.
  add column if not exists excluded_from_average_at timestamptz,
  add column if not exists excluded_by uuid
    references public.profiles (id) on delete set null,
  add column if not exists excluded_reason text
    check (excluded_reason is null or char_length(excluded_reason) <= 600);

comment on column public.provider_reviews.excluded_from_average_at is
  'Set when a person found the customer caused the job to go wrong. The review STAYS ON THE PAGE — a rating average is evidence and must not be moved by an account a process contradicted, while a review page is testimony and must not lose anything.';
comment on column public.provider_reviews.published_at is
  'When the sealed window ended. Both sides publish together, or whatever is in publishes when the window closes — withholding a review because the other side stayed silent would punish somebody for another person''s silence.';

-- An exclusion nobody decided is the automatic suppression this column exists
-- to prevent, wearing a timestamp.
alter table public.provider_reviews
  drop constraint if exists provider_reviews_exclusion_needs_a_person;
alter table public.provider_reviews
  add constraint provider_reviews_exclusion_needs_a_person check (
    (excluded_from_average_at is null) = (excluded_by is null)
  );

-- A reply with no time on it, or a time with no reply, is half a record.
alter table public.provider_reviews
  drop constraint if exists provider_reviews_reply_is_a_pair;
alter table public.provider_reviews
  add constraint provider_reviews_reply_is_a_pair check (
    (reply_text is null) = (replied_at is null)
  );

create index if not exists provider_reviews_published_idx
  on public.provider_reviews (provider_id, published_at desc)
  where published_at is not null;
create index if not exists provider_reviews_sealed_idx
  on public.provider_reviews (window_closes_at)
  where published_at is null;

-- ---------------------------------------------------------------------------
-- What the professional records about the visit
-- ---------------------------------------------------------------------------
--
-- NO PROSE AND NO SCORE. A number about a private individual, held
-- indefinitely and never shown to them, is prose with fewer characters — it
-- cannot be checked, answered or explained. And prose is not signal anyway:
-- "difficult" cannot be counted, compared across professionals or aggregated,
-- so it could not support the human review it exists to inform.
--
-- EVERY FLAG IS AN OBSERVABLE FACT ABOUT THE VISIT, and none of them can
-- express a price disagreement. That is deliberate and permanent: a customer
-- declining a surveyed quote or refusing an over-band final amount is
-- exercising a right this product gives them, and charging under the band is
-- already published as never-a-signal.

create table if not exists public.customer_visit_flags (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,

  flag text not null check (flag in (
    'not_at_address',
    'address_unusable',
    'could_not_access',
    'job_not_as_described',
    'unsafe_site',
    'asked_off_platform',
    'abusive'
  )),

  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  -- ONE INCIDENT, ONE FLAG. Without this the same visit could be recorded
  -- twice and the count would be of records rather than of things that
  -- happened.
  unique (booking_id, flag)
);

comment on table public.customer_visit_flags is
  'Structured facts a professional recorded about one visit. Never public, never shown to the customer as a score, and never a number: `customer_risk` counts DISTINCT BOOKINGS across every path, so one incident counts once however many ways it was recorded.';

create index if not exists customer_visit_flags_customer_idx
  on public.customer_visit_flags (customer_id, submitted_at desc);

alter table public.customer_visit_flags enable row level security;

drop policy if exists "Providers read their own visit flags" on public.customer_visit_flags;
create policy "Providers read their own visit flags"
  on public.customer_visit_flags for select to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.id = customer_visit_flags.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every visit flag" on public.customer_visit_flags;
create policy "Admins read every visit flag"
  on public.customer_visit_flags for select to authenticated
  using (public.is_admin());

-- THE CUSTOMER DELIBERATELY CANNOT READ THESE, and that is the uncomfortable
-- half of the design rather than an oversight. A record somebody can read is a
-- record they will argue with on the spot with the professional who wrote it,
-- which is the retaliation channel this whole shape exists to close. What
-- protects them instead is that it decides nothing on its own: no read path
-- lets this change dispatch, ranking or whether a booking succeeds, every human
-- read is logged, and it ages out.
--
-- No insert or update policy for anybody: rows are written by lib/data under
-- the service role, after the double-blind rule has been applied.

-- ---------------------------------------------------------------------------
-- One incident counts once, and it ages out
-- ---------------------------------------------------------------------------
--
-- `customer_risk.no_shows` was INCREMENTED, which is the same defect
-- `provider_stats` had: a counter cannot be reconciled, and once a second path
-- writes to it the same visit is counted twice. A professional ticking
-- `not_at_address` and then filing a no-show claim for the same booking is
-- exactly that path.
--
-- So the counters are RECOMPUTED FROM SOURCE, over distinct bookings, inside a
-- window. Decay stops being decorative because there is nothing to decay —
-- the number simply stops including what is old.

create or replace function public.refresh_customer_risk(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Mirrors RETENTION.customerFlagMonths. A year covers repeat customers and
  -- seasonal patterns; older than that is a liability we hold about a private
  -- individual and is weak evidence anyway.
  horizon interval := interval '12 months';
  since timestamptz := now() - horizon;
begin
  insert into public.customer_risk (profile_id, no_shows, false_addresses, completed_jobs)
  values (
    p_profile_id,
    (
      -- DISTINCT BOOKINGS across both paths. A ticked flag and an upheld claim
      -- for the same visit are one no-show, not two.
      select count(distinct b.id)
      from public.bookings b
      where b.customer_id = p_profile_id
        and b.created_at >= since
        and (
          exists (
            select 1 from public.customer_visit_flags f
            where f.booking_id = b.id and f.flag = 'not_at_address'
          )
          or exists (
            select 1 from public.no_show_claims c
            where c.booking_id = b.id and c.status = 'upheld'
          )
        )
    ),
    (
      select count(distinct b.id)
      from public.bookings b
      where b.customer_id = p_profile_id
        and b.created_at >= since
        and exists (
          select 1 from public.customer_visit_flags f
          where f.booking_id = b.id and f.flag = 'address_unusable'
        )
    ),
    (
      -- Completed jobs retire strikes, which is what stops the ladder being a
      -- ratchet. Counted over the same window so both sides age together —
      -- ageing out the strikes but not the credit would quietly harden it.
      select count(*)
      from public.bookings b
      where b.customer_id = p_profile_id
        and b.created_at >= since
        and b.status = 'completed'
    )
  )
  on conflict (profile_id) do update
    set no_shows = excluded.no_shows,
        false_addresses = excluded.false_addresses,
        completed_jobs = excluded.completed_jobs,
        updated_at = now();
end;
$$;

revoke execute on function public.refresh_customer_risk(uuid)
  from public, anon, authenticated;

comment on function public.refresh_customer_risk(uuid) is
  'Recomputes a customer''s counters from source over a 12-month window. Counts DISTINCT BOOKINGS, so a visit flagged by the professional AND claimed formally is one incident. Never increments: an incremented counter cannot be reconciled, and a second write path silently doubles it.';

create or replace function public.sync_customer_risk_from_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.refresh_customer_risk(
    coalesce(new.customer_id, old.customer_id)
  );
  return null;
end;
$$;

revoke execute on function public.sync_customer_risk_from_flag()
  from public, anon, authenticated;

drop trigger if exists customer_visit_flags_sync_risk on public.customer_visit_flags;
create trigger customer_visit_flags_sync_risk
  after insert or delete on public.customer_visit_flags
  for each row execute function public.sync_customer_risk_from_flag();
