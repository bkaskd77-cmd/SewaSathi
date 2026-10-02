-- REMOVES: freeze_booking_band — nothing. It gains the revision id beside
--   band_min and keeps every line of its latest definition: the survey branches
--   and the `booking_band_bounds` read. Declared because `check:migrations`
--   watches this function and a `create or replace` is a full rebuild.
--
--   THE FIRST DRAFT OF THIS FILE SILENTLY REVERTED IT, which is the trap
--   CLAUDE.md records for policies, one object type over. `freeze_booking_band`
--   is defined in `20260913000003_band_provenance.sql` and redefined in
--   `20260921000001_band_correction.sql`; the first is what a search finds first
--   and it knows nothing about `quote_model = 'survey'` or sub-band bounds.
--   Rebuilding from it would have dropped 17 lines and quietly restored a floor
--   read that `20260921000001` replaced on purpose — found by the fingerprint
--   check, not by reading. Rebuild from the LAST definition.

-- ---------------------------------------------------------------------------
-- Which band revision a booking was quoted under.
--
-- WHAT THIS ANSWERS THAT `band_min` DOES NOT. The floor is already frozen onto
-- every booking, so "was the band we published then right" is answerable. What is
-- not is "who decided that band, when, and on what evidence" — and that is the
-- question a dispute actually asks: a customer saying the quote was too high, or
-- a professional appealing a commission charged on a floor, both need the
-- decision rather than the number. `category_price_revisions` holds the decision;
-- this is the join.
--
-- NULL IS "NO REVISION ON RECORD", NEVER "UNKNOWN" — rule 6, and it is the
-- common case rather than an edge. Every band published today came from the
-- launch research recorded in `pricing_source` and `pricing_note`, not from a
-- revision, so every booking taken so far and every booking in a category nobody
-- has revised carries null. **Nothing is backfilled**: inventing a revision zero
-- would mean writing an actor and a reason nobody gave, which is the manufactured
-- clean record that `profiles_record_role_change` and the triage columns both
-- refuse. A screen reading this says "no revision — the band came from the launch
-- research" and points at the provenance columns; it does not print a blank.
--
-- FILLED BY THE TRIGGER, NOT THE CALLER, for the reason `band_min` is: a column
-- that silently becomes null the day somebody adds a second insert path is a
-- measurement that quietly stops measuring, and filling it here means the db
-- suite's own inserts carry it too.
--
-- ON UPDATE IT IS PINNED, exactly like `band_min`. "Frozen" is what makes this
-- worth having at all — a revision id that followed the category would re-date
-- every historical booking the moment somebody approved a new band, which is the
-- failure this column exists to prevent.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists band_revision_id uuid
    references public.category_price_revisions (id) on delete set null;

comment on column public.bookings.band_revision_id is
  'The approved band revision in force when this was quoted, frozen like band_min. Null means no revision on record — the band came from the launch research, see categories.pricing_source — and is never backfilled.';

create index if not exists bookings_band_revision_idx
  on public.bookings (band_revision_id)
  where band_revision_id is not null;

-- The same freeze-and-pin as `20260921000001` left it, with the revision id
-- carried beside the floor. Every branch there is preserved verbatim.
--
-- A SURVEY BOOKING KEEPS A NULL REVISION, deliberately. Its `band_min` is the
-- surveyed figure the professional quoted, not a band we published, so naming a
-- category revision beside it would attach a decision to a number that decision
-- did not produce. Null is the same fact as on every other row that has one:
-- no published band revision is behind this floor.
--
-- THE LOOKUP HAPPENS BEFORE THE `band_min is not null` EARLY RETURN. A caller
-- that supplies its own floor — the db suite does — would otherwise insert a row
-- with no revision on a category that has one, which is a null meaning something
-- different from every other null in this column.
create or replace function public.freeze_booking_band()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  floor_now integer;
  revision_now uuid;
begin
  if tg_op = 'UPDATE' then
    if new.quote_model = 'survey'
       and old.band_min is null
       and new.quoted_min is not null then
      new.band_min := new.quoted_min;
    else
      new.band_min := old.band_min;
    end if;
    -- Pinned in every case, survey included: the surveyed floor is still not a
    -- band we published, so it gains no revision on the way through.
    new.band_revision_id := old.band_revision_id;
    return new;
  end if;

  -- Nothing has been surveyed yet, so there is no floor of ours to freeze.
  if new.quote_model = 'survey' then
    new.band_min := null;
    new.band_revision_id := null;
    return new;
  end if;

  -- The category band revision in force at this moment. It says WHICH published
  -- band framed this quote and who decided it; it is not a claim that this
  -- booking's floor equals that revision's number, since a sub-band or an
  -- approved provider band may have supplied the figure below.
  select r.id into revision_now
    from public.category_price_revisions r
   where r.category_slug = new.category_slug
     and r.decision = 'approved'
   order by r.decided_at desc
   limit 1;

  new.band_revision_id := coalesce(new.band_revision_id, revision_now);

  if new.band_min is not null then
    return new;
  end if;

  select b.low into floor_now
    from public.booking_band_bounds(
      new.category_slug,
      new.band_slug,
      new.band_source,
      new.provider_band_slug,
      new.band_change_approved_at
    ) b;

  -- quoted_min as the last resort rather than null: a category row missing
  -- behind a foreign key should not be able to break a booking.
  new.band_min := coalesce(floor_now, new.quoted_min);
  return new;
end;
$$;

comment on function public.freeze_booking_band() is
  'Fills bookings.band_min and band_revision_id at insert and pins both on update. The published floor and the band decision in force at booking time, kept so a dispute can show which band framed the quote. Null revision: none on record — the band came from the launch research, or the quote was a survey.';

revoke execute on function public.freeze_booking_band() from public;
