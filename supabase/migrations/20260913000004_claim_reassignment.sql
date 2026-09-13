-- A declined claim has to reach somebody else.
--
-- WHAT WAS BROKEN. `/legal/refunds` promises, without conditions: "If the same
-- fault comes back within the window for that service, we send somebody back
-- and you pay nothing." The code did not keep it. `acceptClaim` admitted only
-- the professional whose job it was, or the one already attending; and
-- `releaseClaim` moved the claim back to `open` WITHOUT clearing
-- `attending_provider_id`. So a professional who could not return left the
-- claim in a state no other professional was permitted to accept, and RLS did
-- not show it to any of them either. It sat open for ever. A customer with a
-- valid guarantee had a written promise and no path.
--
-- WHY REASSIGNMENT RATHER THAN SETTLING IT. Settling a declined claim without a
-- visit was the other option and it undoes the whole shape of the policy: the
-- guarantee is a re-do that a visit verifies, and no verdict produces a refund
-- without a person. A claim that pays out because the professional was hard to
-- reach is a repeatable route to free money, which is exactly the failure the
-- re-do design exists to avoid. So the promise is kept the way the page states
-- it — somebody is sent — and the money follows the path that already exists:
-- when somebody OTHER than the original attends and finds the same fault,
-- `provider_ledger` records a redo debt against the original, netted forward at
-- a quarter of any one payout and never chased backward.

alter table public.guarantee_claims
  add column if not exists released_at timestamptz;

comment on column public.guarantee_claims.released_at is
  'When the attending professional handed the visit back. Opens the claim to every professional in the trade immediately — a hand-back is an answer, not silence, so there is no window left to serve.';

-- ---------------------------------------------------------------------------
-- Who may see an unheld claim
-- ---------------------------------------------------------------------------
--
-- The original professional gets first refusal: it is their work, and the
-- ledger only charges a redo debt when somebody else goes, so them going back
-- is the cheapest outcome for everybody. After
-- `CLAIM_FIRST_REFUSAL_MINUTES` (20, matching DISPATCH_WINDOWS.soon), or the
-- moment they hand it back, it opens to everybody who works that trade.
--
-- `security definer` for the same reason `provider_can_serve` is: a policy on
-- `guarantee_claims` that reads `providers` and `provider_categories` re-enters
-- nothing, but keeping the trade test in one function stops six policies
-- growing six slightly different definitions of "works that trade".
create or replace function public.provider_works_trade(
  target_profile uuid,
  trade text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.providers p
      join public.provider_categories pc on pc.provider_id = p.id
     where p.profile_id = target_profile
       and pc.category_slug = trade
       and p.is_active
       and p.removed_at is null
  );
$$;

comment on function public.provider_works_trade(uuid, text) is
  'Does this profile have an active listing covering this category? One definition, so policies cannot drift apart on what "works that trade" means.';

revoke execute on function public.provider_works_trade(uuid, text) from public;
grant execute on function public.provider_works_trade(uuid, text) to authenticated;

drop policy if exists "Providers read open claims in their trade" on public.guarantee_claims;
create policy "Providers read open claims in their trade"
  on public.guarantee_claims for select
  to authenticated
  using (
    status = 'open'
    and attending_provider_id is null
    and (
      released_at is not null
      or opened_at <= now() - interval '20 minutes'
    )
    and public.provider_works_trade((select auth.uid()), category_slug)
  );
