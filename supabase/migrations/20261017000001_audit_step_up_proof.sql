-- ---------------------------------------------------------------------------
-- What the gate saw, recorded beside what the actor did.
--
-- THE GAP, NAMED IN THE PRE-LAUNCH AUDIT AS THE FIRST THING IT DID NOT FIX.
-- `freshAdminActor()` refuses a money action without an `amr` timestamp inside
-- `REAUTH_WINDOW_MINUTES` — fifteen minutes, read off the session's own claim.
-- The row written afterwards said who decided, when, and on what; it said
-- nothing about whether they had been challenged. So a reviewer reconstructing
-- a disputed refund could see the decision and had to take the gate on trust,
-- which is the one thing a log exists to remove.
--
-- NULL IS "NOT RECORDED" AND IS THE COMMON CASE BY DESIGN. A cron sweep, a
-- gateway callback and every row written before this column existed all have no
-- session to read, and `lib/audit` never throws — so the absence has to stay
-- readable as an absence. Reading it as "nobody was challenged" manufactures a
-- finding; reading it as "they were" manufactures a clean record. Rule 6, on a
-- column where both errors are expensive.
--
-- NOTHING IS BACKFILLED, for the reason `profiles_record_role_change` already
-- records: a proof invented for a decision nobody witnessed is the clean record
-- this column exists to make impossible.
--
-- IT IS NOT A CONSTRAINT AND DELIBERATELY NOT. The temptation is to refuse an
-- admin money row with a null proof — and that would put `lib/audit`'s one
-- guarantee at risk, which is that it never throws and never rolls back the
-- thing it is logging. The gate is what refuses; this only records.
--
-- Applied with `apply_migration`; one `alter table add column` and two
-- comments, nothing destructive.
-- ---------------------------------------------------------------------------

alter table public.security_events
  add column if not exists proved_at timestamptz;

comment on column public.security_events.proved_at is
  'When the acting session last proved who it is (the amr claim), as the gate read it. Null is "not recorded" — a cron, a callback, or a row older than this column — and never "unproven".';
