-- What the live database's functions ACTUALLY are, so drift becomes a URL.
--
-- `check:migrations` polices the tree against itself: nothing destructive goes
-- unannounced and no function quietly loses a line. It cannot see the other
-- axis — a function whose LIVE body no longer matches the tree, because
-- somebody applied something never committed, or edited it in a dashboard.
--
-- THAT AXIS HAS NO LOCAL CHECK AND CANNOT HAVE ONE. Migrations are applied
-- through an MCP connection from a sandbox whose egress policy blocks the
-- database over HTTPS, so nothing running in `npm run verify` can compare the
-- two. `/api/health` runs in production and can. Same reasoning as
-- `server.region`: the fault lives in somebody else's dashboard, no local check
-- can see it, and a URL needs no checkout to read.
--
-- HASHED ON THE MEANINGFUL LINES ONLY, matching `meaningful()` in
-- scripts/check-migrations.mjs exactly: trimmed, blanks dropped, comment lines
-- dropped. A comment edited in the live copy is not a behaviour change, and a
-- check that fires on one is a check somebody switches off.

create or replace function public.function_fingerprints()
returns table (name text, sha text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.proname::text,
    substring(
      encode(
        sha256(
          convert_to(
            coalesce(
              (
                select string_agg(line, chr(10) order by ord)
                  from (
                    select btrim(l) as line, ord
                      from regexp_split_to_table(p.prosrc, chr(10))
                        with ordinality as t(l, ord)
                     where btrim(l) <> ''
                       and left(btrim(l), 2) <> '--'
                       and left(btrim(l), 1) <> '*'
                       and left(btrim(l), 2) <> '/*'
                       and btrim(l) <> '*/'
                  ) kept
              ),
              ''
            ),
            'utf8'
          )
        ),
        'hex'
      ),
      1, 16
    )
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.prokind = 'f';
$$;

comment on function public.function_fingerprints() is
  'Each public function and a short hash of its meaningful lines, so /api/health can tell production''s definitions from the ones in supabase/migrations. Drift means somebody applied or edited something that is not in the tree.';

-- Support's number, and the service role's alone: it is a shape report about
-- the schema, which nobody signed in has any reason to enumerate.
revoke execute on function public.function_fingerprints() from public, anon, authenticated;
