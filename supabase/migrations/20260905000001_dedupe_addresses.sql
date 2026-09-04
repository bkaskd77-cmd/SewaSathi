-- One address, saved once.
--
-- `createAddress` inserted unconditionally, so every booking where somebody
-- typed their address again created another row. A customer with five bookings
-- from the same flat had five identical "home" entries on the address step —
-- a list where every option is the same option, which is worse than no list.
--
-- Fixed in two places, deliberately. The data layer looks for an existing
-- match first, so the ordinary path never creates a duplicate; and this index
-- makes it impossible, so a future caller that forgets cannot reintroduce it.
-- The application check is for a good error, the constraint is for the truth.

-- ---------------------------------------------------------------------------
-- 1. Repoint bookings at the row that will survive.
--
-- Oldest wins: it is the one whose id may already be sitting in somebody's
-- booking history, and keeping it means no reference has to change meaning.
-- ---------------------------------------------------------------------------

with ranked as (
  select
    id,
    first_value(id) over (
      partition by
        profile_id,
        area_key,
        lower(btrim(tole)),
        lower(btrim(coalesce(landmark, '')))
      order by created_at, id
    ) as keeper
  from public.addresses
)
update public.bookings b
set address_id = r.keeper
from ranked r
where b.address_id = r.id
  and r.id <> r.keeper;

-- ---------------------------------------------------------------------------
-- 2. Delete the duplicates, now that nothing points at them.
-- ---------------------------------------------------------------------------

with ranked as (
  select
    id,
    first_value(id) over (
      partition by
        profile_id,
        area_key,
        lower(btrim(tole)),
        lower(btrim(coalesce(landmark, '')))
      order by created_at, id
    ) as keeper
  from public.addresses
)
delete from public.addresses a
using ranked r
where a.id = r.id and r.id <> r.keeper;

-- ---------------------------------------------------------------------------
-- 3. Make it impossible.
--
-- Case- and whitespace-insensitive on the free-text parts, because "Jhamsikhel"
-- and " jhamsikhel " are the same doorstep and a customer typing it twice is
-- not creating a second home. The label is deliberately NOT part of the key:
-- the same flat saved as "home" and then as "flat" is still one place, and
-- letting the label split it would put the duplicates straight back.
-- ---------------------------------------------------------------------------

create unique index if not exists addresses_one_per_place_idx
  on public.addresses (
    profile_id,
    area_key,
    lower(btrim(tole)),
    lower(btrim(coalesce(landmark, '')))
  );

comment on index public.addresses_one_per_place_idx is
  'One saved address per doorstep. See lib/data/addresses.ts, which looks for a match before inserting so the customer gets their existing address rather than a constraint error.';
