-- What we owe a surveyor when the move does not go ahead — and why none of it
-- pays itself.
--
-- THE FEE WAS A POLICY WITH NO MECHANISM. `surveyVisitFeeNpr` and
-- `surveyVisitFeeMonthlyCap` were constants nothing read, and
-- `surveyOutcome().payVisitFee` returned a boolean no caller acted on. The cap
-- was a number in a comment, which is not a cap.
--
-- AND A FEE WITH AN AUTOMATIC PAYOFF IS FARMABLE. Quote absurdly high, get
-- declined, collect — four trips a month for Rs 2,000. The economics already
-- make that a bad trade (a Valley survey is two to three hours door to door, so
-- the fee is about Rs 200/hour, while ONE accepted move leaves the professional
-- more than six months of the cap) but "a bad trade" is not a guard, and the
-- person with an empty day is exactly who it fails against.
--
-- SO THE DEFAULT IS NOT PAID. Every row here is born `pending` and moves only
-- when a person decides — the same shape `commission_appeals` and the guarantee
-- refund already use, and for the same reason: money that turns on a judgement
-- does not move without somebody making it. A payoff you have to persuade a
-- human for, four times a month, is not a farm.

create table if not exists public.survey_visit_fees (
  id uuid primary key default gen_random_uuid(),

  -- One per booking. A survey that was declined twice is not two trips.
  booking_id uuid not null unique
    references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,

  /** `declined` or `expired` — what the customer did, or did not do. */
  outcome text not null check (outcome in ('declined', 'expired')),

  /**
   * Rupees, frozen at the moment the row is written.
   *
   * Frozen for the same reason `commission_bps` is frozen onto a booking: a
   * later change to what we pay must not rewrite what somebody was already
   * owed. `surveyVisitFeeNpr` is the source and this is the record.
   */
  amount integer not null check (amount > 0),

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 600),

  /**
   * The month this fee counts against, as the first of that month.
   *
   * Stored rather than derived so the cap below can be a plain unique-ish
   * constraint rather than an expression nobody can read. Set from
   * `created_at` by the trigger.
   */
  counts_for_month date not null,

  created_at timestamptz not null default now()
);

comment on table public.survey_visit_fees is
  'What we owe a surveyor when the customer declined or let the quote lapse. Born `pending` and paid only when a person approves it — the default is NOT PAID, which is what stops the fee being farmed. Never a charge to the customer: the survey is free, and "free" has to mean free.';

create index if not exists survey_visit_fees_pending_idx
  on public.survey_visit_fees (status, created_at)
  where status = 'pending';
create index if not exists survey_visit_fees_provider_month_idx
  on public.survey_visit_fees (provider_id, counts_for_month);

-- ---------------------------------------------------------------------------
-- Guard: no trip, no fee
-- ---------------------------------------------------------------------------
--
-- The cheapest strong guard, and it reuses machinery that already exists.
-- `booking_arrivals` is written when a professional records turning up, for the
-- wasted-trip flow. A fee is reimbursement for a journey, so without a recorded
-- journey there is nothing to reimburse — and quoting high from the sofa stops
-- being a route at all. Travelling there first is most of the cost the fee
-- exists to cover, which is the whole point.

create or replace function public.enforce_survey_visit_fee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  trips integer;
  approved integer;
  cap integer := 4; -- Mirrors PAYOUT_RULES.surveyVisitFeeMonthlyCap.
begin
  if tg_op = 'INSERT' then
    new.counts_for_month := date_trunc('month', coalesce(new.created_at, now()))::date;

    select count(*) into trips
    from public.booking_arrivals a
    where a.booking_id = new.booking_id
      and a.provider_id = new.provider_id;

    if trips = 0 then
      raise exception 'No arrival was recorded for this survey'
        using errcode = 'check_violation';
    end if;
  end if;

  /*
   * THE CAP IS A DATABASE RULE NOW, and it counts APPROVED fees only. Counting
   * pending ones would let a run of honest declines block a real claim while
   * somebody waits for a person to look — which would punish the surveyor for
   * our queue.
   */
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    select count(*) into approved
    from public.survey_visit_fees f
    where f.provider_id = new.provider_id
      and f.counts_for_month = new.counts_for_month
      and f.status = 'approved'
      and f.id <> new.id;

    if approved >= cap then
      raise exception 'That is more survey visits than we pay for in one month'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A decision is somebody's. An approved row with nobody's name on it is the
  -- automatic payout this table exists to prevent, wearing a status.
  if new.status <> 'pending' and new.decided_by is null then
    raise exception 'A survey fee decision needs a person'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_survey_visit_fee()
  from public, anon, authenticated;

drop trigger if exists survey_visit_fees_enforce on public.survey_visit_fees;
create trigger survey_visit_fees_enforce
  before insert or update on public.survey_visit_fees
  for each row execute function public.enforce_survey_visit_fee();

-- ---------------------------------------------------------------------------
-- Who may see one
-- ---------------------------------------------------------------------------

alter table public.survey_visit_fees enable row level security;

drop policy if exists "Providers read their own survey fees" on public.survey_visit_fees;
create policy "Providers read their own survey fees"
  on public.survey_visit_fees for select to authenticated
  using (
    exists (
      select 1 from public.providers p
      where p.id = survey_visit_fees.provider_id
        and p.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every survey fee" on public.survey_visit_fees;
create policy "Admins read every survey fee"
  on public.survey_visit_fees for select to authenticated
  using (public.is_admin());

-- No insert or update policy for anybody, on purpose, and for the same reason
-- `commission_appeals` and `payments` have none: this decides money. Rows are
-- written by lib/data/survey.ts under the service role after it has established
-- what the customer actually did, and approved only by an admin path that has
-- established who is asking.

-- ---------------------------------------------------------------------------
-- IS IT THEM, OR IS IT US?
-- ---------------------------------------------------------------------------
--
-- A high decline rate has three readings and only one is about a person:
-- somebody quoting high, a ward where customers shop around, or OUR WHOLE
-- PROPOSITION FOR THAT TRADE BEING MISPRICED — which is exactly the case
-- `category_pricing_signals` exists for, and exactly why that table is never
-- grouped by person. Read the wrong way round, a per-person decline rate is a
-- list of people to punish for a price we set.
--
-- So the category comes first and the person is only ever read AGAINST it. This
-- appears on the approval decision and NOWHERE ELSE: not in ranking, not as an
-- automatic block, not as a ban. Same rule `payment_mix_signals` follows.

create or replace view public.survey_decline_signals as
select
  b.category_slug,
  date_trunc('month', b.created_at)::date as month,
  count(*) filter (where b.surveyed_at is not null) as surveys,
  count(*) filter (
    where b.quote_declined_at is not null
  ) as declines,
  round(
    count(*) filter (where b.quote_declined_at is not null)::numeric
      / nullif(count(*) filter (where b.surveyed_at is not null), 0) * 100,
    1
  ) as decline_rate_pct
from public.bookings b
where b.quote_model = 'survey'
group by b.category_slug, date_trunc('month', b.created_at);

comment on view public.survey_decline_signals is
  'Decline rate per TRADE per month. Never per professional: a trade where most quotes are declined is our pricing, not a list of people. A person is only compared against their own trade''s rate, at the moment a human decides one fee.';

revoke all on public.survey_decline_signals from anon, authenticated;
