#!/usr/bin/env node
/**
 * Turn the authored seed JSON into a seed migration.
 *
 * `lib/data/seed/*.json` is written by hand and read by the app as its offline
 * fallback. This script is the only thing that turns it into SQL, so the rows
 * in the database and the rows the app falls back to cannot drift apart — and
 * nobody has to hand-write 28 INSERTs.
 *
 * Idempotent: every insert is an upsert keyed on the primary key, so running
 * the migration twice changes nothing. Run after editing the JSON:
 *
 *   npm run seed:sql
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const OUT = path.join(
  ROOT,
  "supabase/migrations/20260830000002_services_seed.sql",
);

const read = (file) =>
  JSON.parse(readFileSync(path.join(ROOT, "lib/data/seed", file), "utf8"));

const categories = read("categories.json");
const providers = read("providers.json");
const reviews = read("reviews.json");
const subBands = read("price-bands.json");

/** Single-quote escaping. These strings are authored by us, not user input. */
const q = (value) => `'${String(value).replace(/'/g, "''")}'`;
const arr = (values) => `ARRAY[${values.map(q).join(", ")}]::text[]`;
const bool = (value) => (value ? "true" : "false");

const lines = [];

lines.push(`-- GENERATED FILE — do not edit.
--
-- Written by scripts/generate-seed-sql.mjs from lib/data/seed/*.json.
-- Edit the JSON and re-run \`npm run seed:sql\`.
--
-- The providers below are DEVELOPMENT DATA: invented people, invented ratings,
-- invented job counts. They exist so the discovery screens can be designed and
-- reviewed against something that looks like a real market — deliberately
-- uneven, including a few 4.1s and some newcomers with nine jobs, because a
-- directory where everyone is 4.9 reads as fake. Delete them before real
-- providers are onboarded.
`);

lines.push(`-- Categories ------------------------------------------------

-- These columns are declared here as well as in 20260913000003, and the
-- repetition is deliberate: this file is regenerated from the seed JSON but
-- keeps its 2026-08-30 position, so on a fresh project it runs BEFORE the
-- migration that adds them. \`if not exists\` makes whichever runs second a
-- no-op. The same reason the not-null tightening at the end of this section
-- lives here rather than in the migration that added those columns.
alter table public.categories
  add column if not exists pricing_source text not null default 'invented'
    check (pricing_source in ('invented', 'researched', 'observed')),
  add column if not exists pricing_checked_at date,
  add column if not exists pricing_note text,
  add column if not exists pricing_confidence text not null default 'low'
    check (pricing_confidence in ('high', 'medium', 'low')),
  add column if not exists pricing_model text not null default 'band'
    check (pricing_model in ('band', 'survey')),
  add column if not exists max_concurrent_jobs integer not null default 2
    check (max_concurrent_jobs between 1 and 10);
`);
for (const c of categories) {
  lines.push(
    `insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values (${q(c.slug)}, ${q(c.nameEn)}, ${q(c.nameNe)}, ${q(c.descriptor)}, ${q(c.descriptorNe)}, ${q(c.description)}, ${q(c.descriptionNe)}, ${q(c.ctaLabel)}, ${q(c.ctaLabelNe)}, ${c.basePriceMin}, ${c.basePriceMax}, ${c.maxConcurrentJobs}, ${q(c.pricingSource)}, ${c.pricingCheckedAt ? q(c.pricingCheckedAt) : "null"}, ${c.pricingNote ? q(c.pricingNote) : "null"}, ${q(c.pricingConfidence)}, ${q(c.pricingModel)}, ${q(c.icon)}, ${c.sortOrder})
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  max_concurrent_jobs = excluded.max_concurrent_jobs,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;\n`,
  );
}

// --- Sub-bands ------------------------------------------------------------
//
// One product inside a trade, with its own range and its own provenance. These
// were a hand-written string per category in lib/ai/price-bands.ts until
// 2026-09-15 — a hint to the model that could not be measured, revised or
// sourced. The category band is the union of these, exactly, and a test asserts
// it: a sub-band outside the category range would quote a figure the clamp then
// refuses.
lines.push(`
-- Sub-bands ---------------------------------------------------

create table if not exists public.category_price_bands (
  category_slug text not null references public.categories (slug) on delete cascade,
  slug text not null,
  label_en text not null,
  label_ne text not null,
  low integer not null check (low > 0),
  high integer not null check (high >= low),
  pricing_source text not null default 'invented'
    check (pricing_source in ('invented', 'researched', 'observed')),
  pricing_checked_at date,
  pricing_confidence text not null default 'low'
    check (pricing_confidence in ('high', 'medium', 'low')),
  pricing_note text,
  sort_order integer not null default 0,
  -- HOW LONG THE PROFESSIONAL IS ON THE TOOLS, and how long the customer's
  -- home is a building site. Two numbers because for painting they diverge:
  -- a room takes four days and a painter a few hours of each, and modelling
  -- that with one number is what categories.max_concurrent_jobs was doing.
  typical_working_minutes integer not null check (typical_working_minutes > 0),
  typical_elapsed_days integer not null check (typical_elapsed_days between 1 and 30),
  -- ITS OWN PROVENANCE, SEPARATE FROM THE PRICE'S, because researching what a
  -- job costs is not researching how long it takes. Every row is invented
  -- today, which is exactly why no customer is shown a duration yet.
  duration_source text not null default 'invented'
    check (duration_source in ('invented', 'researched', 'observed')),
  duration_checked_at date,
  duration_confidence text not null default 'low'
    check (duration_confidence in ('high', 'medium', 'low')),
  duration_note text,
  primary key (category_slug, slug)
);

comment on table public.category_price_bands is
  'One product inside a trade, with its own price range and provenance. The number the triage narrows to is what the customer actually reads, so it is researched and dated like any published price.';

alter table public.category_price_bands enable row level security;

drop policy if exists "Price bands are public" on public.category_price_bands;
create policy "Price bands are public"
  on public.category_price_bands for select
  to anon, authenticated
  using (true);

-- Rewritten wholesale on every seed run, so a sub-band removed from the JSON
-- disappears from the table rather than lingering as a row nobody authored.
delete from public.category_price_bands;
`);

for (const b of subBands) {
  lines.push(
    `insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values (${q(b.categorySlug)}, ${q(b.slug)}, ${q(b.labelEn)}, ${q(b.labelNe)}, ${b.low}, ${b.high}, ${q(b.pricingSource)}, ${b.pricingCheckedAt ? q(b.pricingCheckedAt) : "null"}, ${q(b.pricingConfidence)}, ${b.pricingNote ? q(b.pricingNote) : "null"}, ${b.sortOrder}, ${b.typicalWorkingMinutes}, ${b.typicalElapsedDays}, ${q(b.durationSource)}, ${b.durationCheckedAt ? q(b.durationCheckedAt) : "null"}, ${q(b.durationConfidence)}, ${b.durationNote ? q(b.durationNote) : "null"});\n`,
  );
}

lines.push(`
-- Every category now carries its Nepali copy, so the columns added in
-- 20260830000001 can stop being nullable. Kept here rather than in that
-- migration because this is the file that fills them.
alter table public.categories
  alter column descriptor_ne set not null,
  alter column description_ne set not null,
  alter column cta_label_ne set not null;
`);

lines.push(
  "\n-- Providers (development data) -------------------------------\n",
);
for (const p of providers) {
  const verifiedAt = p.isVerified
    ? `now() - interval '${60 + (p.yearsExperience % 30)} days'`
    : "null";

  lines.push(
    `insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values (${q(p.id)}, ${q(p.displayName)}, ${q(p.bio)}, ${arr(p.serviceAreas)}, ${p.yearsExperience}, ${bool(p.isVerified)}, ${verifiedAt}, ${q(p.idDocumentStatus)}, ${arr(p.checks)}, ${q(p.availability)}, ${p.baseRate})
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;\n`,
  );

  for (const slug of p.categories) {
    lines.push(
      `insert into public.provider_categories (provider_id, category_slug) values (${q(p.id)}, ${q(slug)}) on conflict do nothing;`,
    );
  }

  const s = p.stats;
  lines.push(
    `\ninsert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values (${q(p.id)}, ${s.ratingAvg}, ${s.ratingCount}, ${s.jobsCompleted}, ${s.completionRate}, ${s.avgResponseMinutes}, now() - interval '${s.lastActiveMinutesAgo} minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();\n`,
  );
}

lines.push(
  "\n-- Reviews (development data) ---------------------------------\n",
);
for (const r of reviews) {
  lines.push(
    `insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values (${q(r.id)}, ${q(r.providerId)}, ${q(r.author)}, ${r.rating}, ${q(r.comment)}, now() - interval '${r.daysAgo} days')
on conflict (id) do nothing;`,
  );
}

const sql = lines.join("\n") + "\n";
writeFileSync(OUT, sql);

console.log(
  `Wrote ${path.relative(ROOT, OUT)} — ${categories.length} categories, ${subBands.length} sub-bands, ${providers.length} providers, ${reviews.length} reviews.`,
);
