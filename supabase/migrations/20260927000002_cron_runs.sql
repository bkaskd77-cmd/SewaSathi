-- A cron nobody calls looks identical to a cron with nothing to do.
--
-- /api/payments/reconcile runs sweepRedoRecovery, which nets a guarantee debt
-- off a professional's future earnings. With no debt outstanding a correct run
-- writes nothing, so a run that happened and a run that never did leave the
-- same trace: none. The Cron Jobs page has no last-run column, and the runtime
-- log is a short retention window on Hobby, so by the time anybody looks the
-- 03:00 UTC run is gone. Three oracles, none of which can answer it.
--
-- So the run records itself. The row is the point, not what the run found:
-- "ran at 03:41, considered 4 payouts, recovered nothing" is the answer, and it
-- survives whatever Vercel does with its logs.

create table if not exists public.cron_runs (
  id uuid primary key default gen_random_uuid(),

  -- The scheduled path, exactly as vercel.json writes it, so this column can be
  -- compared against cronPaths(vercel.json). CRON_JOBS in lib/config/cron.ts is
  -- the same list written twice and a test reads this constraint and compares —
  -- otherwise they drift silently and the first new job's insert is refused,
  -- losing the only record that it ran at all.
  job text not null,

  started_at timestamptz not null default now(),
  finished_at timestamptz,

  -- Did the handler reach the end? NULL is "not recorded" and never "failed":
  -- a process killed mid-run writes no completion, and reading that silence as
  -- a failure invents an incident. Rule 6.
  ok boolean,

  -- Whatever the sweep returned, verbatim. Shapes differ per job and will
  -- change; this is a record of what happened, not an interface.
  summary jsonb,

  -- The provider's own sentence when something threw. Never a credential.
  error text,

  constraint cron_runs_job_known check (
    job in ('/api/payments/reconcile', '/api/bookings/dispatch')
  )
);

-- The only query: "when did this job last run?"
create index if not exists cron_runs_job_started_idx
  on public.cron_runs (job, started_at desc);

alter table public.cron_runs enable row level security;

-- Admins read. Nobody inserts or updates through RLS at all — every write is
-- service role from lib/data/cron-runs.ts, the same posture as security_events.
drop policy if exists "Admins read cron runs" on public.cron_runs;
create policy "Admins read cron runs"
  on public.cron_runs for select
  to authenticated
  using (public.is_admin());

-- APPEND-ONLY, FOR EVERY CALLER INCLUDING THE SERVICE ROLE.
-- A log the application can edit proves nothing, and the whole value of this
-- table is that "it ran" cannot later be tidied into "it did not".
--
-- `refuse_rewrite()` ALREADY EXISTS and already serves three tables. The first
-- version of this migration wrote a fourth copy of a one-line function, which
-- `tests/db/guard-clauses.test.ts` caught by refusing to let an unregistered
-- raising function exist — a guard doing exactly its job. It reports
-- `tg_table_name`, so the message names this table without knowing about it.
drop trigger if exists cron_runs_append_only on public.cron_runs;
create trigger cron_runs_append_only
  before update or delete on public.cron_runs
  for each row execute function public.refuse_rewrite();
