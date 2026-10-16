-- ---------------------------------------------------------------------------
-- The three verbs the last sweep left behind.
--
-- WHAT WAS STILL OPEN, read live on 2026-10-16 before this ran: `anon` and
-- `authenticated` each held TRUNCATE and TRIGGER on 36 tables and REFERENCES on
-- 36 and 37. Supabase's default privilege grants ALL on a new table in `public`,
-- and `20261011000004` named only the three verbs anybody had thought about —
-- insert, update, delete. The other three went on sitting there, on
-- `provider_ledger`, `payments`, `refunds`, `security_events`, `customer_risk`
-- and thirty more.
--
-- TRUNCATE IS THE ONE WORTH THE MIGRATION, and the reason is not that it is
-- reachable today: PostgREST has no truncate verb, so nothing in the product's
-- surface can issue one. It is that **TRUNCATE is not subject to row-level
-- security at all.** Every other write in this schema meets a policy before it
-- meets a row; this one empties the table with the policies looking on. So the
-- privilege is the only thing in front of it, and it was granted to both
-- browser roles on the append-only audit log.
--
-- That is the same argument `20261011000004` already made about DELETE, where
-- the answer was "a privilege for a verb the product does not have is 36 locks
-- left open for nothing" — and the DELETE case is the weaker of the two, since
-- a delete at least has to get past a policy that does not exist. The question
-- was asked about three verbs and not about six; this is the rest of the answer.
--
-- TRIGGER AND REFERENCES need DDL to use, which a browser role cannot reach, so
-- neither is a hole. They go for hygiene and for the reason this file keeps
-- recording: a privilege nobody can state a use for is one nobody will examine
-- the day something else changes. Revoking all three in one statement is also
-- what makes this one line rather than a judgement call per verb.
--
-- SELECT IS UNTOUCHED, as in every sweep before this: reads are what the
-- policies are for, and every public page depends on them. `service_role` is
-- not named, because it is how every server write in `lib/data/` reaches these
-- tables.
--
-- NEW TABLES ALREADY GRANT NOTHING — `20261002000001` revoked `all` from the
-- default privilege, so this is only ever about the tables that existed before
-- that ran. The two halves meet here for the last three verbs, the way they met
-- in `20261011000004` for the first three.
--
-- AND THERE IS A FOURTH, WHICH `information_schema` CANNOT SEE. PostgreSQL 17
-- added MAINTAIN — VACUUM, ANALYZE, REINDEX, CLUSTER, REFRESH MATERIALIZED
-- VIEW, LOCK TABLE — and Supabase's default grants it with the rest, so both
-- browser roles held it on 36 and 37 tables. `role_table_grants` does not list
-- it, which is why the first version of this migration missed it and the first
-- version of its test could not have caught it: the catalog view is the SQL
-- standard's and the privilege is newer than the standard. `aclexplode` is what
-- the test reads now, for exactly that reason.
--
-- It is guarded on the server version because the test harness is PostgreSQL 16,
-- where `revoke maintain` is a syntax error — so the one clause that cannot be
-- proven locally is the one that had to be written blind. It is verified against
-- production with `has_table_privilege(…, 'MAINTAIN')` instead, which is the
-- honest arrangement rather than a quieter one.
--
-- `tests/db/write-grants.test.ts` is what stops the rest coming back: it now
-- asserts the whole privilege set a browser role holds, rather than three verbs
-- of it, and `tests/support/postgres.ts` grants the default Supabase actually
-- grants — it modelled `select, insert, update` and so was blind to every verb
-- this migration is about.
-- ---------------------------------------------------------------------------

revoke truncate, trigger, references on all tables in schema public
  from anon, authenticated;

do $maintain$
begin
  if current_setting('server_version_num')::int >= 170000 then
    execute 'revoke maintain on all tables in schema public from anon, authenticated';
  end if;
end
$maintain$;
