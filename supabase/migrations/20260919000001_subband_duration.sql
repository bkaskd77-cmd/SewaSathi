-- How long a job takes, on the one table that already knows what a job is.
--
-- THIS IS THE FIELD `ARCHITECTURE.md` NAMES AS STRUCTURAL. Two systems have
-- been working around its absence. The scheduler can only express "how many
-- two-hour windows at once", so `categories.max_concurrent_jobs` carries
-- painting's 3 — which means "do not block a painter while the first job
-- dries", never "a painter paints three flats". And the pricing sub-bands
-- already split painting into labour-only and paint-supplied, where the thing
-- that actually separates them is how long the work takes.
--
-- TWO NUMBERS, NOT ONE, AND THAT IS THE WHOLE DESIGN. `typical_working_minutes`
-- is how long the professional is on the tools — it fills their calendar.
-- `typical_elapsed_days` is how long the customer's home is a building site —
-- it is what they plan around. For nine trades the second is 1 and only the
-- first matters. For painting they diverge by a factor of four, because putty
-- dries, primer cures and coats need hours between them: the room is occupied
-- for four days and the painter for a few hours of each. One number cannot say
-- both, and pretending otherwise is what the concurrency cap was doing.
--
-- MINUTES RATHER THAN HOURS. The slot maths is already in minutes, and hours
-- force a false rounding — a tap leak is neither one hour nor two.
--
-- ITS OWN PROVENANCE, SEPARATE FROM THE PRICE'S. Researching what a job costs
-- is not researching how long it takes; one provenance covering both would
-- launder a guessed duration under a researched price's confidence. EVERY ROW
-- BELOW IS `invented` — nobody in Nepal publishes how long a tap leak takes —
-- which is precisely why no customer is shown one of these numbers. The
-- scheduler may use an invented duration, because a reservation nobody reads
-- is not a claim; a screen may not. `hasPublishableDuration` in
-- `lib/provider/measured.ts` is the one place that decides which is which,
-- and `check:blockers` keeps the gap visible until somebody does the research.
--
-- The table's own DDL lives in scripts/generate-seed-sql.mjs, so a fresh
-- project creates these columns outright and the alters below no-op. They are
-- here for the project that already has the table.

-- ---------------------------------------------------------------------------
-- Nullable first, then filled, then required
-- ---------------------------------------------------------------------------
--
-- 36 rows already exist, so a NOT NULL column with no default cannot simply be
-- added. Added nullable, filled from the same authored JSON the seed uses, and
-- only then made required — which is also the order that proves every row got
-- a value rather than a default standing in for one.

alter table public.category_price_bands
  add column if not exists typical_working_minutes integer,
  add column if not exists typical_elapsed_days integer,
  add column if not exists duration_source text not null default 'invented',
  add column if not exists duration_checked_at date,
  add column if not exists duration_confidence text not null default 'low',
  add column if not exists duration_note text;

update public.category_price_bands set
  typical_working_minutes = v.minutes,
  typical_elapsed_days = v.days,
  duration_note = v.note
from (values
  ('plumbing', 'inspection', 30, 1, 'A look and a verdict. No published figure; the fee itself implies a short visit.'),
  ('plumbing', 'leak', 45, 1, 'A washer or a joint. Guessed from the job, not from a source.'),
  ('plumbing', 'blockage', 90, 1, 'Rodding and clearing. Guessed.'),
  ('plumbing', 'pipe-work', 120, 1, 'Cutting, fitting and testing one run. Guessed.'),
  ('plumbing', 'geyser', 90, 1, 'Mounting or stripping one unit. Guessed.'),
  ('plumbing', 'no-water', 90, 1, 'Tracing the fault is most of it. Guessed.'),
  ('plumbing', 'burst', 180, 1, 'Stopping it, then making good. Guessed, and the spread is real.'),
  ('electrical', 'fitting', 30, 1, 'One point. Guessed.'),
  ('electrical', 'mcb', 45, 1, 'Guessed.'),
  ('electrical', 'decorative', 120, 1, 'Depends entirely on how many points. Guessed.'),
  ('electrical', 'fault', 120, 1, 'Finding it is the work. Guessed.'),
  ('electrical', 'rewiring', 480, 2, 'Chasing, running and making good does not finish in a day. Guessed, and the second day is the least certain number here.'),
  ('home-cleaning', 'single-room', 90, 1, 'Guessed.'),
  ('home-cleaning', 'standard', 240, 1, 'Two people for half a day, or one for a full one. Guessed.'),
  ('home-cleaning', 'deep', 480, 1, 'A full day. Guessed.'),
  ('appliance-repair', 'diagnosis', 45, 1, 'Guessed.'),
  ('appliance-repair', 'repair', 120, 1, 'Guessed; excludes waiting for a part, which is not our time.'),
  ('appliance-repair', 'major', 180, 1, 'Guessed.'),
  ('carpentry', 'small-fitting', 45, 1, 'Guessed.'),
  ('carpentry', 'door-window', 180, 1, 'Guessed.'),
  ('carpentry', 'furniture-repair', 180, 1, 'Guessed.'),
  ('carpentry', 'built-in', 600, 2, 'Building in place. Guessed, and the second day is a guess on top of a guess.'),
  ('pest-control', 'cockroach', 60, 1, 'The spray is quick; the hours the customer must stay out are not our time and are not counted here.'),
  ('pest-control', 'bed-bugs', 120, 1, 'Guessed.'),
  ('pest-control', 'termite', 180, 1, 'Drilling and injecting. Guessed.'),
  ('painting', 'touch-up', 180, 1, 'One wall, one coat. Guessed.'),
  ('painting', 'room-labour', 480, 2, 'Two coats with drying between them, so it does not fit in one day even though the hands-on time would. THIS IS THE CASE THE WHOLE MODEL EXISTS FOR.'),
  ('painting', 'room-supplied', 960, 4, 'Putty, primer and two coats, each needing the last to cure. Four days of the room being unusable for roughly two days of work.'),
  ('painting', 'flat', 3600, 7, 'Same sequence, more rooms, and they overlap. The span is the number a customer plans around.'),
  ('ac-servicing', 'repair', 60, 1, 'Guessed.'),
  ('ac-servicing', 'service', 90, 1, 'Guessed.'),
  ('ac-servicing', 'gas', 120, 1, 'Guessed.'),
  ('ac-servicing', 'install', 240, 1, 'Drilling, mounting, bracket and vacuum. Guessed.'),
  ('water-tank-cleaning', 'overhead', 90, 1, 'Guessed.'),
  ('water-tank-cleaning', 'underground', 180, 1, 'Draining is most of it. Guessed.'),
  ('water-tank-cleaning', 'combined', 300, 1, 'Guessed.')
) as v(category_slug, slug, minutes, days, note)
where public.category_price_bands.category_slug = v.category_slug
  and public.category_price_bands.slug = v.slug;

alter table public.category_price_bands
  alter column typical_working_minutes set not null,
  alter column typical_elapsed_days set not null;

-- Guarded because the fresh-project DDL already carries these under the same
-- names, and `add constraint` has no `if not exists`.
do $$
declare
  c record;
begin
  for c in select * from (values
    ('category_price_bands_typical_working_minutes_check', 'typical_working_minutes > 0'),
    ('category_price_bands_typical_elapsed_days_check', 'typical_elapsed_days between 1 and 30'),
    ('category_price_bands_duration_source_check', $c$duration_source in ('invented', 'researched', 'observed')$c$),
    ('category_price_bands_duration_confidence_check', $c$duration_confidence in ('high', 'medium', 'low')$c$)
  ) as v(name, expr)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = 'public.category_price_bands'::regclass and conname = c.name
    ) then
      execute format(
        'alter table public.category_price_bands add constraint %I check (%s)',
        c.name, c.expr
      );
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- What the notes say
-- ---------------------------------------------------------------------------

comment on column public.category_price_bands.typical_working_minutes is
  'How long the professional is on the tools. Fills their calendar. Minutes, not hours: the slot maths is in minutes and hours force a false rounding.';
comment on column public.category_price_bands.typical_elapsed_days is
  'How long the customer''s home is a building site. What they plan around. 1 for nine trades; painting is why the column exists — a room takes four days and a painter a few hours of each.';
comment on column public.category_price_bands.duration_source is
  'DELIBERATELY SEPARATE FROM pricing_source. Researching a price is not researching a duration, and one provenance for both would launder a guess under a researched figure''s confidence. Every row is invented today, so no customer sees a duration — see hasPublishableDuration in lib/provider/measured.ts.';
comment on column public.category_price_bands.duration_note is
  'Where the number came from, or the admission that it came from nowhere. A figure whose provenance is a commit message is a figure nobody can re-derive.';
