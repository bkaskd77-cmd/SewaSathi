-- ---------------------------------------------------------------------------
-- The two ledger aggregates stop being callable by every signed-in user.
--
-- WHAT WAS OPEN. `provider_outstanding` and `provider_balance` are
-- `security definer`, so they do not consult the policies on
-- `provider_ledger` — and both had `execute` for `authenticated`. Any signed-in
-- customer could call either with any professional's id and get their number
-- back. Proven against production as `authenticated`, with the test customer's
-- id in the JWT claim and a provider id that was not theirs: the call returned
-- a row rather than being refused.
--
-- THE POLICIES WERE NEVER THE PROBLEM. They are exactly right:
--
--   Providers read their own ledger   p.profile_id = auth.uid()
--   Admins read every ledger entry    is_admin()
--
-- Row reads were scoped. The AGGREGATE over the same rows was not, which is the
-- `listBookings()` lesson one layer down: RLS is a floor, and a `security
-- definer` function standing on top of it answers to nothing but its own grant.
--
-- WHAT LEAKED, once there are rows: a professional's guarantee debt and their
-- signed money position. Personal financial data about somebody else — and
-- under the payout plan, the arrears figure that will pause their dispatch.
-- `provider_ledger` is empty today, so nothing has been disclosed; what was
-- wrong is that the door was open, not that somebody walked through it.
--
-- WHY THIS COSTS NOTHING. No production caller uses the grant. Both call sites
-- already hold the service role — `lib/data/provider-profile.ts` and
-- `lib/data/claim-signals.ts`, each `admin.rpc(...)` on `createAdminClient()`.
-- The grant served nobody except somebody enumerating provider ids.
--
-- AND `provider_balance` INHERITED IT ONE DAY OLD. It was written yesterday in
-- `20260929000001_ledger_kinds.sql` copying `provider_outstanding`'s shape
-- without asking what the definer was bypassing, and the reasoning recorded for
-- it — "a professional reads their own balance on their dashboard" — was wrong
-- on its face: that view is server-rendered and reads through the service role
-- like every other money surface. A pattern copied is not a pattern examined.
-- ---------------------------------------------------------------------------

revoke execute on function public.provider_outstanding(uuid) from authenticated;
revoke execute on function public.provider_balance(uuid) from authenticated;

comment on function public.provider_outstanding(uuid) is
  'Guarantee debt still owed. SERVER-SIDE ONLY: security definer, so it bypasses provider_ledger''s policies, and execute is revoked from anon and authenticated. Reach it through the service role.';

comment on function public.provider_balance(uuid) is
  'Signed net position: positive means we owe them, negative means they owe us. Guarantee kinds are excluded on purpose — provider_outstanding is that number, and a redo debt is never an arrears signal. SERVER-SIDE ONLY, for the same reason: security definer over a table whose policies it does not consult.';
