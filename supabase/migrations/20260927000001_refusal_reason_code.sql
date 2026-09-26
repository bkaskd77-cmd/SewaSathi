-- REMOVES: nothing. One nullable column and one check constraint are added to
-- `booking_refusals`; no column, policy, function, grant or guard clause is
-- dropped or weakened, and the existing free-text `reason` is untouched.
--
-- ===========================================================================
-- Why somebody turned a job down, in a form that can be counted.
--
-- WHAT ALREADY EXISTS, SO THIS IS NOT A REBUILD. Both refusal paths already
-- capture a reason: `declineJob` and the withdrawal path each attach free text
-- to the `booking_refusals` row the trigger wrote, and `provider_stats.declines`
-- and `.withdrawals` already count refusals — `withdrawalRankingPenalty` already
-- costs list position for them.
--
-- WHAT IS MISSING. The reason is PROSE. One person can read it on one booking
-- and nothing can aggregate it, so "this professional keeps refusing work in
-- Bhaktapur" is a sentence somebody would have to notice by reading rows one at
-- a time. A closed set alongside the prose makes the same fact countable without
-- taking the prose away — the free text is where somebody says the thing the
-- list did not anticipate, and it stays.
--
-- A STATED PREFERENCE, NOT A JUDGEMENT, and that distinction is why this is
-- safe to act on later where a rating is not. `too_far` is somebody telling us
-- where they will not travel; it is checkable, it is theirs to change, and
-- acting on it means not offering them work they have said they do not want.
-- Nothing here is evidence about how well they work, and none of it is a
-- ranking input today.
--
-- NULL IS "NOT RECORDED", NEVER "NO REASON" — rule 6, and it is every row that
-- already exists. They are not backfilled: inferring a code from free text
-- written by somebody who was answering a different question would put a
-- confident value into a column a count reads. `price` in particular would be
-- guessed wrong more often than not.
--
-- `price` IS ON THE LIST AND IS NEVER A SIGNAL AGAINST ANYBODY.
-- /providers/standards already publishes "charging under the band" and "turning
-- work down" under *what is never a signal*. A professional saying a job is not
-- worth the trip is telling us our band may be wrong for that work, which is
-- the same reading `category_pricing_signals` takes — about our price, never
-- about the person.

alter table public.booking_refusals
  add column if not exists reason_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booking_refusals_reason_code_known'
  ) then
    alter table public.booking_refusals
      add constraint booking_refusals_reason_code_known check (
        reason_code is null or reason_code in (
          'too_far',
          'wrong_job',
          'already_busy',
          'price',
          'other'
        )
      );
  end if;
end $$;

comment on column public.booking_refusals.reason_code is
  'Why they turned it down, from a closed set, so refusals can be counted '
  'rather than only read one at a time. NULL is "not recorded" — every row '
  'predating this column — never "no reason". A stated preference, not a '
  'judgement: nothing here says anything about how well somebody works, and '
  'none of it is a ranking input. See lib/provider/fit.ts.';

-- Counted per professional and per ward later; the index is what makes that
-- cheap without anybody having to add one in a hurry when the screen is built.
create index if not exists booking_refusals_reason_code_idx
  on public.booking_refusals (provider_id, reason_code)
  where reason_code is not null;
