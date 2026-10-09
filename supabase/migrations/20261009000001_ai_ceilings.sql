-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. No deviation: no
--   statement here has `DROP` as its first keyword. The two `drop policy if exists` lines
--   the repo's idiom carries are omitted from the applied text and kept in the file.
--
-- ADDS: public.ai_limits, public.ai_spend, public.ai_account_state.
-- REMOVES: nothing. No function is rebuilt and no policy on an existing table is
--   redefined.

-- ===========================================================================
-- What the AI may cost, what it has cost today, and who has been asked to stop.
--
-- THREE TABLES BECAUSE THEY ARE THREE LIFETIMES. The limits are a setting somebody
-- changes a few times a year and every change is audited. The spend is one row per Nepal
-- day, written on every model call and read on every one. The account state is a running
-- streak and a pause, per person, cleared by a good question.
--
-- THE NUMBERS ARE BOUNDED IN SQL AS WELL AS IN `lib/config/ai-limits.ts`, and the two
-- lists are compared by `tests/unit/ai-limit-bounds.test.ts` rather than trusted: this is
-- a settings screen a person edits under time pressure, and a mistyped zero is either a
-- product that stops answering or a budget with no ceiling. `AI_LIMIT_BOUNDS` is the
-- screen's half and these constraints are the half a write going round the screen still
-- meets.
--
-- NOTHING HERE IS A SECURITY CONTROL, and the comments say so where somebody will read
-- them while changing a number. A visitor is counted against a cookie they can clear;
-- an account is free to make. These bound what one afternoon can spend.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The settings, one row
-- ---------------------------------------------------------------------------

create table if not exists public.ai_limits (
  /*
   * ONE ROW, ENFORCED BY THE KEY. `id boolean primary key check (id)` admits exactly one
   * value, so a second row is refused by the database rather than by a convention the
   * next caller has to know about. The alternative — a settings table with a `name`
   * column and one row — invites a second row nobody notices and a read that picks the
   * wrong one.
   */
  id boolean primary key default true check (id),

  anon_triages_per_day integer not null default 2
    check (anon_triages_per_day >= 0 and anon_triages_per_day <= 50),
  anon_max_chars integer not null default 300
    check (anon_max_chars >= 50 and anon_max_chars <= 2000),
  user_text_per_day integer not null default 10
    check (user_text_per_day >= 1 and user_text_per_day <= 500),
  user_photos_per_day integer not null default 4
    check (user_photos_per_day >= 0 and user_photos_per_day <= 100),
  user_max_chars integer not null default 500
    check (user_max_chars >= 50 and user_max_chars <= 2000),
  off_topic_streak_to_pause integer not null default 2
    check (off_topic_streak_to_pause >= 1 and off_topic_streak_to_pause <= 20),
  off_topic_pause_hours integer not null default 24
    check (off_topic_pause_hours >= 1 and off_topic_pause_hours <= 168),
  off_topic_repeat_window_days integer not null default 7
    check (off_topic_repeat_window_days >= 1 and off_topic_repeat_window_days <= 90),
  unrelated_photos_per_request integer not null default 2
    check (unrelated_photos_per_request >= 1 and unrelated_photos_per_request <= 10),
  photo_request_window_minutes integer not null default 30
    check (photo_request_window_minutes >= 5 and photo_request_window_minutes <= 1440),
  daily_budget_usd numeric(10, 4) not null default 1
    check (daily_budget_usd >= 0 and daily_budget_usd <= 1000),
  visitor_share_bps integer not null default 2000
    check (visitor_share_bps >= 0 and visitor_share_bps <= 10000),

  /** Who changed it last. The audit row carries what changed; this is the quick read. */
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

comment on table public.ai_limits is
  'Every ceiling on what the AI may cost, in one row. Bounded here as well as in lib/config/ai-limits.ts so a write going round the admin screen still meets the bounds; the two lists are compared by a test.';

insert into public.ai_limits (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. What it has cost, per Nepal day
-- ---------------------------------------------------------------------------

create table if not exists public.ai_spend (
  /*
   * `YYYY-MM-DD` IN KATHMANDU, NOT A DATE COLUMN. The budget is a promise to people here
   * — "the AI is back tomorrow" has to mean tomorrow on their clock — and UTC midnight is
   * 05:45 local. A `date` column would invite `current_date`, which is UTC on this
   * server, and the reset would land mid-morning. `nepalDayKey` is the one thing that
   * decides which day a call belongs to.
   */
  day_key text primary key check (day_key ~ '^\d{4}-\d{2}-\d{2}$'),

  /* Dollars, measured from the `usage` block the provider returned. Never estimated. */
  total_usd numeric(12, 6) not null default 0 check (total_usd >= 0),
  /* The part spent by people who were not signed in. Bounded by its share. */
  visitor_usd numeric(12, 6) not null default 0 check (visitor_usd >= 0),

  calls integer not null default 0 check (calls >= 0),
  visitor_calls integer not null default 0 check (visitor_calls >= 0),
  photo_calls integer not null default 0 check (photo_calls >= 0),

  /*
   * Calls priced at the dearest rate because the model id was not in the table.
   *
   * COUNTED RATHER THAN SILENT, because the day it is non-zero is the day somebody
   * changed the model and the budget started guessing. A figure derived from a guess
   * that nobody knows is a guess is worse than no figure.
   */
  unknown_model_calls integer not null default 0 check (unknown_model_calls >= 0),

  updated_at timestamptz not null default now()
);

comment on table public.ai_spend is
  'One row per Nepal day. Priced from the usage each provider response reports, never from our own token estimate — a ceiling computed from an estimate drifts from the bill in the direction nobody notices.';

comment on column public.ai_spend.unknown_model_calls is
  'Calls priced at the dearest rate we know because the model id was not in the table. Non-zero means somebody changed the model and the budget is guessing.';

-- ---------------------------------------------------------------------------
-- 3. Who has been asked to stop, and for how long
-- ---------------------------------------------------------------------------

create table if not exists public.ai_account_state (
  profile_id uuid primary key references public.profiles (id) on delete cascade,

  /* Consecutive off-topic questions. One on-topic question sets it back to zero. */
  off_topic_streak integer not null default 0 check (off_topic_streak >= 0),

  /* When the current pause ends. Null is "not paused", which is the ordinary state. */
  paused_until timestamptz,
  /* When the last pause started, for the repeat-within-the-window flag. */
  last_paused_at timestamptz,

  /*
   * When a second pause inside the window flagged this account for a person to look at.
   *
   * A FLAG AND NOT AN ACTION. There is no automatic permanent block here and there is not
   * going to be one: the whole evidence is "a model called some questions off-topic", and
   * a model wrong twice about somebody's Nepali is a model being wrong. Null is the
   * ordinary state and is never read as a clean record — nothing reads it but a screen.
   */
  review_flagged_at timestamptz,

  updated_at timestamptz not null default now()
);

comment on table public.ai_account_state is
  'One row per account that has ever been judged off-topic. A streak, a pause and a review flag — never a block. An on-topic question clears the streak; serving the pause is what ends the pause.';

-- ---------------------------------------------------------------------------
-- Closed before it is opened
-- ---------------------------------------------------------------------------

alter table public.ai_limits enable row level security;
alter table public.ai_spend enable row level security;
alter table public.ai_account_state enable row level security;

-- NOTHING FROM A BROWSER ON ANY OF THE THREE. The limits are changed by one audited
-- server action behind a fresh second factor; the spend is written by the triage route
-- under the service role; the account state is written by the same route. A customer able
-- to write `ai_account_state` could clear their own pause, and one able to write
-- `ai_spend` could zero the day's bill.
revoke insert, update, delete on public.ai_limits from anon, authenticated;
revoke insert, update, delete on public.ai_spend from anon, authenticated;
revoke insert, update, delete on public.ai_account_state from anon, authenticated;

create index if not exists ai_account_state_paused_idx
  on public.ai_account_state (paused_until)
  where paused_until is not null;

create index if not exists ai_account_state_flagged_idx
  on public.ai_account_state (review_flagged_at desc)
  where review_flagged_at is not null;

-- ---------------------------------------------------------------------------
-- One more reason a triage can come from the matcher
-- ---------------------------------------------------------------------------

/*
 * `ceiling-reached` — a ceiling or the day's budget refused the call before it was made.
 *
 * NOT A FAULT, WHICH IS WHY IT IS A VALUE RATHER THAN BEING FOLDED INTO ONE. Every other
 * fallback reason is something going wrong; this one is the product working as designed.
 * Counting it as `no-api-key` or `provider-error` would put a working ceiling in the same
 * column as an outage and make the fallback rate unreadable — which is the whole thing
 * `/admin/triage-accuracy` is for.
 *
 * `LOGGABLE_REASONS` AND THIS LIST ARE ONE LIST WRITTEN TWICE, which the repo already
 * knows about: `tests/unit/triage-reason.test.ts` reads this migration and compares them,
 * so a value added to one and not the other fails a test rather than failing on the first
 * production request that produces it — losing the log row and the id that attributes the
 * booking that followed.
 *
 * Dropped and re-added as `alter table`, which is instant over the MCP transport; only a
 * statement whose FIRST keyword is `DROP` hangs.
 */
alter table public.triage_logs
  drop constraint if exists triage_logs_reason_known;

alter table public.triage_logs
  add constraint triage_logs_reason_known check (
    reason is null or reason in (
      'ok',
      'cache-hit',
      'no-api-key',
      'timeout',
      'auth-rejected',
      'rate-limited',
      'provider-error',
      'unparseable',
      'ceiling-reached'
    )
  );

-- ---------------------------------------------------------------------------
-- Adding to the day, atomically
-- ---------------------------------------------------------------------------

/*
 * ONE STATEMENT, BECAUSE TWO CALLS A MILLISECOND APART BOTH READ "ZERO SO FAR".
 *
 * Read-then-write loses one of them, and what it loses is money off the measured bill —
 * the same race `enforce_slot_capacity` and `provider_ledger_recovery_once_idx` are
 * shaped around, where an application that remembers not to do it is weaker than a
 * database that refuses. Postgres does the addition here.
 *
 * `security definer` so the triage route can call it through the service role without
 * holding an INSERT grant on the table — nothing else may write a spend row, and a
 * customer who could would be a customer who could zero the day's bill.
 */
create or replace function public.add_ai_spend(
  p_day_key text,
  p_usd numeric,
  p_visitor boolean,
  p_photo boolean,
  p_unknown_model boolean
) returns void
language sql
security definer
set search_path = ''
as $fn$
  insert into public.ai_spend as s (
    day_key, total_usd, visitor_usd, calls, visitor_calls, photo_calls,
    unknown_model_calls, updated_at
  )
  values (
    p_day_key,
    greatest(coalesce(p_usd, 0), 0),
    case when p_visitor then greatest(coalesce(p_usd, 0), 0) else 0 end,
    1,
    case when p_visitor then 1 else 0 end,
    case when p_photo then 1 else 0 end,
    case when p_unknown_model then 1 else 0 end,
    now()
  )
  on conflict (day_key) do update set
    total_usd = s.total_usd + excluded.total_usd,
    visitor_usd = s.visitor_usd + excluded.visitor_usd,
    calls = s.calls + 1,
    visitor_calls = s.visitor_calls + excluded.visitor_calls,
    photo_calls = s.photo_calls + excluded.photo_calls,
    unknown_model_calls = s.unknown_model_calls + excluded.unknown_model_calls,
    updated_at = now();
$fn$;

comment on function public.add_ai_spend(text, numeric, boolean, boolean, boolean) is
  'Add one measured call to a Nepal day. One statement, because read-then-write loses a concurrent call and what it loses is money off the bill.';

-- Nobody but the service role. Same posture as every other definer function here.
revoke execute on function public.add_ai_spend(text, numeric, boolean, boolean, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies and grants, last, so stopping anywhere leaves something closed
-- ---------------------------------------------------------------------------

-- Admins read all three; nobody else reads any of them. A customer does not need to see
-- the site's budget, and their own pause reaches them as a sentence from the route rather
-- than as a row they can poll.
drop policy if exists "Admins read the AI limits" on public.ai_limits;
create policy "Admins read the AI limits"
  on public.ai_limits for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins read the AI spend" on public.ai_spend;
create policy "Admins read the AI spend"
  on public.ai_spend for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins read the AI account state" on public.ai_account_state;
create policy "Admins read the AI account state"
  on public.ai_account_state for select to authenticated
  using (public.is_admin());

-- A new table grants nothing, so this says what it grants.
grant select on public.ai_limits to authenticated;
grant select on public.ai_spend to authenticated;
grant select on public.ai_account_state to authenticated;

-- The `supabase_migrations` history row is recorded when this is applied, not from inside
-- the file: the test harness builds a bare Postgres with no such schema.
