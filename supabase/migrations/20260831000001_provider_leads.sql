-- Professionals raising a hand, before provider onboarding exists.
--
-- /providers/join is the call to action for the entire supply side of the
-- marketplace and it returned 404. Real onboarding — documents, verification,
-- a dashboard — is Phase 10; this table is the interim, so that interest is
-- captured rather than lost while that is built.
--
-- Deliberately not `providers`. These are unverified strangers who filled in a
-- form; putting them in the table the customer-facing directory reads from is
-- exactly the mistake that would put an unchecked person in front of a
-- customer. Phase 10 promotes a lead to a provider after verification.

create table if not exists public.provider_leads (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  -- E.164, as everywhere else in the product.
  phone text not null,
  -- Slug from public.categories. A soft reference on purpose: renaming a
  -- category should not delete somebody's application.
  category_slug text not null,
  -- Ward key from lib/data/seed/areas.json, e.g. "lalitpur-4".
  area_key text not null,
  years_experience smallint not null check (years_experience between 0 and 60),
  note text,
  -- Where they came from, for working out which channel actually brings
  -- professionals in.
  locale text not null default 'en' check (locale in ('en', 'ne')),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'onboarded', 'rejected')),
  created_at timestamptz not null default now()
);

-- One application per number per trade. A second attempt updates the first
-- rather than filling the table with duplicates from somebody tapping twice.
create unique index if not exists provider_leads_phone_category_idx
  on public.provider_leads (phone, category_slug);

create index if not exists provider_leads_status_idx
  on public.provider_leads (status, created_at desc);

comment on table public.provider_leads is
  'Interest from professionals who want to join, captured before Phase 10 onboarding exists. Not the provider directory — these people are unverified.';

alter table public.provider_leads enable row level security;

-- Anyone may apply. Nobody may read the list back.
--
-- Insert-only for anon is the whole point: the form has to work for a
-- logged-out visitor, and the table holds names and phone numbers of people
-- who have not consented to being listed publicly. Without a select policy,
-- RLS denies every read through the anon key by default; the team reads this
-- through the Supabase dashboard on the service role.
drop policy if exists "Anyone may apply to join" on public.provider_leads;
create policy "Anyone may apply to join"
  on public.provider_leads for insert
  to anon, authenticated
  with check (true);
