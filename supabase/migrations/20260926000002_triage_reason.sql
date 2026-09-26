-- REMOVES: nothing. One nullable column and one partial index are added to
-- `triage_logs`; no column, policy, function, grant or guard clause is dropped
-- or weakened.
--
-- ===========================================================================
-- Why the keyword matcher answered, which nothing has ever recorded.
--
-- WHAT WAS MISSING. `/api/triage` already computes a reason on every request —
-- `no-api-key`, `timeout`, `provider-error`, `unparseable` — and returns it to
-- the browser for the dev badge, where one developer looking at one card can
-- read it. Then it is dropped. So `triage_logs` records THAT the fallback
-- answered and never WHY, and `/admin/triage-accuracy` can count 15 fallbacks
-- without being able to say whether there was no key, a rejected key, a slow
-- model, or a model answer we threw away ourselves.
--
-- WHY IT MATTERS NOW AND DID NOT BEFORE. Until today this product had no
-- Anthropic key, so every fallback had the same cause and "fallback" and "no
-- key" were the same fact. With a key live they come apart, and the case worth
-- catching is the one that looks like success: the key is set, every
-- configuration check in the product reports it as present, and every answer is
-- still the matcher. `firedDespiteKey` in lib/ai/accuracy.ts is that
-- distinction; this column is what it reads.
--
-- NULL IS "NOT RECORDED", NEVER "NO REASON" — rule 6, and the fifteen rows
-- already in this table are exactly that case. They are deliberately NOT
-- backfilled. They almost certainly were `no-api-key`, because there was no
-- key — and "almost certainly" is not a measurement. Writing a confident value
-- into a column a screen reads, on the strength of an inference nobody can
-- check later, is the whole class of mistake rule 6 names. `fallbackCause`
-- returns `notRecorded` for them and the screen prints that as its own row.
--
-- THE CHECK CONSTRAINT NAMES ONLY WHAT A SERVER CAN WRITE. `unreachable` and
-- `rejected` are produced by the BROWSER fallback in lib/ai/triage.ts, when the
-- request never arrived or came back 4xx — so by construction no server ever
-- saw one and no row can carry it. `LOGGABLE_REASONS` is the same list in
-- TypeScript and `tests/unit/triage-reason.test.ts` asserts the two agree,
-- because a constraint and a union that drift apart fail at 3am in production
-- rather than in a suite.
--
-- Two values here are new and neither existed as a reason before:
--   auth-rejected  the key is set and the provider refused it. A credential to
--                  rotate, not one to add — and it reads as configured.
--   rate-limited   the provider's own 429. Our request volume, not a fault.

alter table public.triage_logs
  add column if not exists reason text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'triage_logs_reason_known'
  ) then
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
          'unparseable'
        )
      );
  end if;
end $$;

comment on column public.triage_logs.reason is
  'Why the answer came from where it did. NULL means not recorded (a row '
  'written before this column), never "no reason" — see lib/ai/accuracy.ts '
  'fallbackCause. Only reasons a server can produce are permitted: the '
  'browser-side "unreachable" and "rejected" never reach a row.';

-- Partial, because the question is always asked of the fallback rows. The
-- model-served rows are the majority once a key is live and indexing them here
-- would pay for a filter nobody applies.
create index if not exists triage_logs_fallback_reason_idx
  on public.triage_logs (reason, created_at desc)
  where source = 'fallback';
