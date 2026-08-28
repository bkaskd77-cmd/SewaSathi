-- Services and providers.
--
-- `categories` becomes the single source of truth for the ten services: the
-- landing grid, the catalogue, the category pages and the price bands quoted
-- to Claude all read from here, so repricing happens once. It is seeded from
-- lib/data/seed/categories.json by scripts/generate-seed-sql.mjs — that JSON
-- is the authored copy and the app's offline fallback.
--
-- Stats live in their own table on purpose. Phase 9 recomputes them from
-- finished bookings with a trigger; nothing writes them by hand, and keeping
-- them out of `providers` means that trigger never touches the row a provider
-- edits about themselves.

create table if not exists public.categories (
  slug text primary key,
  name_en text not null,
  name_ne text not null,
  descriptor text not null,
  description text not null,
  cta_label text not null,
  base_price_min integer not null check (base_price_min > 0),
  base_price_max integer not null check (base_price_max >= base_price_min),
  icon text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.providers (
  id uuid primary key default gen_random_uuid(),

  -- Null until a real person claims the listing. Phase 10 fills these in
  -- through provider onboarding; the seed rows have none.
  profile_id uuid references public.profiles (id) on delete set null,

  display_name text not null,
  bio text not null default '',
  photo_url text,

  -- Ward keys, e.g. {'lalitpur-4','lalitpur-3'}. See lib/config/areas.ts.
  service_areas text[] not null default '{}',
  years_experience integer not null default 0,

  is_verified boolean not null default false,
  verified_at timestamptz,
  id_document_status text not null default 'not_submitted'
    check (id_document_status in ('verified', 'pending', 'not_submitted')),

  -- What was actually checked: {'id','background','skill'}. Shown as a list on
  -- the profile, because "verified" on its own tells the customer nothing.
  checks text[] not null default '{}',

  -- Three states rather than a boolean: the customer filter is now / today /
  -- any, and "available" means something different to someone with a burst
  -- pipe than to someone booking a repaint.
  availability text not null default 'scheduled'
    check (availability in ('now', 'today', 'scheduled')),

  -- Kept as the simple boolean the rest of the schema can index on.
  is_available boolean generated always as (availability = 'now') stored,

  is_active boolean not null default true,
  base_rate integer not null check (base_rate > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.provider_categories (
  provider_id uuid not null references public.providers (id) on delete cascade,
  category_slug text not null references public.categories (slug) on delete cascade,
  primary key (provider_id, category_slug)
);

create table if not exists public.provider_stats (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  rating_avg numeric(2, 1) not null default 0 check (rating_avg between 0 and 5),
  rating_count integer not null default 0,
  jobs_completed integer not null default 0,
  completion_rate integer not null default 100 check (completion_rate between 0 and 100),
  avg_response_minutes integer not null default 120,
  last_active_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.provider_reviews (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  -- Free text until Phase 6 gives reviews a booking to hang off. Then this
  -- becomes a foreign key and a review requires a finished job.
  author_name text not null,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists provider_categories_category_idx
  on public.provider_categories (category_slug);

create index if not exists providers_service_areas_idx
  on public.providers using gin (service_areas);

create index if not exists providers_availability_idx
  on public.providers (availability) where is_active;

create index if not exists provider_stats_rating_idx
  on public.provider_stats (rating_avg desc, jobs_completed desc);

create index if not exists provider_reviews_provider_idx
  on public.provider_reviews (provider_id, created_at desc);

-- RLS. All five tables are public reads — this is a directory, and hiding it
-- from anonymous visitors would hide the product. Nothing is writable through
-- the anon key: seeding and Phase 10's provider onboarding go through the
-- service role and policies written then.

alter table public.categories enable row level security;
alter table public.providers enable row level security;
alter table public.provider_categories enable row level security;
alter table public.provider_stats enable row level security;
alter table public.provider_reviews enable row level security;

drop policy if exists "Anyone reads active categories" on public.categories;
create policy "Anyone reads active categories"
  on public.categories for select
  to anon, authenticated
  using (is_active);

drop policy if exists "Anyone reads active providers" on public.providers;
create policy "Anyone reads active providers"
  on public.providers for select
  to anon, authenticated
  using (is_active);

drop policy if exists "Anyone reads provider categories" on public.provider_categories;
create policy "Anyone reads provider categories"
  on public.provider_categories for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone reads provider stats" on public.provider_stats;
create policy "Anyone reads provider stats"
  on public.provider_stats for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone reads provider reviews" on public.provider_reviews;
create policy "Anyone reads provider reviews"
  on public.provider_reviews for select
  to anon, authenticated
  using (true);
