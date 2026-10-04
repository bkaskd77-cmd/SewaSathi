-- ADDS: public.content_strings, public.content_string_revisions,
--   public.content_documents, public.content_document_versions;
--   bookings.terms_version; categories.icon check constraint.
-- REMOVES: nothing. No function is rebuilt and no existing policy is redefined.

-- ---------------------------------------------------------------------------
-- Letting a person change what the product says, without Code.
--
-- WHAT IS HARDCODED TODAY AND WHY THAT IS A PROBLEM. Every interface string lives in
-- `messages/en.json` and `messages/ne.json` — 1,855 keys each — and every long-form
-- document in a TypeScript module under `lib/content/`. Changing a price explanation,
-- a safety sentence or a line of the terms means a commit, a review and a deploy. That
-- is the right process for behaviour and the wrong one for wording: the person who
-- knows the wording is wrong is usually not the person who can push.
--
-- AN OVERRIDE, NOT A COPY. `content_strings` holds only what somebody has changed. The
-- JSON catalogues stay the source of truth, which keeps three things working that
-- would otherwise have to be rebuilt: `check:messages` comparing the two languages key
-- by key, `check:keys` proving every key the code asks for exists, and a fresh clone
-- with no database rendering the whole product. A key with no row here reads from JSON,
-- so the table being empty is the normal state rather than a broken one.
--
-- `admin.*` IS DELIBERATELY NOT EDITABLE, and that is a product decision rather than a
-- scope cut. 551 of the 1,855 keys are strings only staff read — including the strings
-- on the editing screen itself. An admin who breaks `admin.content.save` breaks the
-- button they would need to fix it, and no customer ever sees the benefit. The
-- application enforces the exclusion; this table carries no opinion, because a check
-- constraint listing namespaces would be a second copy of a list that already exists.

-- ---------------------------------------------------------------------------
-- 1. The strings
-- ---------------------------------------------------------------------------

create table if not exists public.content_strings (
  id uuid primary key default gen_random_uuid(),

  /* The dotted path as next-intl reads it: `home.lead`, `booking.payment.title`. */
  message_key text not null,
  locale text not null check (locale in ('en', 'ne')),
  value text not null check (length(value) between 1 and 4000),

  /*
   * WHICH TIER THIS KEY BELONGS TO, copied from the rule that already decides it.
   * `scripts/ne-review-scope.mjs` maps a namespace prefix to `money`, `safety`,
   * `legal` or `staff`, and `BLOCKING_TIERS` is the three that block a launch. The
   * tier is stored rather than derived at read time because it decides whether an
   * edit keeps history, and a history rule that changed retroactively when somebody
   * edited a script would be no rule at all.
   */
  tier text not null check (tier in ('money', 'safety', 'legal', 'staff', 'none')),

  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  /* One override per key per language. An edit updates; it never accumulates rows. */
  constraint content_strings_key_locale_unique unique (message_key, locale)
);

comment on table public.content_strings is
  'Interface strings an admin has changed. An override over messages/*.json, never a copy of it — a key with no row here reads from the catalogue, so an empty table is the normal state.';

alter table public.content_strings enable row level security;
revoke insert, update, delete on public.content_strings from anon, authenticated;

create index if not exists content_strings_key_idx
  on public.content_strings (message_key);

-- ---------------------------------------------------------------------------
-- 2. What it used to say
-- ---------------------------------------------------------------------------

create table if not exists public.content_string_revisions (
  id uuid primary key default gen_random_uuid(),
  message_key text not null,
  locale text not null check (locale in ('en', 'ne')),

  /*
   * The value BEFORE the edit. Null means there was no override — the key was reading
   * from the JSON catalogue — which is a real previous state and the one a rollback
   * most often wants: "put it back to what the developers wrote". A rollback to null
   * deletes the override rather than writing an empty string, and those two are not
   * the same thing on a screen.
   */
  previous_value text,
  new_value text not null,
  tier text not null,

  changed_by uuid references public.profiles (id),
  changed_at timestamptz not null default now()
);

comment on table public.content_string_revisions is
  'Every change to an interface string, append-only. Rollback is re-applying a revision rather than trusting an undo, which is why this cannot be edited.';

alter table public.content_string_revisions enable row level security;
revoke insert, update, delete on public.content_string_revisions from anon, authenticated;

create index if not exists content_string_revisions_key_idx
  on public.content_string_revisions (message_key, locale, changed_at desc);

-- ---------------------------------------------------------------------------
-- 3. The long-form documents
-- ---------------------------------------------------------------------------

create table if not exists public.content_documents (
  slug text primary key check (slug in ('terms', 'privacy', 'refunds', 'standards')),
  /* Which version is being served. Null until somebody publishes one. */
  live_version integer,
  updated_at timestamptz not null default now()
);

comment on table public.content_documents is
  'The four long-form documents. The row is a pointer at a published version; the prose lives in content_document_versions.';

create table if not exists public.content_document_versions (
  id uuid primary key default gen_random_uuid(),
  slug text not null references public.content_documents (slug) on delete cascade,
  version integer not null check (version > 0),

  body_en text not null,
  body_ne text not null,

  /*
   * WHEN THIS TEXT STARTS APPLYING, which is not the same as when it was written.
   * A document can be drafted today and take effect next month, and a customer who
   * booked yesterday agreed to what was in force yesterday.
   */
  effective_from timestamptz not null,

  published_by uuid references public.profiles (id),
  published_at timestamptz not null default now(),

  constraint content_document_versions_unique unique (slug, version)
);

comment on table public.content_document_versions is
  'Each published version of a document, with the date it takes effect. Append-only: a version somebody agreed to cannot be edited afterwards, which is the whole reason for versioning it.';

alter table public.content_documents enable row level security;
alter table public.content_document_versions enable row level security;
revoke insert, update, delete on public.content_documents from anon, authenticated;
revoke insert, update, delete on public.content_document_versions from anon, authenticated;

create index if not exists content_document_versions_slug_idx
  on public.content_document_versions (slug, version desc);

-- ---------------------------------------------------------------------------
-- 4. Which terms a booking was taken under
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists terms_version integer;

-- NULL IS "BEFORE VERSIONING EXISTED", NEVER "VERSION 1" — rule 6, and here it is a
-- statement about a person rather than about a column. Every booking taken so far was
-- made against text that was never versioned; writing 1 into those rows would assert
-- that each of those customers was shown a specific document, which nobody can know.
-- Nothing is backfilled. `profiles_record_role_change` refuses the same manufactured
-- record one table over.
comment on column public.bookings.terms_version is
  'The content_document_versions.version of the terms in force when this booking was made. Null means the booking predates versioning — never version 1, and never backfilled.';

-- ---------------------------------------------------------------------------
-- 5. Category icons the cards can actually draw
-- ---------------------------------------------------------------------------

-- A FREE-TEXT ICON NAME IS A BLANK CARD WAITING TO HAPPEN. The catalogue renders a
-- lucide component by name, so a name that is not an export renders nothing at all — on
-- the grid that is the first thing a customer sees. That was survivable while the ten
-- names only came from a seed file nobody edited at runtime; it stops being survivable
-- the moment an admin can type one. `REFUSAL_REASON_CODES` is the same arrangement: the
-- offered set IS the storable set, written once in `lib/config/icons.ts`, and
-- `tests/unit/category-icons.test.ts` asserts this list, that one and the live rows all
-- agree.
--
-- THE LIST CAME FROM THE DATABASE, AND THE FIRST ATTEMPT DID NOT. It was written from
-- the seed file's opening rows with the remainder guessed, and Postgres refused it:
-- `ac-servicing` is `AirVent`, guessed as `Wind`. The constraint caught the guess before
-- it could blank a live card, which is exactly what a check on a rendering key is for.
alter table public.categories
  drop constraint if exists categories_icon_known;

alter table public.categories
  add constraint categories_icon_known check (icon in (
    -- In use today.
    'Wrench', 'Zap', 'Sparkles', 'WashingMachine', 'Hammer',
    'Bug', 'PaintRoller', 'AirVent', 'Droplets', 'Truck',
    -- Spares, so adding a trade needs no migration.
    'Plug', 'Sofa', 'Trees', 'Package', 'Wind',
    'Flame', 'ShowerHead', 'Lightbulb', 'Refrigerator', 'Hotel'
  ));

-- ---------------------------------------------------------------------------
-- 6. Append-only triggers, then policies and grants
-- ---------------------------------------------------------------------------

drop trigger if exists content_string_revisions_append_only on public.content_string_revisions;
create trigger content_string_revisions_append_only
  before update or delete on public.content_string_revisions
  for each row execute function public.refuse_rewrite();

drop trigger if exists content_document_versions_append_only on public.content_document_versions;
create trigger content_document_versions_append_only
  before update or delete on public.content_document_versions
  for each row execute function public.refuse_rewrite();

/*
 * PUBLIC READ ON THE STRINGS AND THE DOCUMENTS, because that is what they are: the
 * words on a page anybody can open. The landing page is server-rendered through the
 * service role, so this grant is not what makes the product work — it is what keeps
 * the table honest about what it holds. Nothing here is personal data; `updated_by`
 * is a staff id and is not exposed by any read the application makes.
 */
drop policy if exists "Interface strings are public" on public.content_strings;
create policy "Interface strings are public"
  on public.content_strings for select to anon, authenticated
  using (true);

drop policy if exists "Documents are public" on public.content_documents;
create policy "Documents are public"
  on public.content_documents for select to anon, authenticated
  using (true);

drop policy if exists "Document versions are public" on public.content_document_versions;
create policy "Document versions are public"
  on public.content_document_versions for select to anon, authenticated
  using (true);

/* The history is staff-only: it carries who changed what, which is about people. */
drop policy if exists "Admins read the string history" on public.content_string_revisions;
create policy "Admins read the string history"
  on public.content_string_revisions for select to authenticated
  using (public.is_admin());

grant select on public.content_strings to anon, authenticated;
grant select on public.content_documents to anon, authenticated;
grant select on public.content_document_versions to anon, authenticated;
grant select on public.content_string_revisions to authenticated;
