-- Supabase's Security Advisor, worked through rather than silenced.
--
-- Fifteen warnings, no errors. None of them was an open door — no data was
-- readable by anyone who should not have had it, which the RLS suite already
-- proves. What they are is hardening, and all but one is worth taking.
--
-- Three groups:
--
--   1. FUNCTION SEARCH PATH MUTABLE — three functions ran with whatever
--      `search_path` the caller happened to have. For a SECURITY DEFINER
--      function that is the classic privilege escalation: the caller points
--      `search_path` at a schema they control and shadows a function the body
--      calls. These three are SECURITY INVOKER, so the exploit is thin, but
--      the fix costs nothing.
--
--   2. SEARCH PATH = public ON SECURITY DEFINER — not flagged, fixed anyway.
--      `public` is weaker than empty whenever anyone can create objects in it.
--      Every reference in these bodies was already schema-qualified, so
--      emptying the path is a one-line change with nothing to chase.
--
--   3. PUBLIC / SIGNED-IN USERS CAN EXECUTE SECURITY DEFINER — Postgres grants
--      EXECUTE to PUBLIC on every new function, and Supabase goes further: a
--      default privilege on the `public` schema grants it *directly* to `anon`
--      and `authenticated`. Both have to be revoked. The first version of this
--      file revoked only from PUBLIC, which is why nine warnings survived it —
--      the direct grants were still there, untouched. Calling a trigger
--      function by hand fails anyway ("trigger functions can only be called as
--      triggers"), so this was never much of a door, but a function nobody is
--      supposed to call by hand should not be callable by hand.
--
-- The one warning NOT taken, and why: `is_admin()` must stay executable by
-- `authenticated`. It is called from inside the RLS policies on profiles,
-- triage_logs, bookings, payments, refunds and booking_status_history, and
-- policy expressions are evaluated with the *caller's* privileges. Revoking
-- it, as the advisor suggests, would make every one of those policies fail
-- with a permission error — it would break reads for every signed-in user in
-- the product. It is revoked from PUBLIC and granted back to `authenticated`
-- explicitly, which is as far as it can safely go. The advisor will keep
-- reporting "Signed-In Users Can Execute" for it; that report is correct and
-- the answer is no.
--
-- "Leaked Password Protection Disabled" does not apply to us at all: this
-- product is phone + OTP only and has no password path anywhere.

-- 1. Pin the mutable ones. Empty rather than `public`: nothing in these bodies
--    is unqualified except `now()`, which lives in pg_catalog and is always
--    searched first regardless.
alter function public.booking_transition_allowed(text, text) set search_path = '';
alter function public.payment_transition_allowed(text, text) set search_path = '';
alter function public.touch_updated_at() set search_path = '';

-- 2. Tighten the three that were already pinned, but only to `public`.
alter function public.enforce_booking_transition() set search_path = '';
alter function public.enforce_payment_transition() set search_path = '';
alter function public.record_booking_status() set search_path = '';

-- 3. Take away the grants: PUBLIC *and* the two direct ones Supabase adds.
--
--    Firing a trigger does not re-check EXECUTE on its function — Postgres
--    checks that when the trigger is created — so revoking here does not stop
--    a booking being inserted or a payment settling. That is asserted rather
--    than assumed: tests/db/booking-rls.test.ts drives a full insert and a
--    status transition as `authenticated` after this migration has applied,
--    and fails if either stops working. The harness models Supabase's default
--    privileges, so a revoke that misses the direct grants fails there too —
--    which is how the first version of this file was caught.
--
--    `service_role` keeps its grant. It is not what the advisor is asking
--    about, and `handle_new_user` fires on `auth.users` during signup.
revoke execute on function public.enforce_booking_transition() from public, anon, authenticated;
revoke execute on function public.enforce_payment_transition() from public, anon, authenticated;
revoke execute on function public.record_booking_status() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

--    The two transition predicates are only ever called from inside the
--    SECURITY DEFINER triggers above, which run as the function owner, so the
--    caller's grant is irrelevant to them.
revoke execute on function public.booking_transition_allowed(text, text) from public, anon, authenticated;
revoke execute on function public.payment_transition_allowed(text, text) from public, anon, authenticated;

--    is_admin(): everyone loses it, `authenticated` gets it straight back, for
--    the reason at the top of this file. Granted explicitly so the intent is in
--    the schema rather than in someone's memory.
revoke execute on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
