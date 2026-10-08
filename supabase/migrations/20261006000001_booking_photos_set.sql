-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. ONE DEVIATION, stated
--   rather than left to be noticed: the three `drop policy if exists` lines were omitted
--   from what was sent, because a statement whose first keyword is `DROP` hangs that
--   transport for 60 seconds. Two of the three policies already exist and were replaced by
--   `create or replace`-equivalent means — see the note on the provider policy below. The
--   file keeps every drop, because a fresh project needs them.
--
-- ADDS: public.booking_photos, and a storage policy keyed to it.
-- REMOVES: nothing. `bookings.photo_url` is untouched and still written.

-- ---------------------------------------------------------------------------
-- Up to three photographs on one booking.
--
-- WHY A TABLE AND NOT MORE COLUMNS. `bookings.photo_url` is one path, and the triage can
-- now judge a photograph and ask for another — so a request can reasonably end up with
-- several, and `photo_url_2` is the shape nobody wants to add a third to.
--
-- THREE IS ENFORCED BY THE KEY, NOT BY A TRIGGER. `position` is checked to 0, 1 or 2 and
-- unique per booking, so a fourth photograph has nowhere to go. A trigger counting rows
-- would be a second place that knows the limit and a race nobody has thought about; a
-- unique key is the database refusing, which is the idiom `provider_ledger_recovery_once_idx`
-- already uses one table over.
--
-- NOTHING IS BACKFILLED BECAUSE THERE IS NOTHING TO BACKFILL. Measured rather than assumed:
-- 14 bookings exist and 0 carry a `photo_url`. The column stays and is still written with
-- the first photograph, because the storage policy and several reads key on it; retiring it
-- is an after-deploy migration of its own rather than a change that breaks the running
-- build the moment this applies.
--
-- THE JUDGEMENTS RIDE WITH THE PHOTOGRAPH, each null until checked and never defaulting to
-- a clean answer — the same rule as `booking_arrivals`, for the same reason: these decide
-- what a person is shown, and later what a claim is allowed to do.
-- ---------------------------------------------------------------------------

create table if not exists public.booking_photos (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,

  /* Object key in the private `booking-photos` bucket. A path, never a URL. */
  storage_path text not null,

  /* 0, 1 or 2. Unique per booking, which is what caps a request at three. */
  position smallint not null check (position between 0 and 2),

  /* The camera clock, read off the original bytes before EXIF was stripped. */
  taken_at timestamptz,

  /* 64-bit dHash as 16 hex characters. Null when the bytes could not be decoded. */
  hash text check (hash ~ '^[0-9a-f]{16}$'),

  duplicate_verdict text
    check (duplicate_verdict in ('unseen', 'retry', 'flag', 'reject', 'not-compared')),
  duplicate_distance integer check (duplicate_distance between 0 and 64),

  created_at timestamptz not null default now(),

  constraint booking_photos_one_per_slot unique (booking_id, position)
);

comment on table public.booking_photos is
  'Up to three photographs on one booking. Three is enforced by the unique (booking_id, position) key rather than by a trigger — a fourth has nowhere to go. bookings.photo_url still holds the first one during the transition.';

comment on column public.booking_photos.duplicate_verdict is
  'Whether this photograph had been sent before. Null means it was never checked — never that it is new.';

alter table public.booking_photos enable row level security;
revoke insert, update, delete on public.booking_photos from anon, authenticated;

create index if not exists booking_photos_booking_idx
  on public.booking_photos (booking_id, position);

-- ---------------------------------------------------------------------------
-- Who may see a photograph of the inside of somebody's home.
--
-- THE SAME THREE READERS AS THE SINGLE PHOTO HAD, and the same window: the customer who
-- sent it, the assigned professional while the job is live, and an admin. Once the job is
-- over, the reason to look inside somebody's house is over with it.
-- ---------------------------------------------------------------------------

drop policy if exists "Customers read their own booking photos rows" on public.booking_photos;
create policy "Customers read their own booking photos rows"
  on public.booking_photos for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_photos.booking_id
        and b.customer_id = (select auth.uid())
    )
  );

drop policy if exists "Assigned providers read booking photo rows" on public.booking_photos;
create policy "Assigned providers read booking photo rows"
  on public.booking_photos for select to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      join public.providers p on p.id = b.provider_id
      where b.id = booking_photos.booking_id
        and p.profile_id = (select auth.uid())
        and b.status in ('accepted', 'en_route', 'in_progress')
    )
  );

drop policy if exists "Admins read booking photo rows" on public.booking_photos;
create policy "Admins read booking photo rows"
  on public.booking_photos for select to authenticated
  using (public.is_admin());

grant select on public.booking_photos to authenticated;

-- ---------------------------------------------------------------------------
-- And the objects themselves.
--
-- THE PROVIDER POLICY HAD TO BE REPOINTED, which is the part of this migration most worth
-- reading twice. It matched `b.photo_url = storage.objects.name` — one column, one
-- photograph. A second or third photograph would have been uploaded successfully by the
-- customer and then been invisible to the professional the job was assigned to, with
-- nothing failing anywhere: the upload works, the row is written, and the signed URL is
-- simply refused. It now matches either the column or a row in `booking_photos`, so the
-- first photograph keeps working through the transition and the rest work at all.
-- ---------------------------------------------------------------------------

drop policy if exists "Assigned providers read the job photo" on storage.objects;
create policy "Assigned providers read the job photo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'booking-photos'
    and exists (
      select 1
      from public.bookings b
      join public.providers p on p.id = b.provider_id
      where p.profile_id = (select auth.uid())
        and b.status in ('accepted', 'en_route', 'in_progress')
        and (
          b.photo_url = storage.objects.name
          or exists (
            select 1 from public.booking_photos bp
            where bp.booking_id = b.id
              and bp.storage_path = storage.objects.name
          )
        )
    )
  );
