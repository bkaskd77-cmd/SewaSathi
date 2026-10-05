-- APPLIED VIA: the atomic path — one `DO $$ … END $$;` block through `apply_migration`,
--   one statement to the transport and one implicit transaction, with the
--   `supabase_migrations.schema_migrations` row inserted INSIDE the block so history
--   records the migration only if its DDL committed.
--   ONE DEVIATION, STATED RATHER THAN LEFT TO BE NOTICED: the `drop policy if exists` line
--   below was omitted from what was sent. A statement whose FIRST keyword is `DROP` hangs
--   that transport for 60 seconds and rolls back whole — measured, not theorised — and the
--   policy was new, so `create policy` alone was correct. The file keeps both halves,
--   because the db suite and a fresh project need the drop.
--
-- ADDS: public.content_document_working_copies.
-- CHANGES: the slug check on content_documents and content_document_versions widens from
--   four documents to eight; content_document_versions.effective_from gains a default.
-- REMOVES: nothing. No function is rebuilt. Two check constraints are dropped and added
--   back, which is `alter table ... drop constraint` and goes through this transport.

-- ---------------------------------------------------------------------------
-- A document somebody is still writing.
--
-- WHY A SEPARATE TABLE AND NOT AN UNPUBLISHED VERSION ROW. `content_document_versions`
-- is append-only for every caller including the service role, and that is the whole
-- reason versioning is worth having: `bookings.terms_version` points at the text a
-- customer agreed to, and if that text could change afterwards the pointer would name
-- something nobody ever saw. A row somebody is still editing has to be mutable, so it
-- cannot live there.
--
-- AND IT IS WHAT MAKES THE PREVIEW POSSIBLE AT ALL. A publish shows the rendered document
-- and a diff against what is live before it commits, and the renderer
-- (`components/shared/prose-document.tsx`) is an async Server Component — a client copy of
-- it would be two renderers of the legal pages, which is shared surface and where every
-- expensive bug in this product has lived. So the text has to be somewhere the server can
-- read it, and the only append-only alternative would have to stamp `effective_from` at
-- save time rather than at publish.
--
-- CALLED A WORKING COPY, NEVER A DRAFT. `ProseDocument.draft` already means "this text
-- has not been through legal review" and renders a notice to the customer; two meanings
-- for one word on the screen where somebody publishes the terms is a mistake waiting to
-- be made.
--
-- NOBODY AGREED TO A WORKING COPY, so it carries no history and is overwritten in place.
-- The history is the published versions.
-- ---------------------------------------------------------------------------

create table if not exists public.content_document_working_copies (
  /*
   * No foreign key to `content_documents`. A document exists because it is in the code —
   * the files under `lib/content/legal` and `lib/content/pages` are version zero of everything — and
   * the pointer row is only created when something is published. Requiring one here would
   * mean a document could not be edited until it had already been published once.
   */
  slug text primary key check (slug in (
    'terms', 'privacy', 'refunds', 'standards',
    'help', 'help/complaint', 'about', 'contact'
  )),

  /* The structured document as JSON, one per language. Same shape as a version's body. */
  body_en text not null,
  body_ne text not null,

  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.content_document_working_copies is
  'A document being written, before it is published. Mutable and overwritten in place, because nobody has agreed to it — the published versions are the history. Called a working copy, not a draft: ProseDocument.draft means "not reviewed by a lawyer".';

alter table public.content_document_working_copies enable row level security;
revoke insert, update, delete on public.content_document_working_copies from anon, authenticated;

-- ---------------------------------------------------------------------------
-- All eight long-form documents, not four.
--
-- The four already here are the ones a customer or a professional is held to. The other
-- four — help, the complaint page, about and contact — are prose of exactly the same shape
-- that nothing could edit, so "help pages" was in the scope for this work and unmet. They
-- come free: one constraint, and the routes read the live version like the legal ones.
--
-- VERSIONING THEM COSTS NOTHING AND ANSWERS SOMETHING. Nobody agrees to a contact page, so
-- its version number is not evidence of anything — but the append-only trail is still the
-- record of who changed the help text and when, which is the same question asked of any
-- other content edit.
-- ---------------------------------------------------------------------------

alter table public.content_documents
  drop constraint if exists content_documents_slug_check;

alter table public.content_documents
  add constraint content_documents_slug_check check (slug in (
    'terms', 'privacy', 'refunds', 'standards',
    'help', 'help/complaint', 'about', 'contact'
  ));

-- ---------------------------------------------------------------------------
-- The effective date is the publish moment, and the column says so now.
--
-- IT USED TO CLAIM OTHERWISE. Both this column's comment and `publishDocument` said a
-- document could be "drafted today and take effect next month" — and `readLive` serves
-- whatever `live_version` points at the instant it moves, so a future date was ignored.
-- A comment describing behaviour the code does not have is the failure this repository
-- records most often, so one of the two had to go.
--
-- SCHEDULING IS DEFERRED, WITH THE REASON. A future effective date means the product
-- serves text that is not yet in force while `createBooking` stamps bookings with its
-- version — a booking pointing at a document that was not in force when it was made,
-- which is worse than having no scheduling. Amending terms with notice also needs a way
-- to give the notice, and there is none. When there is, this column already holds the
-- date and the change is a form field rather than a migration.
--
-- A DEFAULT RATHER THAN A PARAMETER, so "recorded automatically" is structural. Nothing
-- that publishes can choose a date, because the publish path no longer takes one.
-- ---------------------------------------------------------------------------

alter table public.content_document_versions
  alter column effective_from set default now();

comment on column public.content_document_versions.effective_from is
  'When this text took effect, which is the moment it was published — defaulted, never passed in. Scheduling a future amendment is deferred: readLive serves whatever live_version points at, so a future date would serve text that is not yet in force.';

-- The versions table needs no change for the widening: its slug is a foreign key to
-- `content_documents`, so it inherits the widened set rather than restating it.

-- ---------------------------------------------------------------------------
-- Policies and grants
--
-- A WORKING COPY IS STAFF-ONLY, which is the one place this differs from the published
-- tables. Those are public because they are the words on a page anybody can open; an
-- unpublished one is text we have not stood behind yet, and a customer reading a half
-- edited refund policy would be reading something nobody approved.
--
-- AND IT GRANTS SELECT TO NOBODY BUT `authenticated`, where the policy then asks
-- `is_admin()`. A new table grants nothing by default since `20261002000001`, so the
-- grant is written out: a correct policy with no grant answers `permission denied` from
-- the planner, before any row is considered.
-- ---------------------------------------------------------------------------

drop policy if exists "Admins read working copies" on public.content_document_working_copies;
create policy "Admins read working copies"
  on public.content_document_working_copies for select to authenticated
  using (public.is_admin());

grant select on public.content_document_working_copies to authenticated;

-- The `supabase_migrations.schema_migrations` row is written by the apply, not by this
-- file — no other migration here carries one, and the test harness has no such schema.
-- It is recorded: version 20261004000004, applied and verified live on 2026-10-05.
