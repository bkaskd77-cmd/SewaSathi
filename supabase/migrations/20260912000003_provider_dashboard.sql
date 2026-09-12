-- ---------------------------------------------------------------------------
-- The two things a professional can change about their own listing, and the
-- one thing time changes for them.
--
-- Until now a provider row was written entirely by us: the seed wrote it, or
-- approving an application wrote it. A real professional had no way to say
-- "I am free this afternoon" or "my call-out starts at 1,200", which is most
-- of what a working tradesperson wants from an app at all.
--
-- STILL NO UPDATE POLICY, deliberately. Both writes go through
-- `lib/data/provider-profile.ts` under the service role, which re-reads which
-- listing belongs to the caller. RLS is row-level, so an update policy on
-- `providers` would make every column on the row writable from a browser —
-- `is_verified`, `standing`, `checks`, the lot. That is the exact bug the
-- booking immutability trigger exists to undo, and it is cheaper not to open
-- it than to fence it off column by column.
-- ---------------------------------------------------------------------------

/**
 * "Available now", with an expiry.
 *
 * The switch turns it on and TIME TURNS IT OFF — see
 * `lib/provider/availability.ts` for why a flag that never decays sends
 * somebody with a burst pipe to a person who is asleep, and why it also beats
 * every professional honest enough to turn it off.
 *
 * DECAY, NOT A CRON. Nothing sweeps this column. A read compares it against
 * `now()`, so there is no job to stop running one night and nothing is ever
 * stale between runs.
 *
 * `availability` stays what it was: the base, what this listing is when the
 * flag is not lit. The toggle never writes 'now' into it — that value is the
 * stamp's to grant. (Seed rows carry a stored 'now' and keep it. They are
 * fixtures, not people, and nobody is dispatched to them.)
 */
alter table public.providers
  add column if not exists available_until timestamptz;

comment on column public.providers.available_until is
  'While this is in the future the listing reads as "available now". Set by the professional, expired by the clock — no sweep, so there is no job that can stop running.';

create index if not exists providers_available_until_idx
  on public.providers (available_until)
  where is_active;

/**
 * What they asked to charge, beside what they may.
 *
 * `base_rate` is clamped to the published band for their trades
 * (`clampRate` in `lib/provider/rates.ts`); this is the figure they typed.
 * Keeping both is the only way to answer the question that matters: a whole
 * category bunching at a bound is OUR mispricing, the same reading
 * `category_pricing_signals` gives under-reported settlements.
 *
 * NEVER READ PER PERSON. A list of professionals who wanted to charge more is
 * a list of people to be suspicious of, which is not what this is for and is
 * how the settlement version of this signal would have gone wrong too.
 */
alter table public.providers
  add column if not exists base_rate_requested integer
    check (base_rate_requested is null or base_rate_requested > 0);

comment on column public.providers.base_rate_requested is
  'The starting price the professional actually typed, before the band clamped it. Read per category to find our own mispricing; never per person.';

/**
 * Where the band is wrong, by category.
 *
 * `pressure` is the share of professionals in a trade whose own number sat
 * outside the band we publish. High in one category means the band is too
 * narrow for the work, not that the trade is full of chancers.
 */
create or replace view public.category_rate_signals as
  select
    pc.category_slug,
    count(*) as providers_priced,
    count(*) filter (where p.base_rate_requested is distinct from p.base_rate)
      as clamped_providers,
    round(
      100.0 * count(*) filter (where p.base_rate_requested is distinct from p.base_rate)
        / nullif(count(*), 0)
    , 1) as pressure,
    count(*) filter (where p.base_rate_requested > p.base_rate) as wanted_more,
    count(*) filter (where p.base_rate_requested < p.base_rate) as wanted_less,
    min(p.base_rate) as lowest_rate,
    max(p.base_rate) as highest_rate
  from public.providers p
  join public.provider_categories pc on pc.provider_id = p.id
  where p.is_active
    and p.base_rate_requested is not null
  group by pc.category_slug;

comment on view public.category_rate_signals is
  'How hard professionals push against each published band. A category under pressure is our pricing to fix. Never grouped by person.';

revoke all on public.category_rate_signals from anon, authenticated;
