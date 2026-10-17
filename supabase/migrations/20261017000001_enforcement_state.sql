-- ADDS: providers.enforcement_step/_reason/_at/_by, customer_risk.banned_by,
--       the constraints that pair them, and an enforcement clause inside
--       public.provider_can_serve.
--
-- WHY THIS EXISTS. `/providers/standards` publishes a five-step enforcement
-- ladder, in both languages, linked from `/providers/join` before anybody signs
-- up. Steps 3, 4 and 5 each name what they cost. Until this migration the
-- database could express exactly one of them: `removed_at` for step 5, written
-- by nothing anywhere in the tree. Steps 3 and 4 had no state at all.
--
-- So the page promised a ladder and the product had no rungs. That is this
-- repository's most-recorded sin — a thing described in writing with nothing
-- behind it — in the one place where the reader is a professional deciding
-- whether to trust us with their livelihood.
--
-- THE CUSTOMER HALF IS THE SAME FAULT ONE TABLE OVER. `customer_risk.banned_at`
-- and `banned_reason` have existed since 20260910000002. Nothing writes them,
-- and the single reader turns `banned_at` into a `banned` boolean that two admin
-- screens DISPLAY. `createBooking` has never consulted customer risk at all, so
-- a banned customer could book exactly as before: a setting that does nothing
-- when set, which is a false control rather than a missing feature.
--
-- NOTHING IS BACKFILLED AND NOTHING NEEDS TO BE. Read live before writing this:
-- 6 providers, 0 with `removed_at`, 0 `customer_risk` rows, 0 banned. So the
-- constraints below are plain rather than NOT VALID — there is no history for
-- them to retrospectively accuse.

-- ---------------------------------------------------------------- columns ---

/*
 * ONE STEP NUMBER RATHER THAN THREE BOOLEANS, because the ladder is ordered and
 * the published copy says so: step 4 includes step 3's effects and step 5
 * includes both. Three flags would let somebody write "payouts held but still
 * offered open jobs", which is a state the page does not describe and nobody
 * could explain to the professional it was applied to.
 *
 * NULL IS "NO STEP IN FORCE" and is a measured fact here, not an absence: every
 * raise and every lift writes a `security_events` row through `lib/audit`, so
 * the history is in the append-only log and the column only ever holds what is
 * true now. Steps 1 and 2 are deliberately absent — step 1 is a private message
 * and step 2 is `withdrawalRankingPenalty`, which is already computed from
 * `provider_stats` and needs no state.
 */
alter table public.providers
  add column if not exists enforcement_step smallint;

alter table public.providers
  add column if not exists enforcement_reason text;

alter table public.providers
  add column if not exists enforcement_at timestamptz;

alter table public.providers
  add column if not exists enforcement_by uuid references public.profiles (id);

comment on column public.providers.enforcement_step is
  'Which step of the published enforcement ladder is in force: 3, 4 or 5, or null for none. Steps 1 and 2 carry no state - step 1 is a private message, step 2 is the ranking penalty already derived from provider_stats. Raising or lifting writes a security_events row; this column holds only the current state.';

comment on column public.providers.enforcement_reason is
  'Why, in a persons words. Required whenever a step is in force, because /providers/standards promises every step says what triggered it and an appeal answered by a human needs something to answer.';

alter table public.customer_risk
  add column if not exists banned_by uuid references public.profiles (id);

comment on column public.customer_risk.banned_by is
  'Which admin suspended this customer. Null on an unsuspended row, and null on any row suspended before this column existed - of which there are none.';

-- ------------------------------------------------------------ constraints ---

/*
 * A STEP WITHOUT A REASON IS NOT APPLICABLE, enforced here rather than left to
 * the writer. The appeal published on `/providers/standards` is answered by a
 * person reading what triggered the step; a row that cannot say is a step that
 * cannot be appealed, which is the trap that page exists to refuse.
 */
alter table public.providers
  drop constraint if exists providers_enforcement_shape;

alter table public.providers
  add constraint providers_enforcement_shape check (
    (enforcement_step is null
      and enforcement_reason is null
      and enforcement_at is null)
    or (enforcement_step in (3, 4, 5)
      and enforcement_reason is not null
      and char_length(enforcement_reason) between 1 and 2000
      and enforcement_at is not null)
  );

/*
 * `removed_at` AND STEP 5 ARE ONE FACT, so they cannot disagree. The column
 * predates this migration and four modules already read it — `platform.ts`,
 * `recovery.ts`, `verification.ts` and `claim_reassignment` — so step 5 sets it
 * rather than replacing it, and this constraint is what stops a future writer
 * setting one without the other. Removal without a step would be an accusation
 * with no reason attached, which is the shape 20260925000005 already refused
 * when it kept `closed_at` separate.
 */
alter table public.providers
  drop constraint if exists providers_removed_is_step_five;

/*
 * WRITTEN AS AN EQUALITY OF TWO BOOLEANS, and the first draft was not — it read
 * `(enforcement_step is distinct from 5 and removed_at is null) or
 *  (enforcement_step = 5 and removed_at is not null)`, which looks exhaustive
 * and is not. With a null step and `removed_at` set, the first arm is false and
 * the second is `null and true` = null, so the whole expression is null — and a
 * CHECK constraint passes on null. The hole it left is precisely the one this
 * constraint exists to close: a removal stamp with no step beside it, which is
 * an accusation with no reason attached.
 *
 * `coalesce(... , false)` IS THE LOAD-BEARING PART. `(removed_at is not null)`
 * is never null, so coercing the other side makes both operands boolean and the
 * comparison total. Found by `tests/db/enforcement-ladder.test.ts` refusing to
 * reject, not by reading it back.
 */
alter table public.providers
  add constraint providers_removed_is_step_five check (
    (removed_at is not null) = coalesce(enforcement_step = 5, false)
  );

/*
 * THE CUSTOMER HALF OF THE SAME RULE. A suspension a person cannot be told the
 * reason for is one they cannot argue with.
 */
alter table public.customer_risk
  drop constraint if exists customer_risk_ban_shape;

alter table public.customer_risk
  add constraint customer_risk_ban_shape check (
    (banned_at is null and banned_reason is null)
    or (banned_at is not null
      and banned_reason is not null
      and char_length(banned_reason) between 1 and 1000)
  );

-- --------------------------------------------------------------- the gate ---

/*
 * STEP 3 CLOSES THE OPEN POOL AND NOTHING ELSE, which is exactly what the page
 * says: "you stop being offered jobs from the open pool — customers who ask for
 * you by name still reach you."
 *
 * SHARED SURFACE, SO WHAT DEPENDS ON IT IS NAMED. `provider_can_serve` has five
 * callers across three migrations: the two booking policies in 20260905000002,
 * the two in 20260905000003, and `open_job_ids` in 20260925000001. Every one of
 * them is a professional READING or CLAIMING an unassigned job. None of them is
 * on the path a customer takes to book somebody by name — `createBooking` writes
 * `provider_id` under the service role and never consults this function — so
 * adding the clause here closes the pool and leaves the by-name route open,
 * which is the published distinction.
 *
 * `is_active` STAYS AND IS NOT THE SAME QUESTION. It is the system's "this
 * listing is live at all" flag, written today only by the dormancy sweep in
 * `lib/data/recovery.ts`. Folding enforcement into it would make "taking a
 * break" and "under review" indistinguishable in every future report, which is
 * the conflation 20260925000005 was written to prevent.
 */
create or replace function public.provider_can_serve(
  category text,
  address uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.providers p
    join public.provider_categories pc on pc.provider_id = p.id
    join public.addresses a on a.id = address
    where p.profile_id = (select auth.uid())
      and p.is_active
      and p.enforcement_step is null
      and pc.category_slug = category
      and a.area_key = any (p.service_areas)
  );
$$;

revoke execute on function public.provider_can_serve(text, uuid)
  from public, anon;
grant execute on function public.provider_can_serve(text, uuid) to authenticated;
