-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. No deviation: no
--   statement here has `DROP` as its first keyword, so nothing needed splitting out.
--   The four `drop policy if exists` lines the repo's idiom carries are omitted from the
--   applied text and kept in the file — a fresh apply has no policy to drop, and the db
--   suite and a new project need both halves.
--
-- ADDS: public.guarantee_claim_photos; the `claim-photos` storage bucket and its read
--   policies.
-- REMOVES: nothing. No function is rebuilt and no policy on an existing table is
--   redefined, so there is no "rebuild from the LAST definition" trap here.

-- ===========================================================================
-- What a customer sends with a claim, and the three answers this table refuses
-- to hold.
--
-- WHY A CLAIM PHOTOGRAPH IS NOT A BOOKING PHOTOGRAPH. A booking photograph helps a
-- professional bring the right parts; a misleading one is corrected by the person
-- standing in the room, which is why `booking_photos` is flag-only and refuses nothing.
-- This one is evidence in an argument about money — the end of the ladder is a cash
-- refund capped at what the job was settled at — and the cheapest fabrication in the
-- product is a photograph of somebody else's leak.
--
-- THE HARD REJECTS ARE CHECK CONSTRAINTS, WHICH IS THE WHOLE DESIGN OF THIS TABLE.
-- `lib/photos/evidence.ts` decides, and says why, so the customer gets a sentence they
-- can act on. But a refusal that lives only in the application is a refusal the next
-- caller forgets, and this is the money path. So the three answers that mean "this is
-- not evidence" cannot be stored at all:
--
--   * NO CAMERA DATA. `taken_at` is `not null`. A screenshot, a download, a file that
--     has been through a messaging app and anything re-encoded through a canvas all
--     arrive with no capture time — ordinary for a booking photograph and not evidence
--     here, because without a clock there is nothing to check the other two rules
--     against.
--
--   * ALREADY SENT. `duplicate_verdict` does not accept `'reject'`. The same picture
--     on another job or another account is the reuse `photo_hashes` exists to catch.
--     `'retry'` IS accepted: the same picture on the same booking is somebody
--     re-uploading on a weak signal, or a second claim about a leak nobody fixed.
--
--   * TAKEN BEFORE THE WORK FINISHED. `taken_before_completion` is `not null` and
--     checked `is false`. A photograph from before the job cannot show that job
--     failing, whatever else is true of it.
--
-- `is false` RATHER THAN `= false`, AND THE DIFFERENCE IS REAL BUT NOT THE ONE THAT
-- FIRES — measured rather than reasoned, because the first draft of this header claimed
-- the spelling was what refused the unestablished case and that was wrong. All four
-- combinations were run against the db suite:
--
--   not null + `is false`   refuses NULL   (what ships)
--   not null + `= false`    refuses NULL   — `not null` is the guard that fires
--   `is false` alone        refuses NULL   — the spelling is sufficient by itself
--   `= false` alone         ACCEPTS NULL   — a NULL CHECK evaluates to NULL and passes
--
-- So CLAUDE.md's note is right that the two are identical inside a PL/pgSQL `IF`, and
-- right that a CHECK clause is where they diverge; what is not true is that the spelling
-- is doing the work here. `not null` is. Both are kept because they are independently
-- sufficient and a guard that depends on a second guard still standing is a guard with a
-- way to fail quietly — if the column is ever made nullable, the spelling is what holds.
--
-- THE DOUBTS ARE STORED AND REFUSE NOTHING. Stale, near-duplicate and
-- same-picture-as-the-booking are judgements with their evidence beside them, shown to
-- the person deciding. `20261008000003` is what makes them gate money, and it gates it
-- in one narrow way: a doubt means a refund needs the in-person verdict, which is what
-- the queue already required and the rule did not.
--
-- NULL IS "NOT CHECKED", NEVER "CLEAN" — rule 6, on columns that decide a payment.
-- Every row written before a column existed is silent in it.
-- ===========================================================================

create table if not exists public.guarantee_claim_photos (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.guarantee_claims (id) on delete cascade,

  /* Object key in the private `claim-photos` bucket. A path, never a URL. */
  storage_path text not null,

  /* 0, 1 or 2. Unique per claim, which is what caps a claim at three. */
  position smallint not null check (position between 0 and 2),

  /*
   * The camera's own clock, as the file reported it: a local wall clock with no
   * timezone, parsed as UTC so the arithmetic happens in one frame. See
   * `lib/photos/freshness.ts` — Nepal is UTC+5:45, so a photograph taken here reads
   * 345 minutes ahead of the instant it was taken, and the comparison corrects for that
   * rather than the stored value.
   *
   * NOT NULL IS THE FIRST HARD REJECT. Evidence with no capture time is not evidence.
   */
  taken_at timestamptz not null,

  /*
   * Could this photograph show that work failing? Only one answer is storable.
   *
   * Recorded rather than derived in SQL, because deriving it here would put the
   * UTC+5:45 correction in a second place and the two would drift. The application
   * answers it with `takenBeforeCompletion`; the constraint is what makes the answer
   * compulsory and the wrong one impossible.
   */
  taken_before_completion boolean not null
    check (taken_before_completion is false),

  /* 64-bit dHash as 16 hex characters. Null when the bytes would not decode. */
  hash text check (hash ~ '^[0-9a-f]{16}$'),

  /*
   * Whether we had been sent this picture before. `'reject'` is absent from the set on
   * purpose — see the header. `'not-compared'` is a failed read and is kept, because a
   * table that did not answer is not a photograph that is new.
   */
  duplicate_verdict text not null
    check (duplicate_verdict in ('unseen', 'retry', 'flag', 'not-compared')),
  duplicate_distance integer check (duplicate_distance between 0 and 64),

  /*
   * Whether the camera clock puts this photograph inside the claim window. Seven days,
   * from `CLAIM_FRESHNESS_WINDOW_DAYS`. `no-capture-time` and `not-checked` are both
   * impossible here because `taken_at` is not null.
   */
  freshness_verdict text not null check (freshness_verdict in ('fresh', 'stale')),

  /*
   * Compared against the photographs the customer sent with the original booking.
   *
   * `same-picture` IS A DOUBT AND NOT A REFUSAL, which is a close call worth writing
   * down. A claim photograph identical to the booking photograph cannot show the work
   * failing — and a dHash at distance 4 on a 9x8 grid is a coarse enough answer that
   * "the same tap, photographed twice from the same angle, still dripping" genuinely
   * lands there. So it routes the claim to somebody who can look, rather than refusing
   * an honest customer whose complaint is that nothing changed.
   *
   * `no-reference` means the booking carried no photographs — our gap, not theirs, and
   * deliberately not a doubt. `not-compared` is a failed read. Null is a row from
   * before this column.
   */
  booking_photo_match text
    check (booking_photo_match in ('same-picture', 'different-picture', 'no-reference', 'not-compared')),

  created_at timestamptz not null default now(),

  constraint guarantee_claim_photos_one_per_slot unique (claim_id, position)
);

comment on table public.guarantee_claim_photos is
  'Photographs sent with a guarantee claim, up to three. The three answers that mean "this is not evidence" cannot be stored: no capture time, a near-duplicate of a photograph from another job, and a capture time before the work finished. The doubts can be, and route the claim to a person.';

comment on column public.guarantee_claim_photos.taken_at is
  'The camera clock as the file reported it — a local wall clock parsed as UTC. Not null: evidence with no capture time is refused before it reaches this table.';

comment on column public.guarantee_claim_photos.taken_before_completion is
  'The recorded answer to "could this photograph show that work failing?". Only false is storable. Recorded rather than derived so the UTC+5:45 correction lives in one place.';

comment on column public.guarantee_claim_photos.duplicate_verdict is
  'Whether we had been sent this picture before. reject is not in the set — it is refused before the insert. not-compared is a failed read and is never "new".';

comment on column public.guarantee_claim_photos.booking_photo_match is
  'Compared against the photographs sent with the original booking. same-picture is a doubt, not a refusal: the hash is coarse enough that an unchanged fault looks like an unchanged picture.';

-- ---------------------------------------------------------------------------
-- Closed before it is opened
-- ---------------------------------------------------------------------------

alter table public.guarantee_claim_photos enable row level security;

-- NOTHING FROM A BROWSER. The bytes have to be validated and stripped before they are
-- stored, the hash and the clock have to be read from the bytes we actually kept, and
-- the three refusals have to be applied by something that can explain them. All of that
-- is `lib/data/claim-photos.ts` under the service role. A customer able to insert here
-- could record a verdict of their own choosing beside a photograph nobody checked.
revoke insert, update, delete on public.guarantee_claim_photos from anon, authenticated;

create index if not exists guarantee_claim_photos_claim_idx
  on public.guarantee_claim_photos (claim_id, position);

-- ---------------------------------------------------------------------------
-- The photograph itself
-- ---------------------------------------------------------------------------

-- Two megabytes and JPEG only, the same ceiling as every other upload here. The bucket
-- believes the content type it is handed, which is why `checkUploadedImage` reads the
-- first bytes of the file rather than the label.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'claim-photos',
  'claim-photos',
  false,
  2 * 1024 * 1024,
  array['image/jpeg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- Policies and grants, last, so stopping anywhere leaves something closed
-- ---------------------------------------------------------------------------

-- The customer sees what they attached to their own claim. Two readers and not three:
-- the attending professional is sent to look at the fixture in person and does not see
-- this yet, which is a deliberate gap rather than an oversight — their screen is the job
-- surface and the photograph is the adjudicator's evidence. If that turns out to be the
-- wrong call the fix is a policy here and a panel there, not a quiet widening.
drop policy if exists "Customers read their own claim photo rows" on public.guarantee_claim_photos;
create policy "Customers read their own claim photo rows"
  on public.guarantee_claim_photos for select to authenticated
  using (
    exists (
      select 1 from public.guarantee_claims c
      where c.id = guarantee_claim_photos.claim_id
        and c.customer_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read claim photo rows" on public.guarantee_claim_photos;
create policy "Admins read claim photo rows"
  on public.guarantee_claim_photos for select to authenticated
  using (public.is_admin());

-- A new table grants nothing, so this says what it grants.
grant select on public.guarantee_claim_photos to authenticated;

-- Objects are keyed `<customer_profile_id>/<claim_id>-<position>.jpg`, so the first path
-- segment is whose photograph it is and the policy is that one comparison.
--
-- NO INSERT POLICY AT ALL, for the same reason as the arrival bucket: a browser that
-- could write here could store an unstripped photograph, and a photograph taken inside
-- somebody's home carries that home's coordinates.
drop policy if exists "Customers read their own claim photos" on storage.objects;
create policy "Customers read their own claim photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'claim-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- The adjudicator reads it to decide money. Every one of those reads is written to the
-- log by `signClaimPhotosForAdmin` rather than by this policy — a policy can permit a read
-- and cannot record one.
drop policy if exists "Admins read claim photos" on storage.objects;
create policy "Admins read claim photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'claim-photos' and public.is_admin());

-- No delete policy. This is the evidence a refund was decided on; a retention sweep is a
-- deliberate job rather than a button, exactly as with arrival and booking photographs.

-- The `supabase_migrations` history row is recorded when this is applied, not from inside
-- the file: the test harness builds a bare Postgres with no such schema, and no other
-- migration here writes one.
