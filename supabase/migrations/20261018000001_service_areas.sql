-- ---------------------------------------------------------------------------
-- The service areas, as a table a person can add to and retire from.
--
-- WHY IT WAS A FILE UNTIL NOW, AND WHY THAT HAD TO END. `lib/config/areas.ts`
-- imports `seed/areas.json` at module scope, and its own comment has said since
-- it was written: "A small fixed list for now... When this becomes a table (it
-- will, with provider coverage maps), the shape below is what it should return."
-- This is that table, and the shape is that shape. Until it existed, opening a
-- new ward meant editing JSON, running a migration and a deploy — so the answer
-- to "we have a plumber in Kirtipur now" was a code change.
--
-- RETIRE, NEVER DELETE, and the column pair is what makes that structural.
-- Every `addresses.area_key` and every `provider_leads.area_key` already written
-- names one of these, and `provider_serves` matches `providers.service_areas`
-- against them — so removing a row would orphan live bookings, break the
-- dispatch coverage check and make an old booking page unable to say where the
-- job was. `retired_at` hides an area from every NEW choice and changes nothing
-- that already happened.
--
-- THE TWO READS ARE DIFFERENT QUESTIONS AND HAVE DIFFERENT FAILURE POSTURES,
-- which is the design worth recording here rather than only in the data layer.
-- CHOOSING an area (a customer adding an address, a professional naming where
-- they work) must offer only live ones, and a read that failed must refuse
-- rather than serve the seed — the seed cannot know what somebody retired last
-- week, and offering a withdrawn ward takes a booking nobody will travel to.
-- LABELLING an area (an old booking, a provider card) must find every area ever,
-- retired included, and there the seed is a perfectly good fallback: a place
-- name does not go stale, and the key is already frozen on the row.
--
-- NO COORDINATES HERE, deliberately. `seed/area-centroids.json` carries them
-- with their provenance — OSM ward boundary relations, with a `fetchedAt` — and
-- `scripts/fetch-ward-centroids.mjs` is how they arrive. A lat/lng column on
-- this table would let an admin type a pair, and an invented centroid is
-- indistinguishable from a fetched one in the ranking that reads it. The cost is
-- stated instead: a ward added here scores on its ward alone until somebody
-- runs that script, which is the same answer `pricing_source` gives for a band.
-- ---------------------------------------------------------------------------

create table if not exists public.areas (
  -- "lalitpur-4" — city slug and ward number. It is the key every address,
  -- lead, coverage array and centroid already uses, so it is not regenerable.
  key text primary key,

  city text not null,
  city_ne text not null,
  ward_number integer not null,
  -- The name people say out loud. Place names are data, not interface copy:
  -- a translator adding a locale is not handed fifteen neighbourhoods.
  name text not null,
  name_ne text not null,

  -- Display order, so the three cities read as three groups in a stable order.
  sort_order integer not null default 0,

  -- RETIRED, NOT REMOVED. All three move together or none does: see
  -- `areas_retired_shape`. Null in all three is the ordinary case - an area we
  -- still serve - and never "retired for no reason".
  retired_at timestamptz,
  retired_reason text,
  retired_by uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now()
);

alter table public.areas enable row level security;

revoke all on table public.areas from public, anon, authenticated;

-- ------------------------------------------------------------ constraints ---

alter table public.areas
  drop constraint if exists areas_ward_positive;
alter table public.areas
  add constraint areas_ward_positive check (ward_number > 0);

/*
 * THE KEY'S SHAPE IS REFUSED RATHER THAN TRUSTED, because it is not an id we
 * generate — it is the string `addresses.area_key`, `providers.service_areas`
 * and `area-centroids.json` all already hold. An admin typing "Kathmandu 4" or
 * "ktm-4" would create an area that looks right on the screen and matches
 * nothing: no centroid, no coverage array, and `provider_serves` silently
 * finding nobody. All fifteen live keys were checked against this pattern
 * before it was added.
 */
alter table public.areas
  drop constraint if exists areas_key_shape;
alter table public.areas
  add constraint areas_key_shape check (key ~ '^[a-z]+(-[a-z]+)*-[0-9]+$');

/*
 * A RETIREMENT IS A DATE, A REASON AND AN ACTOR, OR IT IS NOTHING.
 *
 * Rule 6 in the shape it takes for a pair, which `bookings_holdback_shape`
 * already uses one table over. A `retired_at` with no reason is a withdrawal
 * nobody can answer a question about later — "why did we stop serving ward 26"
 * is exactly what somebody asks six months on — and a reason with no date hides
 * an area that is not actually retired. The actor is in the triple because
 * "who decided" is the other half of an append-only story; null only if that
 * profile is later deleted.
 */
alter table public.areas
  drop constraint if exists areas_retired_shape;
alter table public.areas
  add constraint areas_retired_shape check (
    (retired_at is null and retired_reason is null)
    or (retired_at is not null
        and retired_reason is not null
        and length(btrim(retired_reason)) > 0)
  );

comment on table public.areas is
  'Service areas at ward level. Retired, never deleted: addresses, provider leads and coverage arrays all hold these keys. See lib/data/areas.ts for the two reads - choosing (live only, refuses on a failed read) and labelling (every area ever, seed is a fine fallback).';
comment on column public.areas.retired_at is
  'Set when we stop taking NEW work in this ward. Changes nothing that already happened. Null is "we still serve it", never "unknown".';

-- ------------------------------------------------------------ policies ---

/*
 * ANYBODY MAY READ IT, including a signed-out visitor, because this is the
 * public catalogue in the same sense `categories` is: `/providers/join` lists
 * the wards before anybody has an account, and the booking flow's address
 * picker is reached by a customer who has only just signed in. Retired rows
 * come back too — a public page may have to name the ward an old booking was
 * in, and hiding the row would make that page unable to say where the job was.
 */
drop policy if exists "Service areas are public" on public.areas;
create policy "Service areas are public"
  on public.areas for select to anon, authenticated
  using (true);

/*
 * A NEW TABLE GRANTS NOTHING UNTIL IT SAYS SO — `20261002000001` closed the
 * default privilege, so the policy above decides which rows and this decides
 * whether anybody may ask at all. SELECT only: every write is the service role
 * through `lib/data/areas.ts`, behind a fresh second factor, because retiring a
 * ward stops new work for every professional in it.
 */
grant select on table public.areas to anon, authenticated;

-- ------------------------------------------------------------ the bootstrap ---

/*
 * THE FIFTEEN LAUNCH WARDS, from `lib/data/seed/areas.json`.
 *
 * After this, the TABLE is the source of truth and that JSON is two other
 * things: what a clone with no Supabase keys renders, and what a LABEL read
 * falls back to. It is deliberately NOT wired into `scripts/generate-seed-sql.mjs`
 * — an admin opening a ward writes a row here, and a generator that rewrites
 * this list from the file would be a second author racing the first. The two
 * cannot drift silently: `tests/db/service-areas.test.ts` compares the keys
 * seeded below against the JSON.
 *
 * `on conflict do nothing` rather than `do update`: re-applying must not undo a
 * retirement or a rename somebody made on the screen.
 */
insert into public.areas
  (key, city, city_ne, ward_number, name, name_ne, sort_order)
values
  ('kathmandu-4', 'Kathmandu', 'काठमाडौँ', 4, 'Baluwatar', 'बालुवाटार', 0),
  ('kathmandu-7', 'Kathmandu', 'काठमाडौँ', 7, 'Chabahil', 'चाबहिल', 10),
  ('kathmandu-10', 'Kathmandu', 'काठमाडौँ', 10, 'New Baneshwor', 'नयाँ बानेश्वर', 20),
  ('kathmandu-14', 'Kathmandu', 'काठमाडौँ', 14, 'Kalanki', 'कलंकी', 30),
  ('kathmandu-16', 'Kathmandu', 'काठमाडौँ', 16, 'Swayambhu', 'स्वयम्भू', 40),
  ('kathmandu-26', 'Kathmandu', 'काठमाडौँ', 26, 'Thamel', 'ठमेल', 50),
  ('kathmandu-31', 'Kathmandu', 'काठमाडौँ', 31, 'Koteshwor', 'कोटेश्वर', 60),
  ('kathmandu-32', 'Kathmandu', 'काठमाडौँ', 32, 'Sinamangal', 'सिनामंगल', 70),
  ('lalitpur-3', 'Lalitpur', 'ललितपुर', 3, 'Kupondole', 'कुपन्डोल', 80),
  ('lalitpur-4', 'Lalitpur', 'ललितपुर', 4, 'Jhamsikhel', 'झम्सिखेल', 90),
  ('lalitpur-10', 'Lalitpur', 'ललितपुर', 10, 'Satdobato', 'सातदोबाटो', 100),
  ('lalitpur-14', 'Lalitpur', 'ललितपुर', 14, 'Ekantakuna', 'एकान्तकुना', 110),
  ('bhaktapur-4', 'Bhaktapur', 'भक्तपुर', 4, 'Dattatreya', 'दत्तात्रय', 120),
  ('bhaktapur-6', 'Bhaktapur', 'भक्तपुर', 6, 'Kamalbinayak', 'कमलविनायक', 130),
  ('bhaktapur-9', 'Bhaktapur', 'भक्तपुर', 9, 'Sallaghari', 'सल्लाघारी', 140)
on conflict (key) do nothing;
