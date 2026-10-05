-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction. No deviation: this
--   migration contains no statement whose first keyword is `DROP`.
--
-- ADDS: public.photo_hashes; booking_arrivals.duplicate_verdict,
--   booking_arrivals.duplicate_distance, booking_arrivals.freshness_verdict.
-- REMOVES: nothing. No function is rebuilt and no policy is redefined.

-- ---------------------------------------------------------------------------
-- Photographs we have already been sent.
--
-- WHAT THIS IS FOR. The same picture of a locked gate, sent on a second booking, funds a
-- second Rs 350 wasted-trip payment. There is nothing in the photograph itself to say it
-- has been used before, so the only way to know is to have kept something comparable.
--
-- THE HASH, NEVER THE PICTURE. Sixteen hex characters of a 64-bit dHash — enough to say
-- "this is the same photograph", not enough to reconstruct anything from. It outlives the
-- photograph it came from on purpose: `arrivalPhotos` deletes the image after 60 days and
-- this row stays, because a photograph reused a year later is exactly the case worth
-- catching and the picture is not needed to catch it.
--
-- SCOPED BY BOOKING AND ACCOUNT, because the rule needs both. The same hash on the SAME
-- booking is a retry on a weak signal and is deduplicated; on another booking or another
-- account it is a reuse. `judgeDuplicate` is the one place that decides, and it reads these
-- two columns to do it.
--
-- NO FOREIGN KEY TO THE PHOTOGRAPH, deliberately: the storage object is deleted on the
-- retention sweep and a cascade would take the evidence with it.
-- ---------------------------------------------------------------------------

create table if not exists public.photo_hashes (
  id uuid primary key default gen_random_uuid(),

  /* 64-bit dHash as 16 hex characters. */
  hash text not null check (hash ~ '^[0-9a-f]{16}$'),

  /* Where the photograph was used. 'arrival' today; claim evidence joins later. */
  kind text not null check (kind in ('arrival', 'booking', 'claim')),

  booking_id uuid references public.bookings (id) on delete set null,
  /* Whose photograph it was. Null when the uploader is not a profile we hold. */
  account_id uuid references public.profiles (id) on delete set null,

  created_at timestamptz not null default now()
);

comment on table public.photo_hashes is
  'A perceptual hash of every photograph we have been sent, kept so a reused one can be recognised. The hash outlives the picture: the image is deleted on the retention sweep and this row is not, because a photograph reused a year later is the case worth catching.';

alter table public.photo_hashes enable row level security;
revoke insert, update, delete on public.photo_hashes from anon, authenticated;

create index if not exists photo_hashes_lookup_idx on public.photo_hashes (kind, hash);

-- ---------------------------------------------------------------------------
-- What was concluded about an arrival photograph.
--
-- JUDGEMENTS WITH THEIR REASONS, NEVER SCORES. `duplicate_verdict` is a named answer and
-- `duplicate_distance` is the evidence behind it, shown to the person deciding a claim so
-- they can weigh it rather than obey it. A bare number with no verdict would invite
-- somebody to invent a threshold on the screen; a verdict with no number would be an
-- assertion nobody could check.
--
-- NULL IS "NOT CHECKED", NEVER "CLEAN". A photograph whose bytes would not decode has no
-- hash, every row written before these columns has no verdict, and neither is evidence that
-- a photograph is new or fresh. Rule 6, on the columns that will gate a payment.
-- ---------------------------------------------------------------------------

alter table public.booking_arrivals
  add column if not exists duplicate_verdict text
    check (duplicate_verdict in ('unseen', 'retry', 'flag', 'reject', 'not-compared')),
  add column if not exists duplicate_distance integer
    check (duplicate_distance between 0 and 64),
  add column if not exists freshness_verdict text
    check (freshness_verdict in ('fresh', 'stale', 'no-capture-time', 'not-checked'));

comment on column public.booking_arrivals.duplicate_verdict is
  'Whether this photograph had been sent before. Null means it was never checked — never that it is new.';

comment on column public.booking_arrivals.duplicate_distance is
  'How many of the 64 hash bits differed from the nearest photograph we hold. The evidence behind the verdict, shown to a person rather than acted on by a threshold on screen.';

comment on column public.booking_arrivals.freshness_verdict is
  'Whether the camera clock put this photograph near the arrival tap. no-capture-time means the file carried none — a screenshot or a download. Null means not checked.';

grant select on public.photo_hashes to authenticated;

drop policy if exists "Admins read photo hashes" on public.photo_hashes;
create policy "Admins read photo hashes"
  on public.photo_hashes for select to authenticated
  using (public.is_admin());
