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
  "supabase/migrations/20260829000002_services_seed.sql",
);

const read = (file) =>
  JSON.parse(readFileSync(path.join(ROOT, "lib/data/seed", file), "utf8"));

const categories = read("categories.json");
const providers = read("providers.json");
const reviews = read("reviews.json");

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

lines.push("-- Categories ------------------------------------------------\n");
for (const c of categories) {
  lines.push(
    `insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values (${q(c.slug)}, ${q(c.nameEn)}, ${q(c.nameNe)}, ${q(c.descriptor)}, ${q(c.description)}, ${q(c.ctaLabel)}, ${c.basePriceMin}, ${c.basePriceMax}, ${q(c.icon)}, ${c.sortOrder})
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;\n`,
  );
}

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
  `Wrote ${path.relative(ROOT, OUT)} — ${categories.length} categories, ${providers.length} providers, ${reviews.length} reviews.`,
);
