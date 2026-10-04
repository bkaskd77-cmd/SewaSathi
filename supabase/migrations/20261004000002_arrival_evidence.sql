-- ADDS: booking_arrivals.photo_path, booking_arrivals.exif_skew_minutes;
--   public.booking_contact_attempts; the `arrival-photos` storage bucket and its
--   read policies.
-- REMOVES: nothing. No function is rebuilt and no policy on an existing table is
--   redefined, so there is no "rebuild from the LAST definition" trap here.

-- ---------------------------------------------------------------------------
-- Evidence worth funding a payment on.
--
-- WHY THIS EXISTS NOW AND NOT BEFORE. Until `trip_compensation` shipped, a wasted-trip
-- claim moved no money, so the evidence behind it cost nothing to be thin. It is real
-- money now — Rs 350 to the professional, recovered from the customer's next bill —
-- and `/admin/claims` currently shows a reviewer three things, all of which the
-- claimant supplied: a wait they typed, a call count they typed, and a location their
-- own phone reported. None of it can be checked against anything.
--
-- TWO OF THE THREE STOP BEING TYPED. The call count becomes a count of rows written
-- when a button was pressed (`booking_contact_attempts`), and a photograph taken at
-- the door arrives with the camera's own clock compared against ours. Neither is
-- proof — a tap can be made from anywhere and a photograph can be of any gate — and
-- that is said on the screen rather than implied. What they do is make the claim
-- costly to fabricate and give a reviewer something to disagree with.
--
-- THE LOCATION STAYS UNVERIFIED AND STAYS LABELLED. We hold no coordinates for an
-- address, so there is nothing to compare a phone's reading against. That changes
-- when addresses get a map pin and not before.

-- ---------------------------------------------------------------------------
-- 1. What the photograph tells us, which is not the photograph
-- ---------------------------------------------------------------------------

alter table public.booking_arrivals
  add column if not exists photo_path text,
  add column if not exists exif_skew_minutes integer;

comment on column public.booking_arrivals.photo_path is
  'Object key in the private arrival-photos bucket. Null means no photograph was offered, which is ordinary — a claim is never refused for want of one.';

-- THE COMPARISON IS STORED AND THE TIMESTAMP IS NOT, which is the whole design of
-- this column. EXIF carries the GPS of wherever the shutter fired, so the block comes
-- off before anything is stored (`lib/security/image.ts`); the camera's clock is read
-- on its way out and kept only as minutes of difference from our own receipt stamp.
-- A photograph taken three hours before the visit is a different claim, and that is
-- what a reviewer needs — not the wall-clock reading, which says nothing without ours
-- beside it.
--
-- NULL IS "NOT RECORDED", NEVER "THE CLOCKS AGREED" — rule 6, and it is the common
-- case rather than an edge: our own browser compressor re-encodes through a canvas
-- and keeps no EXIF at all, as does anything that has been through a messaging app.
-- Reading null as zero skew would hand every one of those a perfect alibi.
--
-- IT IS SIGNED. Negative means the camera said earlier than we received it, which is
-- the ordinary direction and the one worth seeing; positive means a clock running
-- ahead, which happens and is not by itself suspicious. An absolute value would
-- destroy exactly the distinction a reviewer is looking for.
comment on column public.booking_arrivals.exif_skew_minutes is
  'The camera clock minus our receipt time, in minutes, signed. Null is "not recorded" — most photographs carry no EXIF at all. Never a gate: a phone in another time zone is whole hours out and perfectly honest.';

-- ---------------------------------------------------------------------------
-- 2. Reaching the customer, counted rather than asserted
-- ---------------------------------------------------------------------------

create table if not exists public.booking_contact_attempts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,

  /*
   * WHICH DOOR THEY KNOCKED ON. A closed set because the screen offers buttons and
   * nothing else: a `tel:` link and a `wa.me` link. There is no masked relay — that
   * is a paid service and is deferred until there is income to pay for it — so these
   * are the customer's real number in the professional's dialler, which the
   * `provider_contacts` window already allows while a job is live.
   */
  channel text not null check (channel in ('call', 'whatsapp')),

  created_at timestamptz not null default now()
);

comment on table public.booking_contact_attempts is
  'One row per tap on the call or WhatsApp button during a job. Replaces a number the professional typed into their own claim: a row is written when the dialler opened, which is a weaker claim than "I rang three times" and a true one.';

-- A STAMP IS NOT A CONVERSATION, and the comment says so where somebody will read it
-- while deciding. The row records that the dialler opened; whether it rang, whether
-- it was answered and whether anybody spoke are all invisible to us. A professional
-- could tap four times from the end of the road. What this changes is that the
-- evidence is no longer a number they chose, and that is worth having without being
-- worth more than it is.

create index if not exists booking_contact_attempts_booking_idx
  on public.booking_contact_attempts (booking_id, created_at);

alter table public.booking_contact_attempts enable row level security;

-- NOTHING FROM A BROWSER, which is the same rule as the arrival row beside it: the
-- actor has to come from the session and the booking has to be re-read as theirs, so
-- the write goes through the service role. A professional able to insert these could
-- manufacture a call history for any booking id they could name.
revoke insert, update, delete on public.booking_contact_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The photograph itself
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'arrival-photos',
  'arrival-photos',
  false,
  2 * 1024 * 1024,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 4. Policies and grants, last, so stopping anywhere leaves something closed
-- ---------------------------------------------------------------------------

-- Both sides of the job read the row, same as the arrival it belongs to: the customer
-- is entitled to see how many times somebody says they tried, since it is part of a
-- claim against them.
drop policy if exists "Both sides read the contact attempts" on public.booking_contact_attempts;
create policy "Both sides read the contact attempts"
  on public.booking_contact_attempts for select to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_contact_attempts.booking_id
        and b.customer_id = (select auth.uid())
    )
    or exists (
      select 1 from public.providers p
      where p.id = booking_contact_attempts.provider_id
        and p.profile_id = (select auth.uid())
    )
    or public.is_admin()
  );

grant select on public.booking_contact_attempts to authenticated;

-- Objects are keyed `<provider_profile_id>/<booking_id>.jpg`, so the first path
-- segment is who took the photograph and the policy is that one comparison.
--
-- NO INSERT POLICY AT ALL. The upload goes through the server because the bytes have
-- to be validated and stripped before they are stored — magic bytes, dimensions, and
-- the EXIF block that carries somebody's coordinates. A browser that could write here
-- directly would be a browser that could store an unstripped photograph, which is the
-- one thing this path exists to prevent.
drop policy if exists "Providers read their own arrival photos" on storage.objects;
create policy "Providers read their own arrival photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'arrival-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- An admin reads it to decide the claim, and every read is logged by
-- `recordDocumentAccess`'s sibling rather than by this policy — a policy can permit a
-- read and cannot record one.
--
-- THE CUSTOMER DOES NOT GET IT, and that is a decision rather than an oversight. A
-- photograph of *a* gate shown to somebody as "your gate" is an argument with no
-- adjudicator in the room; the customer's channel is the dispute, where a person
-- looks at the photograph and the objection together. If that turns out to be the
-- wrong call, the fix is a policy here and a line on the dispute form, not a quiet
-- widening.
drop policy if exists "Admins read arrival photos" on storage.objects;
create policy "Admins read arrival photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'arrival-photos' and public.is_admin());

-- No delete policy. A photograph is the evidence a payment was made on; a retention
-- sweep is a deliberate job rather than a button, exactly as with booking photos.

-- The `supabase_migrations` history row is recorded when this is applied, not from
-- inside the file: the test harness builds a bare Postgres with no such schema, and no
-- other migration here writes one. CLAUDE.md's note about inserting it inside the block
-- is about the `DO $$ … $$` idiom, which exists to make a multi-statement apply atomic;
-- this file was applied one bare statement at a time, so there is no block to put it in.
