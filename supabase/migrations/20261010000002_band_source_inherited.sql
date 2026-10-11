-- A band with nobody who named it, and the path that produced one.
--
-- WHAT WAS FOUND. `SK-RDKW7` carries `band_slug = 'burst'` and
-- `band_source = NULL`, created on 2026-09-20 — two days AFTER
-- `band_source_customer` added the column and its constraint, so it is not the
-- usual "the column shipped after the product" silence. A path really does
-- write a product without recording who named it.
--
-- The path is `lib/data/claims.ts`: a guarantee visit copies the parent
-- booking's `band_slug` so the callback is the same product as the job it is
-- putting right, and copies no source. The comment there already explains why
-- the band and the quote model travel together; the source was simply not in
-- the list.
--
-- `inherited` IS A FOURTH VALUE RATHER THAN A COPIED ONE, and that is the whole
-- decision. The parent's band may have been named by the model, the matcher or
-- the customer — and NONE of them said anything about the visit. Writing
-- `customer` onto a row no customer answered manufactures a statement nobody
-- made, which is rule 6 in the shape it takes for provenance: the column must
-- say how we know, and "we copied it from the job this is fixing" is a
-- different way of knowing from "they told us".
--
-- It matters downstream rather than cosmetically. The duration loop learns per
-- sub-band from completed work, and a guarantee visit is the SAME fault being
-- revisited — counting its duration as independent evidence about `burst`
-- would be double-counting one job. A source that says `inherited` is what
-- lets that filter exist at all.
--
-- NOTHING IS BACKFILLED. `SK-RDKW7` keeps its null, because a source invented
-- for a row written before anything recorded one is the manufactured clean
-- record `profiles_record_role_change` refuses. The constraint below is
-- therefore NOT VALID: it binds every row written from now on and leaves the
-- one historical row exactly as it is — which is the Postgres idiom for "no
-- backfill, and new rows must comply".

alter table public.bookings
  drop constraint if exists bookings_band_source_check;

alter table public.bookings
  add constraint bookings_band_source_check
  check (
    band_source is null
    or band_source in ('model', 'matcher', 'customer', 'inherited')
  );

-- A PRODUCT WITHOUT A PROVENANCE IS NOT WRITABLE ANY MORE.
--
-- NOT VALID so the single historical row stands. Postgres enforces it on every
-- INSERT and UPDATE regardless; `not valid` only means it does not re-check
-- rows that already exist. Validating it later would require deciding what
-- `SK-RDKW7`'s source was, and nobody knows.
alter table public.bookings
  drop constraint if exists bookings_band_needs_source;

alter table public.bookings
  add constraint bookings_band_needs_source
  check (band_slug is null or band_source is not null)
  not valid;

comment on column public.bookings.band_source is
  'How we know which product this is: model, matcher, customer, or inherited from the booking a guarantee visit is putting right. Null only on rows written before anything recorded it — bookings_band_needs_source refuses a new one. `inherited` is deliberately not the parent''s own source: nobody named the product for THIS booking, and a duration loop that counted a guarantee visit as fresh evidence would be double-counting one job.';
