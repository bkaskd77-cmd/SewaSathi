-- ---------------------------------------------------------------------------
-- Provider onboarding: the application, and the keys that outlive it.
--
-- TWO SEPARATE QUESTIONS, and the schema keeps them apart because platforms
-- that collapse them end up with a "verified" tick that means nothing:
--
--     identity   — is this person who they claim to be?
--     competence — can this person actually do the trade?
--
-- A citizenship certificate answers the first and says nothing about the
-- second. `provider_documents.proves` is not a column because the answer is a
-- property of the KIND, and `lib/verification/requirements.ts` holds it; what
-- IS here is `application_assessments`, which is the only evidence of
-- competence for the six trades CTEVT does not certify.
--
-- THE PART THAT MATTERS MOST IS `application_match_keys`. The check at the
-- door is not what keeps a dangerous person out of somebody's home — a removed
-- provider returning under a new phone number is, and a phone number costs a
-- hundred rupees. So removal is enforced by what is expensive to change, and
-- the keys are computed AT SUBMISSION and indexed, never derived at review
-- time: a comparison that runs at review time silently stops running the day
-- somebody adds a second review path.
--
-- THE KEYS ARE HASHED. A table holding every applicant's citizenship number
-- next to their address is a table whose leak is catastrophic, and the
-- normalisation in `lib/verification/match-keys.ts` is deliberately built so
-- that matching is EQUALITY — which survives hashing. The intelligence lives
-- in the normaliser precisely so the storage can be blind.
--
-- A HIT NEVER REJECTS ANYBODY. There is no column here that automatically
-- refuses an application, and there must never be one. A hit surfaces the
-- prior record to a human: a false positive costs a reviewer a minute, a false
-- negative puts a removed provider back in a customer's kitchen.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The application itself
-- ---------------------------------------------------------------------------

create table if not exists public.provider_applications (
  id uuid primary key default gen_random_uuid(),

  -- The human being. Created by the existing phone OTP before step one, so
  -- there is always somebody to attach a resumable draft to.
  profile_id uuid not null references public.profiles (id) on delete cascade,

  /*
   * RESUMABLE BY CONSTRUCTION: every field below is nullable.
   *
   * The applicant is on a cheap Android phone on mobile data and the session
   * WILL drop — that is the normal case here, not the edge case. Each step
   * saves what it has, so coming back three days later on a different phone
   * resumes rather than restarts. A schema with NOT NULL on step-three fields
   * would make step three unsaveable until step seven.
   */
  full_name text check (char_length(full_name) between 2 and 120),
  full_name_ne text check (char_length(full_name_ne) between 2 and 120),
  date_of_birth date,

  -- Slugs from public.categories. Soft reference, as with provider_leads:
  -- renaming a category must not delete somebody's application.
  trades text[] not null default '{}',
  years_experience smallint check (years_experience between 0 and 60),

  -- Ward keys from lib/data/seed/areas.json.
  service_areas text[] not null default '{}',

  /*
   * Identity numbers, stored so a reviewer can read them against the
   * photographed document. The MATCH is done on the hashed key in
   * `application_match_keys`, never on these — which is why the retention
   * sweep can redact these while the keys keep working.
   */
  citizenship_number text check (char_length(citizenship_number) <= 40),
  pan_number text check (char_length(pan_number) <= 20),

  -- Where the money goes. Also one of the strongest duplicate keys there is:
  -- the wallet is where the money already arrives, and people do not abandon
  -- money.
  payout_method text check (payout_method in ('bank', 'esewa', 'khalti')),
  payout_account text check (char_length(payout_account) <= 40),
  payout_bank_name text check (char_length(payout_bank_name) <= 120),

  /*
   * Which step they have reached, so the form knows where to reopen.
   *
   * A number rather than a name because the steps are ordered and the order is
   * the product decision; the names live in the message catalogue.
   */
  step smallint not null default 1 check (step between 1 and 8),

  status text not null default 'draft' check (
    status in ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'withdrawn')
  ),

  /*
   * Written by the server at submission. Never by the client.
   *
   * `risk_score` is for SORTING a queue. The evidence a reviewer actually
   * reads is recomputed from the match keys and documents, which is why there
   * is no `risk_reasons` column — a frozen list of reasons goes stale the
   * moment a document is re-uploaded, and a stale reason is worse than none.
   */
  risk_score smallint check (risk_score between 0 and 100),
  submitted_at timestamptz,

  -- Anti-bot, kept as evidence rather than acted on alone.
  device_fingerprint text check (char_length(device_fingerprint) <= 200),

  locale text not null default 'en' check (locale in ('en', 'ne')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.provider_applications is
  'A resumable provider application. Every field nullable on purpose: the applicant is on a cheap phone on mobile data and the session will drop. Identity and competence are answered separately.';

create index if not exists provider_applications_profile_idx
  on public.provider_applications (profile_id, created_at desc);

-- The review queue's own index: everything waiting, oldest first, because
-- waiting is what the sort is dominated by.
create index if not exists provider_applications_queue_idx
  on public.provider_applications (status, submitted_at)
  where status in ('submitted', 'in_review');

/*
 * ONE OPEN APPLICATION PER PERSON.
 *
 * Not one per person ever — somebody rejected for a missing police clearance
 * comes back with it, and that is the case the 90-day document window exists
 * for. This stops a queue filling with duplicates from one person tapping
 * twice, which is the actual failure.
 */
create unique index if not exists provider_applications_one_open_idx
  on public.provider_applications (profile_id)
  where status in ('draft', 'submitted', 'in_review');

-- ---------------------------------------------------------------------------
-- The match keys
-- ---------------------------------------------------------------------------

create table if not exists public.application_match_keys (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.provider_applications (id) on delete cascade,

  kind text not null check (
    kind in ('document', 'account', 'name', 'area', 'device', 'face')
  ),

  /*
   * SHA-256 of the normalised value, hex. Never the value itself.
   *
   * The normaliser is built so that matching is equality — Devanagari numerals
   * folded, separators dropped, names reduced to a phonetic skeleton — which
   * is exactly what makes hashing possible here. Storing the raw values and
   * running edit-distance at review time would be the more obvious design and
   * would make this table a second copy of every applicant's identity.
   */
  key_hash text not null check (char_length(key_hash) = 64),

  created_at timestamptz not null default now()
);

comment on table public.application_match_keys is
  'Hashed, normalised identifiers computed at submission. This is what makes a removal permanent: it is enforced by what is expensive to change, never by a phone number. A hit surfaces a prior record to a human and never rejects anybody.';

create unique index if not exists application_match_keys_unique_idx
  on public.application_match_keys (application_id, kind, key_hash);

-- The lookup the duplicate check actually runs: given a key, who else has it?
create index if not exists application_match_keys_lookup_idx
  on public.application_match_keys (kind, key_hash);

-- ---------------------------------------------------------------------------
-- Consent
-- ---------------------------------------------------------------------------

create table if not exists public.application_consents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.provider_applications (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,

  /*
   * WHICH WORDS THEY AGREED TO. "They consented" is worth nothing without
   * this: if the wording changes next year, the only way to know what somebody
   * actually agreed to is to have recorded the version beside the timestamp.
   */
  consent_version text not null check (char_length(consent_version) <= 40),
  -- The document kinds this consent covers, so an upload outside it is
  -- refused rather than quietly accepted.
  scope text[] not null,

  /*
   * SERVER TIME, NOT THE CLIENT'S. A consent timestamp a browser could set is
   * a consent timestamp an attacker could set, and this is the row that would
   * be produced if anybody ever asked under the Individual Privacy Act.
   */
  granted_at timestamptz not null default now(),
  request_ip text,
  user_agent text check (char_length(user_agent) <= 400),

  -- Withdrawal is a right under the Act. Recorded rather than deleted, because
  -- the fact that consent once existed is itself part of the record.
  withdrawn_at timestamptz
);

comment on table public.application_consents is
  'Consent to collect identity and biometric documents, under Nepal''s Individual Privacy Act 2075. Versioned and server-stamped: consent to an older wording is consent to different words and does not carry.';

create index if not exists application_consents_application_idx
  on public.application_consents (application_id, granted_at desc);

-- ---------------------------------------------------------------------------
-- Competence: references and the practical assessment
-- ---------------------------------------------------------------------------

create table if not exists public.application_references (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.provider_applications (id) on delete cascade,

  name text not null check (char_length(name) between 2 and 120),
  phone text not null check (char_length(phone) between 10 and 20),
  relationship text check (
    relationship in ('employer', 'customer', 'colleague', 'other')
  ),

  /*
   * CONTACTED AND RECORDED, or it is not a reference — it is a phone number on
   * a form. `outcome` starts as not_contacted and that IS a risk signal,
   * scored against US rather than against the applicant: it is our gap.
   */
  outcome text not null default 'not_contacted' check (
    outcome in ('not_contacted', 'positive', 'negative', 'unreachable')
  ),
  contacted_by uuid references public.profiles (id) on delete set null,
  contacted_at timestamptz,
  note text check (char_length(note) <= 1000),

  created_at timestamptz not null default now()
);

comment on table public.application_references is
  'Prior employers or customers, contacted and recorded. An uncontacted reference is scored as our gap, not as the applicant''s fault.';

create index if not exists application_references_application_idx
  on public.application_references (application_id);

create table if not exists public.application_assessments (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.provider_applications (id) on delete cascade,

  category_slug text not null,

  /*
   * A RECORD A PERSON FILLS IN, NOT AN AUTOMATED TEST.
   *
   * At tens of providers a human watching somebody sweat a joint is both
   * better evidence and cheaper than anything that could be built, and a
   * multiple-choice quiz about plumbing measures whether somebody can read.
   * The assessor is NAMED because an assessment nobody is accountable for is
   * a rubber stamp.
   */
  assessor_id uuid not null references public.profiles (id) on delete restrict,
  assessed_at timestamptz not null default now(),
  method text not null default 'in_person' check (
    method in ('in_person', 'video', 'supervised_job')
  ),
  result text not null check (result in ('pass', 'fail', 'conditional')),
  -- What they were actually asked to do. Free text on purpose: a trade's
  -- practical test is not a schema.
  notes text not null check (char_length(notes) between 10 and 4000),

  created_at timestamptz not null default now()
);

comment on table public.application_assessments is
  'A practical assessment, recorded by a named assessor. The competence evidence for the trades CTEVT does not certify, and the alternative route for somebody with twenty years on the tools and no certificate.';

create index if not exists application_assessments_application_idx
  on public.application_assessments (application_id);

-- ---------------------------------------------------------------------------
-- Decisions
-- ---------------------------------------------------------------------------

create table if not exists public.application_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.provider_applications (id) on delete cascade,

  decision text not null check (
    decision in ('approved', 'rejected', 'more_info', 'withdrawn')
  ),

  -- `restrict`, not `set null`: removing an account must not erase who made a
  -- decision. Same reasoning as booking_status_history.changed_by.
  decided_by uuid not null references public.profiles (id) on delete restrict,
  decided_at timestamptz not null default now(),

  /*
   * A REASON THE APPLICANT CAN ACT ON.
   *
   * Not an internal note — this is shown to them. "Rejected" with no reason is
   * how a genuine tradesperson with a fixable problem becomes a competitor's
   * supply, and the 90-day document window exists exactly so they can come
   * back with the missing paper.
   */
  reason text not null check (char_length(reason) between 5 and 2000),
  reason_ne text check (char_length(reason_ne) <= 2000),
  -- Kept for us, never shown.
  internal_note text check (char_length(internal_note) <= 4000),

  -- What the queue was showing at the moment of the decision, so a decision
  -- can be understood later rather than only re-derived from today's data.
  risk_score_at_decision smallint
);

comment on table public.application_decisions is
  'Every decision, with who made it, when, and a reason the applicant can act on. Append-only: a decision that can be edited is not a record.';

create index if not exists application_decisions_application_idx
  on public.application_decisions (application_id, decided_at desc);

-- ---------------------------------------------------------------------------
-- Documents: what Phase 9 built, extended for what Phase 10 collects
-- ---------------------------------------------------------------------------

alter table public.provider_documents
  add column if not exists application_id uuid
    references public.provider_applications (id) on delete cascade;

alter table public.provider_documents
  add column if not exists expires_on date;

-- 0–1, from the client-side capture check. Kept so a reviewer can sort the
-- unreadable to the bottom, and so the risk score has something to read.
alter table public.provider_documents
  add column if not exists capture_quality real
    check (capture_quality between 0 and 1);

-- The police clearance and the CTEVT certificate did not exist as kinds in
-- Phase 9, because nothing collected them yet.
alter table public.provider_documents
  drop constraint if exists provider_documents_kind_check;
alter table public.provider_documents
  add constraint provider_documents_kind_check check (
    kind in ('citizenship', 'pan', 'selfie', 'certificate', 'police_clearance', 'ctevt', 'other')
  );

create index if not exists provider_documents_application_idx
  on public.provider_documents (application_id);

-- Re-verification reads this: anything with a date, soonest first.
create index if not exists provider_documents_expiry_idx
  on public.provider_documents (expires_on)
  where expires_on is not null;

-- ---------------------------------------------------------------------------
-- Providers: standing, and the link back to the application
-- ---------------------------------------------------------------------------

/*
 * A newly approved professional is not equivalent to one with 200 jobs, and
 * the schema should not pretend otherwise. `lib/verification/probation.ts`
 * decides when this changes; the column is what the dispatch pool reads.
 */
alter table public.providers
  add column if not exists standing text not null default 'provisional'
    check (standing in ('provisional', 'established'));

alter table public.providers
  add column if not exists approved_at timestamptz;

alter table public.providers
  add column if not exists application_id uuid
    references public.provider_applications (id) on delete set null;

/*
 * Removal, and it has to be permanent.
 *
 * `removed_at` ends the listing; the match keys are what stop the person
 * behind it coming back. Kept as its own column rather than folded into
 * `is_active`, because "taking a break" and "removed for cause" are not the
 * same state and a schema that conflates them will let one be undone as if it
 * were the other.
 */
alter table public.providers
  add column if not exists removed_at timestamptz;

alter table public.providers
  add column if not exists removal_reason text;

create index if not exists providers_standing_idx
  on public.providers (standing)
  where removed_at is null;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.provider_applications enable row level security;
alter table public.application_match_keys enable row level security;
alter table public.application_consents enable row level security;
alter table public.application_references enable row level security;
alter table public.application_assessments enable row level security;
alter table public.application_decisions enable row level security;

/*
 * THE SELECT POLICY CARRIES NO STATUS CONDITION, and that is not an oversight.
 *
 * Postgres applies a table's SELECT policies to the NEW row on UPDATE. A
 * policy reading "your own application while it is a draft" would mean the
 * update that moves it from draft to submitted makes the row invisible to the
 * person making it, and the update fails — the same trap that stopped a
 * professional releasing their own job in Phase 8, found the same way.
 */
drop policy if exists "Applicants read their own application" on public.provider_applications;
create policy "Applicants read their own application"
  on public.provider_applications for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "Admins read every application" on public.provider_applications;
create policy "Admins read every application"
  on public.provider_applications for select to authenticated
  using (public.is_admin());

drop policy if exists "Applicants start their own application" on public.provider_applications;
create policy "Applicants start their own application"
  on public.provider_applications for insert to authenticated
  with check (profile_id = (select auth.uid()) and status = 'draft');

/*
 * They may edit their own draft. RLS IS ROW-LEVEL, so this also lets them
 * write `status = 'approved'` and `risk_score = 0` — Postgres has no
 * per-column clause. `enforce_application_immutability` below is the actual
 * rule; this policy only decides which ROWS are theirs.
 */
drop policy if exists "Applicants edit their own draft" on public.provider_applications;
create policy "Applicants edit their own draft"
  on public.provider_applications for update to authenticated
  using (profile_id = (select auth.uid()) and status = 'draft')
  with check (profile_id = (select auth.uid()));

-- Match keys: hashed, and still not something a browser has any business
-- reading. Admins only; every write goes through the service role.
drop policy if exists "Admins read match keys" on public.application_match_keys;
create policy "Admins read match keys"
  on public.application_match_keys for select to authenticated
  using (public.is_admin());

drop policy if exists "Applicants read their own consent" on public.application_consents;
create policy "Applicants read their own consent"
  on public.application_consents for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "Admins read every consent" on public.application_consents;
create policy "Admins read every consent"
  on public.application_consents for select to authenticated
  using (public.is_admin());

/*
 * No insert policy for anybody. A consent row a client could write is a
 * consent row an attacker could forge, and this is the one row that would be
 * produced if somebody ever asked under the Act.
 */

drop policy if exists "Applicants manage their own references" on public.application_references;
create policy "Applicants manage their own references"
  on public.application_references for select to authenticated
  using (
    exists (
      select 1 from public.provider_applications a
      where a.id = application_references.application_id
        and a.profile_id = (select auth.uid())
    )
  );

drop policy if exists "Admins read every reference" on public.application_references;
create policy "Admins read every reference"
  on public.application_references for select to authenticated
  using (public.is_admin());

/*
 * An applicant may NOT read their own assessment or the decision's internal
 * note. The assessment is evidence about them written by somebody else, and a
 * reviewer who knows the subject will read their notes writes different notes.
 * The reason for a decision reaches them through the product, worded for them.
 */
drop policy if exists "Admins read assessments" on public.application_assessments;
create policy "Admins read assessments"
  on public.application_assessments for select to authenticated
  using (public.is_admin());

drop policy if exists "Admins read decisions" on public.application_decisions;
create policy "Admins read decisions"
  on public.application_decisions for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- The trigger that makes the update policy safe
-- ---------------------------------------------------------------------------

create or replace function public.enforce_application_immutability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  /*
   * The service role is how the server writes, and `auth.uid()` is null for
   * it. Everything below is about a browser holding a user's JWT.
   */
  if auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  /*
   * AN APPLICANT MAY MOVE THEIR OWN DRAFT FORWARD ONE STEP AND NO FURTHER.
   *
   * draft -> submitted is theirs to make. Everything after that is a decision
   * about them, and a decision somebody can write about themselves is not a
   * decision. Without this, the update policy above would let them write
   * `status = 'approved'` straight from a browser.
   */
  if new.status is distinct from old.status
     and not (old.status = 'draft' and new.status in ('submitted', 'withdrawn'))
  then
    raise exception 'An application''s status is not the applicant''s to set.';
  end if;

  -- The score sorts a queue; it is ours.
  if new.risk_score is distinct from old.risk_score then
    raise exception 'risk_score is set by the server.';
  end if;

  if new.submitted_at is distinct from old.submitted_at then
    raise exception 'submitted_at is set by the server.';
  end if;

  if new.profile_id is distinct from old.profile_id then
    raise exception 'An application cannot change hands.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.enforce_application_immutability() from public;

drop trigger if exists enforce_application_immutability on public.provider_applications;
create trigger enforce_application_immutability
  before update on public.provider_applications
  for each row execute function public.enforce_application_immutability();

-- ---------------------------------------------------------------------------
-- Decisions and assessments are append-only
-- ---------------------------------------------------------------------------

/*
 * A decision that can be edited is not a record, and neither is an assessment.
 * The trigger refuses UPDATE and DELETE for EVERY caller, the service role
 * included — the same rule as `security_events`, and for the same reason: a
 * log the application can rewrite proves nothing.
 */
create or replace function public.refuse_rewrite()
returns trigger
language plpgsql
-- Pinned like every other function here, so the Security Advisor has nothing
-- new to say. The body resolves nothing but `tg_table_name`, so empty is safe.
set search_path = ''
as $$
begin
  raise exception 'Rows in % are append-only.', tg_table_name;
end;
$$;

revoke execute on function public.refuse_rewrite() from public;

drop trigger if exists application_decisions_append_only on public.application_decisions;
create trigger application_decisions_append_only
  before update or delete on public.application_decisions
  for each row execute function public.refuse_rewrite();

drop trigger if exists application_assessments_append_only on public.application_assessments;
create trigger application_assessments_append_only
  before update or delete on public.application_assessments
  for each row execute function public.refuse_rewrite();
