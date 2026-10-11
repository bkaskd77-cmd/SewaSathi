/**
 * How the database refuses a write a browser must not make.
 *
 * TWO LOCKS, AND WHICH ONE SPEAKS FIRST IS NOT THE INTERESTING PART.
 *
 * Until `20261011000004`, a table a browser had no business writing was
 * protected by having no write policy — the privilege was there, because
 * Supabase's default granted `anon` and `authenticated` INSERT and UPDATE on
 * every table in `public`, and RLS was what refused. So these tests asserted
 * `new row violates row-level security policy`, which was the true sentence.
 *
 * That migration revoked the privilege schema-wide and granted back only the
 * columns the product writes, so the refusal is now the planner's —
 * `42501 permission denied for table X`, before a row, a policy or a trigger is
 * considered. Both locks are shut; which one answers is an implementation
 * detail of Postgres's ordering and will change again the next time a lock is
 * added, which is good news rather than a regression.
 *
 * SO THE BEHAVIOURAL TESTS ASSERT THE REFUSAL AND NOT THE WORDING, through one
 * constant rather than twenty hand-written unions — three spellings of this
 * regex were already in the suite and they had begun to drift. The MECHANISM is
 * pinned separately and exactly, in `tests/db/write-grants.test.ts`: that no
 * table outside the allow-list has a write policy, and that neither browser
 * role holds a write privilege outside the columns the allow-list names. A
 * behavioural test that pins a sentence tests the wording; those two test the
 * locks.
 */
export const BROWSER_WRITE_REFUSED = /permission denied|row-level security/i;
