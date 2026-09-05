-- Two things that have to exist before Phase 10, not after it.
--
-- Phase 10 starts collecting citizenship certificates, PAN cards and
-- photographs of people's faces. A storage model designed after the data
-- exists is a migration performed on live identity documents, and every
-- mistake in it is somebody's identity document sitting in the wrong place
-- while it is fixed. So the shape goes in first, empty.
--
-- The audit log is here for the same reason and one more: it is the evidence
-- in a dispute and the forensics after a breach, and neither can be
-- reconstructed later. A log that starts the day you need it tells you
-- nothing about the day before.

-- ---------------------------------------------------------------------------
-- WHAT HAPPENED, WHO DID IT, AND WHEN. APPEND ONLY.
--
-- Append-only means it: there is no update or delete policy for anybody, and
-- the trigger below refuses both for EVERY caller including the service role.
-- A log that the application can rewrite is a log that proves nothing — the
-- first thing an attacker with our own key would do is tidy up after
-- themselves, and the first thing a careless migration would do is "clean up
-- old rows". Retention, when it is decided, is a deliberate migration that
-- drops the trigger, says why, and puts it back.
--
-- `detail` is jsonb and deliberately loose: what is worth recording about a
-- payment is not what is worth recording about a document being read, and a
-- rigid column set would mean either a migration per event type or a column
-- called `note` that everything is stuffed into. What is NOT allowed in there
-- is a secret, a token, or a full document — this table is read by people.
-- ---------------------------------------------------------------------------

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  /** Null for the system itself: a cron sweep, a gateway callback. */
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role text not null default 'system'
    check (actor_role in ('customer', 'provider', 'admin', 'system', 'anonymous')),
  kind text not null,
  /** What it happened to: 'booking', 'payment', 'document', 'profile'. */
  subject_type text,
  subject_id text,
  detail jsonb not null default '{}'::jsonb,
  /** Enough to tell one session from another. Never a token. */
  request_ip text,
  user_agent text
);

comment on table public.security_events is
  'Append-only record of security-relevant events: auth, role changes, admin actions, document access, payment state changes, final-amount entry and approval. Evidence in a dispute and forensics after a breach; both are impossible to reconstruct afterwards.';

create index if not exists security_events_at_idx
  on public.security_events (at desc);
create index if not exists security_events_actor_idx
  on public.security_events (actor_id, at desc);
create index if not exists security_events_subject_idx
  on public.security_events (subject_type, subject_id, at desc);

alter table public.security_events enable row level security;

drop policy if exists "Admins read the security log" on public.security_events;
create policy "Admins read the security log"
  on public.security_events for select to authenticated
  using (public.is_admin());

-- No insert policy on purpose: writes go through the service role in
-- `lib/audit`, so a browser cannot forge an entry saying somebody else did
-- something.

create or replace function public.security_events_are_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'security_events is append-only: % is not allowed', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

drop trigger if exists security_events_no_rewrite on public.security_events;
create trigger security_events_no_rewrite
  before update or delete on public.security_events
  for each row execute function public.security_events_are_append_only();

-- ---------------------------------------------------------------------------
-- IDENTITY DOCUMENTS. THE SHAPE, BEFORE THERE IS ANYTHING IN IT.
--
-- A citizenship certificate is not a photograph of a tap. It identifies a real
-- person, it cannot be reissued if it leaks, and it is the kind of thing that
-- ends up in a spreadsheet somebody emails. The rules here follow from that:
--
--   PRIVATE BUCKET, ALWAYS. No public path exists, so there is no URL to
--   guess. Reading is a signed URL minted on the server, short-lived.
--
--   THE OWNER AND ADMINS, NOBODY ELSE. Not other professionals, not customers,
--   not a professional's own customers. The verification badge is what the
--   product shows; the document behind it is never shown to anybody.
--
--   EVERY READ IS LOGGED. `lib/audit` writes a `document.viewed` event with
--   the admin's id whenever a signed URL is minted. An admin looking at
--   somebody's citizenship certificate is exactly the access nobody would
--   otherwise ever see, and admins are the largest single risk in a platform
--   holding this.
--
--   THE PATH CARRIES THE OWNER. `<profile_id>/<kind>/<uuid>`, which is what
--   the storage policy compares against — the same shape as booking photos,
--   for the same reason.
-- ---------------------------------------------------------------------------

create table if not exists public.provider_documents (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid references public.providers (id) on delete cascade,
  /** The person, not the listing: a document belongs to a human being. */
  profile_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('citizenship', 'pan', 'selfie', 'certificate', 'other')),
  storage_path text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  status text not null default 'pending'
    check (status in ('pending', 'verified', 'rejected', 'expired')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  /** Said to the professional, so a rejection is answerable rather than final. */
  rejection_reason text,
  uploaded_at timestamptz not null default now(),
  /** When we stop needing it. The retention half of the data inventory. */
  delete_after date
);

comment on table public.provider_documents is
  'Identity documents for provider verification. Private bucket, signed short-lived URLs, readable by the owner and admins only, and every admin read written to security_events.';

create index if not exists provider_documents_profile_idx
  on public.provider_documents (profile_id, uploaded_at desc);
create index if not exists provider_documents_pending_idx
  on public.provider_documents (status, uploaded_at)
  where status = 'pending';

alter table public.provider_documents enable row level security;

drop policy if exists "People read their own documents" on public.provider_documents;
create policy "People read their own documents"
  on public.provider_documents for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "Admins read every document" on public.provider_documents;
create policy "Admins read every document"
  on public.provider_documents for select to authenticated
  using (public.is_admin());

-- No insert or update policy for anybody. Uploads and review decisions go
-- through the service role after the server has checked who is asking — the
-- same rule as `payments` and `commission_appeals`, and for the same reason:
-- a row a client could write is a row an attacker can forge.

-- ---------------------------------------------------------------------------
-- The bucket. Private, small, and only the formats a document actually is.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'provider-documents',
  'provider-documents',
  false,
  5 * 1024 * 1024,
  array['image/jpeg', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "People read their own documents" on storage.objects;
create policy "People read their own documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'provider-documents'
    and (storage.foldername(name))[1] = ((select auth.uid()))::text
  );

drop policy if exists "Admins read every document file" on storage.objects;
create policy "Admins read every document file"
  on storage.objects for select to authenticated
  using (bucket_id = 'provider-documents' and public.is_admin());

drop policy if exists "People upload their own documents" on storage.objects;
create policy "People upload their own documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'provider-documents'
    and (storage.foldername(name))[1] = ((select auth.uid()))::text
  );

-- Deliberately no update or delete policy: a professional replacing a document
-- uploads a new one and the old row is marked, so the trail of what was
-- submitted and when survives a change of mind.
