-- REMOVES: function_fingerprints — the six `btrim(l)` lines, each replaced by
--   `btrim(l, E' \t\r\n')` one line below it. Nothing is dropped; every test
--   gains a second argument.

-- The fingerprint check cried wolf on its first real run, and it was my bug.
--
-- `/api/health` reported `db.functions: down` — "11 differ from this build …
-- Something was applied or edited outside supabase/migrations" — and took the
-- whole endpoint red. NOTHING had been applied or edited outside the tree. A
-- false alarm on the one URL that answers "can this serve a customer right
-- now" is worse than no check at all, because the next real one gets ignored.
--
-- THE CAUSE: CRLF. Eleven of the fifty live functions carry `\r\n` line
-- endings, and they are exactly the eleven that were flagged. `btrim(l)` with
-- no second argument trims SPACES ONLY, so every line kept a trailing `\r` and
-- hashed differently from the JS side, where `String.prototype.trim()` strips
-- it. Two normalisations that were meant to be identical, and were not.
--
-- WHY THE HAND-CHECK MISSED IT, which is the part worth remembering. Five
-- functions were compared by hand before the route was written and all five
-- matched — but all five were ones applied that same day over the MCP
-- connection, which writes LF. The sample that proved the two sides agreed was
-- drawn entirely from the half that could not disagree. The harness has the
-- same blind spot: it applies migrations from the tree, so every function in it
-- is LF and this is unreproducible there by accident. The regression test
-- therefore creates a function with a deliberately CRLF body — the only shape
-- that fails before this migration and passes after.

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
                    select btrim(l, E' \t\r\n') as line, ord
                      from regexp_split_to_table(p.prosrc, chr(10))
                        with ordinality as t(l, ord)
                     where btrim(l, E' \t\r\n') <> ''
                       and left(btrim(l, E' \t\r\n'), 2) <> '--'
                       and left(btrim(l, E' \t\r\n'), 1) <> '*'
                       and left(btrim(l, E' \t\r\n'), 2) <> '/*'
                       and btrim(l, E' \t\r\n') <> '*/'
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
  'Each public function and a short hash of its meaningful lines, so /api/health can tell production''s definitions from the ones in supabase/migrations. Trims CR as well as spaces: eleven live functions carry CRLF and hashing them as-is reported drift that did not exist.';

revoke execute on function public.function_fingerprints() from public, anon, authenticated;
