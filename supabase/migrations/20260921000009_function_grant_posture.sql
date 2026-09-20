-- Seven functions a stranger could still call, and the audit trigger's path.
--
-- FOUND BY SUPABASE'S OWN SECURITY ADVISOR, WHICH NOTHING IN THIS REPOSITORY
-- WAS READING. `20260903000001_harden_functions.sql` worked through the same
-- list once and the discipline did not survive contact with later phases: six
-- trigger functions added since then, plus one callable helper, still carry
-- `execute` for `anon`, and the trigger that protects the audit log never had
-- its `search_path` pinned.
--
-- The assertion that stops this recurring is in `tests/db/guard-clauses.test.ts`
-- rather than here — a migration fixes today's drift, a test in `npm run verify`
-- is what makes tomorrow's fail on the machine that introduced it.
--
-- ---------------------------------------------------------------------------
-- 1. REVOKE EXECUTE FROM `anon`. FROM `anon` ONLY, AND THAT IS LOAD-BEARING.
-- ---------------------------------------------------------------------------
--
-- Supabase grants `execute` directly to `anon` and `authenticated` through a
-- default privilege on `public`, so `revoke ... from public` clears neither —
-- the lesson `harden_functions.sql` already records, and the reason both roles
-- have to be named whenever both are meant.
--
-- Here only `anon` is meant. `provider_works_trade` is called by the policy
-- "Providers read open claims in their trade" on `guarantee_claims`, and a
-- policy expression is evaluated with the CALLER's privileges — so revoking
-- from `authenticated` would silently empty every professional's open-claims
-- list. That is the identical trap `is_admin()` exists to document, and the
-- advisor will go on suggesting it. The answer is no.
--
-- The six trigger functions are safe to revoke for a reason the db suite
-- already asserts: Postgres checks `execute` when a trigger is CREATED, not
-- when it fires. Calling one by hand fails anyway ("trigger functions can only
-- be called as triggers") — but a function nobody is supposed to call by hand
-- should not be callable by hand, and `provider_works_trade` is the one of the
-- seven that genuinely runs when a stranger asks.

revoke execute on function public.enforce_application_immutability() from anon;
revoke execute on function public.enforce_claim_eligibility() from anon;
revoke execute on function public.enforce_claim_transition() from anon;
revoke execute on function public.enforce_confirmation_integrity() from anon;
revoke execute on function public.freeze_quote_after_work() from anon;
revoke execute on function public.sync_provider_on_job() from anon;
revoke execute on function public.provider_works_trade(uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- 2. THE AUDIT LOG'S OWN TRIGGER RUNS ON THE CALLER'S SEARCH PATH.
-- ---------------------------------------------------------------------------
--
-- `security_events_are_append_only` is the one function `harden_functions.sql`
-- missed, and it happens to be the trigger that makes the security log
-- unrewritable. It is SECURITY INVOKER and its body resolves no names at all —
-- it raises, using `tg_op`, which is a plpgsql variable — so pinning the path
-- cannot change what it does. It is pinned because an unpinned path on the
-- function guarding the audit log is the wrong thing to leave lying around,
-- not because there is an exploit here.
--
-- THE BODY BELOW IS THE LIVE `pg_proc` TEXT, character for character.
-- `create or replace` takes the text it is given, so rebuilding from a
-- migration file is how a function silently reverts to an older version. The
-- two happened to agree this time; that was checked rather than assumed.
--
-- `create or replace` keeps the function's OID, so `security_events_no_rewrite`
-- stays attached. The trigger is deliberately NOT dropped and recreated: a
-- window with no trigger on the audit log, however short, is a window.

create or replace function public.security_events_are_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'security_events is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

-- Not granted to anybody. It is a trigger function and always was.
revoke execute on function public.security_events_are_append_only()
  from public, anon, authenticated;
