-- Storage for booking photos.
--
-- Triage photos are never stored — the model looks at one and it is gone, and
-- the privacy page says so. A booking photo is different: the professional
-- needs to see the thing before they arrive, and it has to survive until they
-- do. Two different promises about two different photos, so two different
-- mechanisms rather than one bucket used inconsistently.
--
-- Private bucket. Reading goes through a signed URL from the server, so a
-- photo of the inside of somebody's kitchen is never on a guessable public
-- path.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-photos',
  'booking-photos',
  false,
  2 * 1024 * 1024,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are keyed `<profile_id>/<uuid>.jpg`, so the first path segment is
-- the owner and every policy below is that one comparison.

drop policy if exists "Customers upload their own booking photos" on storage.objects;
create policy "Customers upload their own booking photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'booking-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Customers read their own booking photos" on storage.objects;
create policy "Customers read their own booking photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'booking-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- A professional sees the photo for a job assigned to them, while it is live.
-- Same window as the address: once the job is done or cancelled, the reason to
-- look inside somebody's house is over.
drop policy if exists "Assigned providers read the job photo" on storage.objects;
create policy "Assigned providers read the job photo"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'booking-photos'
    and exists (
      select 1
      from public.bookings b
      join public.providers p on p.id = b.provider_id
      where b.photo_url = storage.objects.name
        and p.profile_id = (select auth.uid())
        and b.status in ('accepted', 'en_route', 'in_progress')
    )
  );

-- No delete policy. A photo is evidence of what the job was; Phase 11 may need
-- it, and a retention sweep is a deliberate job rather than a button.
