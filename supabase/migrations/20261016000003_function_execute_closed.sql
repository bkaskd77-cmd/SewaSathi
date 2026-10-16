-- ---------------------------------------------------------------------------
-- A new function gives a browser nothing either.
--
-- THE HOLE THIS GENERALISES WAS REAL AND WAS FOUND IN THIS PROJECT.
-- `provider_outstanding` and `provider_balance` are `security definer`, so they
-- answer to their own grant and not to `provider_ledger`'s policies — and both
-- carried `execute` for `authenticated`, which meant any signed-in customer
-- could name any professional's id and read their guarantee debt and money
-- position. Proven against production before the fix. Nothing was disclosed,
-- the ledger being empty, and the door was open.
--
-- NOBODY GRANTED IT. Supabase's default privilege on `public` hands `anon` and
-- `authenticated` EXECUTE on every function created there, exactly as it did
-- for tables until `20261002000001` — and that migration closed the table half
-- only. So the fix in `20260930000001` revoked the grant from two functions
-- while the mechanism that produced it went on producing it: every
-- `security definer` function written since has started life callable by any
-- browser, and the next one like those two would arrive the same way.
--
-- NOTHING BREAKS, BECAUSE A DEFAULT PRIVILEGE APPLIES ONLY AT CREATE TIME. The
-- seven helpers a policy legitimately needs — `is_admin`, `open_job_ids`,
-- `provider_can_serve`, `provider_refused`, `provider_serves`,
-- `provider_works_trade`, `session_is_verified` — each already carry an explicit
-- `grant execute ... to authenticated` in the migration that created them,
-- written that way because a policy expression is evaluated with the CALLER's
-- privileges and Supabase's Security Advisor keeps asking for the grant to be
-- taken away. They keep it. What changes is that the eighth helper has to say
-- so, and a `security definer` function that says nothing is callable by
-- nobody but the server.
--
-- THE TRAP IS THE SAME ONE THE TABLE HALF CREATED, so it is written down here
-- and in CLAUDE.md: after this, a new function a policy calls fails with
-- `42501 permission denied` until its migration grants EXECUTE. That is the
-- loud direction. The quiet direction is what this closes.
--
-- AND THE SEVEN TRIGGER FUNCTIONS THAT ALREADY HAVE IT LOSE IT. A trigger
-- function cannot be called directly — Postgres answers "trigger functions can
-- only be called as triggers" — so none of these was reachable, and that is a
-- property of the function's return type rather than of the privilege, which is
-- precisely the reasoning `20261016000002` refuses to accept about TRUNCATE.
-- `20260903000001` revoked the same grant from the five trigger functions that
-- existed then; these seven were written afterwards and inherited it from the
-- default. Firing a trigger does not re-check EXECUTE against the caller —
-- Postgres checks that when the trigger is created — so every one of these goes
-- on firing, which `tests/db/booking-rls.test.ts` already asserts rather than
-- assumes.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

revoke execute on function public.enforce_application_immutability()
  from public, anon, authenticated;
revoke execute on function public.enforce_claim_eligibility()
  from public, anon, authenticated;
revoke execute on function public.enforce_claim_transition()
  from public, anon, authenticated;
revoke execute on function public.enforce_confirmation_integrity()
  from public, anon, authenticated;
revoke execute on function public.freeze_quote_after_work()
  from public, anon, authenticated;
revoke execute on function public.refuse_rewrite()
  from public, anon, authenticated;
revoke execute on function public.sync_provider_on_job()
  from public, anon, authenticated;
