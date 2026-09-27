-- AFTER-DEPLOY: this file drops categories.max_concurrent_jobs and tightens
--   three Nepali columns to not-null. Both are replayed harmlessly on a fresh
--   project; on a live one they need the deploy that stopped reading the
--   dropped column. The header lives in scripts/generate-seed-sql.mjs, not
--   here — editing this file is pointless, it is rewritten on every seed run.
--
-- GENERATED FILE — do not edit.
--
-- Written by scripts/generate-seed-sql.mjs from lib/data/seed/*.json.
-- Edit the JSON and re-run `npm run seed:sql`.
--
-- The providers below are DEVELOPMENT DATA: invented people, invented ratings,
-- invented job counts. They exist so the discovery screens can be designed and
-- reviewed against something that looks like a real market — deliberately
-- uneven, including a few 4.1s and some newcomers with nine jobs, because a
-- directory where everyone is 4.9 reads as fake. Delete them before real
-- providers are onboarded.

-- Categories ------------------------------------------------

-- These columns are declared here as well as in 20260913000003, and the
-- repetition is deliberate: this file is regenerated from the seed JSON but
-- keeps its 2026-08-30 position, so on a fresh project it runs BEFORE the
-- migration that adds them. `if not exists` makes whichever runs second a
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
    check (pricing_model in ('band', 'survey'));

-- max_concurrent_jobs used to be here and is gone. It was two facts under one
-- name: "do not block a painter while the first job dries", which was never
-- concurrency but JOB LENGTH and is modelled directly now, and "a firm with
-- three trucks does three moves", which is CREW SIZE and lives on
-- providers.crew_count. A trade has no opinion about either.
alter table public.categories
  drop column if exists max_concurrent_jobs;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('plumbing', 'Plumbing', 'प्लम्बिङ', 'Leaks, blocked drains, fittings', 'चुहावट, जाम, फिटिङ', 'Taps, pipes, drains, tanks and the pump that stopped working.', 'धारा, पाइप, ढल, ट्यांकी र नचल्ने पम्प।', 'plumbing', 'प्लम्बिङ', 350, 6000, 'researched', '2026-09-15', 'Cheapest published service 350; consultation 300-600; leak 500-1200; pipes/sink 1500-3000; geyser 1000-2000. A full bathroom fitting (8000-15000) is deliberately outside the band as a renovation quoted on site. Sajilo Sewa, Technical Sewa, Repairing Service Nepal. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'Wrench', 1)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('electrical', 'Electrical', 'बिजुली मर्मत', 'Wiring, switches, inverters', 'वायरिङ, स्विच, इन्भर्टर', 'Switches, sockets, MCBs, inverters and the light that will not come on.', 'स्विच, सकेट, एमसीबी, इन्भर्टर र नबल्ने बत्ती।', 'electrical', 'बिजुली मर्मत', 350, 5000, 'researched', '2026-09-15', 'Socket fitting 350, MCB 500, light point 550, decorative 650; one firm''s minimum service charge is 650 but that is their policy, not a market floor, so the floor is the cheapest real line item. Rewiring is quoted after a visit. Sajilo Sewa rate card. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'Zap', 2)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('home-cleaning', 'Home Cleaning', 'घर सरसफाइ', 'Deep clean, kitchen, bathrooms', 'गहिरो सफाइ, भान्सा, बाथरुम', 'Deep cleans, kitchens, bathrooms and the flat you are moving out of.', 'गहिरो सफाइ, भान्सा, बाथरुम र सर्नुपर्ने फ्ल्याट।', 'home cleaning', 'घर सरसफाइ', 800, 12000, 'researched', '2026-09-15', 'Basic housekeeping visit 800-1500 for 1-2 hours; standard 2BHK from 2500; deep clean from 5000. Post-construction (to 60000) excluded as a different product. Namaste Nepal Cleaning, Royal Cleaning. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'medium', 'band', 'Sparkles', 3)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('appliance-repair', 'Appliance Repair', 'उपकरण मर्मत', 'Fridge, washing machine, geyser', 'फ्रिज, वासिङ मेसिन, गिजर', 'Fridges, washing machines, geysers, microwaves and televisions.', 'फ्रिज, वासिङ मेसिन, गिजर, माइक्रोवेभ र टेलिभिजन।', 'appliance repair', 'उपकरण मर्मत', 500, 5000, 'researched', '2026-09-15', 'Only a published ''starting at 500'' was found, plus universal quote-before-repair and parts charged separately. The band is labour and diagnosis; the part is its own quote. Sajilo Sewa. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'medium', 'band', 'WashingMachine', 4)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('carpentry', 'Carpentry', 'सिकर्मी काम', 'Doors, furniture, fittings', 'ढोका, फर्निचर, फिटिङ', 'Doors, cupboards, hinges, shelves and furniture that needs rebuilding.', 'ढोका, दराज, कब्जा, र्‍याक र बनाउनुपर्ने फर्निचर।', 'carpentry', 'सिकर्मी काम', 500, 6000, 'researched', '2026-09-15', 'No per-call-out rate published anywhere; the figures that exist are for fabrication (550/sq ft up to 2200-3200/sq ft) which is not the hinge, lock and door work this category sells. Anchored to the skilled-trade day rate 900-1200 and the shape of the other repair trades. Homeplex, Ghatal Groups. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'low', 'band', 'Hammer', 5)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('pest-control', 'Pest Control', 'किरा नियन्त्रण', 'Cockroaches, termites, bed bugs', 'साङ्लो, धमिरा, उडुस', 'Cockroaches, termites, bed bugs and rodents, treated flat by flat.', 'साङ्लो, धमिरा, उडुस र मुसा — फ्ल्याटैपिच्छे उपचार।', 'pest control', 'किरा नियन्त्रण', 1500, 8000, 'researched', '2026-09-15', 'Only commercial rates are published: 4-15 per sq ft with an 800 sq ft minimum. Every residential provider quotes after inspection, so the residential floor is inference and is set low accordingly. Orange Ball. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'low', 'band', 'Bug', 6)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('painting', 'Painting', 'रङरोगन', 'Interior, exterior, touch-ups', 'भित्र, बाहिर, टचअप', 'Interior and exterior painting, damp patches and touch-ups.', 'भित्री र बाहिरी रङरोगन, ओसका दाग र टचअप।', 'painting', 'रङरोगन', 1000, 40000, 'researched', '2026-09-15', 'Labour only 8-15 per sq ft; labour plus materials 45-90; repaint 25-50; skilled labour 900-1200 a day. The band is wide because a labour-only repaint and a supply-and-paint job are two products - see the sub-bands. Reshape Home, Ghar Durbar, Ghatal Groups. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'medium', 'band', 'PaintRoller', 7)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('ac-servicing', 'AC Servicing & Gas Refill', 'एसी सर्भिसिङ', 'Servicing, gas top-up, install', 'सर्भिसिङ, ग्यास, जडान', 'Servicing, gas top-ups and installation for split and window units.', 'स्प्लिट र विन्डो एसीको सर्भिसिङ, ग्यास भर्ने र जडान।', 'AC servicing', 'एसी सर्भिसिङ', 500, 12000, 'researched', '2026-09-15', 'Repairs start at 500; deep-clean service 1200-2000; gas refill 3500-7500; split installation 5000-12000. The previous band was wrong at both ends. Everest Electro, Blue Diamond Service Centre. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'AirVent', 8)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('water-tank-cleaning', 'Water Tank Cleaning', 'पानी ट्यांकी सफाइ', 'Tanks, sumps, overhead drums', 'ट्यांकी, सम्प, माथिको ड्रम', 'Overhead drums, underground sumps and the water that started smelling.', 'माथिको ड्रम, भूमिगत ट्यांकी र गन्हाउन थालेको पानी।', 'water tank cleaning', 'पानी ट्यांकी सफाइ', 1500, 6000, 'researched', '2026-09-15', 'The best-published trade: steel/plastic 1500 for 1000L then 1/L; cemented 2400 to 6000L; beyond 8000L at 30 paisa/L; combined at 70 paisa/L; 100-200 transport outside the Ring Road. United Facility. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'Droplets', 9)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('movers-packers', 'Movers & Packers', 'सामान सार्ने सेवा', 'Shifting flats, offices, storage', 'फ्ल्याट, अफिस, भण्डारण सार्ने', 'Shifting a flat or an office, packing, loading and storage.', 'फ्ल्याट वा अफिस सार्ने, प्याकिङ, लोडिङ र भण्डारण।', 'moving & packing', 'सामान सार्ने', 5000, 20000, 'invented', null, 'No Nepali pricing is published by anybody: two searches, one in Nepali, found only quote-after-survey. That is the finding, and forcing a band onto it would invent the one number the market refuses to state. The category moves to a request-a-survey model and shows no band; these figures are the old guess and must not be displayed. Deliberately still `invented` so check:blockers keeps refusing launch until the survey flow exists.', 'low', 'survey', 'Truck', 10)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, descriptor_ne = excluded.descriptor_ne,
  description = excluded.description, description_ne = excluded.description_ne,
  cta_label = excluded.cta_label, cta_label_ne = excluded.cta_label_ne,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  pricing_source = excluded.pricing_source,
  pricing_checked_at = excluded.pricing_checked_at,
  pricing_note = excluded.pricing_note,
  pricing_confidence = excluded.pricing_confidence,
  pricing_model = excluded.pricing_model,
  icon = excluded.icon, sort_order = excluded.sort_order;


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

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'inspection', 'Inspection only', 'जाँच मात्र', 350, 600, 'researched', '2026-09-15', 'high', 'Consultation 300-600 across two sources; floored at the category minimum.', 1, 30, 1, 'invented', null, 'low', 'A look and a verdict. No published figure; the fee itself implies a short visit.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'leak', 'Tap or joint leak', 'धारा वा जोर्नीबाट चुहावट', 500, 1200, 'researched', '2026-09-15', 'high', 'Published directly: fixing a leak 500-1200.', 2, 45, 1, 'invented', null, 'low', 'A washer or a joint. Guessed from the job, not from a source.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'blockage', 'Blocked drain or commode', 'ढल वा कमोड जाम', 1200, 3000, 'researched', '2026-09-15', 'high', 'Published directly as blocked-drain clearing.', 3, 90, 1, 'invented', null, 'low', 'Rodding and clearing. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'pipe-work', 'Pipe replacement or new fitting', 'पाइप फेर्ने वा नयाँ फिटिङ', 1500, 3000, 'researched', '2026-09-15', 'high', 'Changing pipes 1500-3000; kitchen sink install the same.', 4, 120, 1, 'invented', null, 'low', 'Cutting, fitting and testing one run. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'geyser', 'Geyser fitting or repair', 'गिजर जडान वा मर्मत', 1000, 2000, 'researched', '2026-09-15', 'high', 'Geyser installation 1000-2000.', 5, 90, 1, 'invented', null, 'low', 'Mounting or stripping one unit. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'no-water', 'No water, pump or airlock', 'पानी नआएको, पम्प वा हावा अड्केको', 1000, 2800, 'researched', '2026-09-15', 'medium', 'Inferred from pump and pipe work rates; not separately published.', 6, 90, 1, 'invented', null, 'low', 'Tracing the fault is most of it. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('plumbing', 'burst', 'Burst pipe or flooding', 'पाइप फुटेको वा पानी पसेको', 1500, 6000, 'researched', '2026-09-15', 'medium', 'Emergency work is not separately published; anchored to pipe work plus urgency.', 7, 180, 1, 'invented', null, 'low', 'Stopping it, then making good. Guessed, and the spread is real.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('electrical', 'fitting', 'Socket, switch or light point', 'सकेट, स्विच वा बत्तीको पोइन्ट', 350, 650, 'researched', '2026-09-15', 'high', 'Rate card: socket 350, light point 550, decorative 650.', 8, 30, 1, 'invented', null, 'low', 'One point. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('electrical', 'mcb', 'MCB or fuse replacement', 'एमसीबी वा फ्युज फेर्ने', 500, 1200, 'researched', '2026-09-15', 'high', 'MCB replacement 500; the upper end allows for a board with several ways.', 9, 45, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('electrical', 'decorative', 'Decorative or extra lighting', 'सजावटी वा थप बत्ती', 650, 2500, 'researched', '2026-09-15', 'medium', 'Decorative light 650 per unit including 3m of wiring; several units reach the top.', 10, 120, 1, 'invented', null, 'low', 'Depends entirely on how many points. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('electrical', 'fault', 'Short circuit, sparking or burning smell', 'सर्ट सर्किट, आगोको झिल्का वा पोलेको गन्ध', 1500, 4000, 'researched', '2026-09-15', 'medium', 'Fault-finding is not published as a line item; anchored to the trade''s day rate.', 11, 120, 1, 'invented', null, 'low', 'Finding it is the work. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('electrical', 'rewiring', 'Rewiring a room', 'कोठाको वायरिङ फेर्ने', 2500, 5000, 'researched', '2026-09-15', 'low', 'Quoted after a visit everywhere. A judgement, not a citation.', 12, 480, 2, 'invented', null, 'low', 'Chasing, running and making good does not finish in a day. Guessed, and the second day is the least certain number here.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('home-cleaning', 'single-room', 'One room, kitchen or bathroom', 'एउटा कोठा, भान्सा वा बाथरुम', 800, 1500, 'researched', '2026-09-15', 'high', 'Basic housekeeping visit 800-1500 for 1-2 hours.', 13, 90, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('home-cleaning', 'standard', 'Standard clean, whole flat', 'सामान्य सफाइ, पूरै फ्ल्याट', 2500, 5000, 'researched', '2026-09-15', 'medium', 'Standard 2BHK from 2500; larger flats reach the top.', 14, 240, 1, 'invented', null, 'low', 'Two people for half a day, or one for a full one. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('home-cleaning', 'deep', 'Deep clean, whole flat', 'गहिरो सफाइ, पूरै फ्ल्याट', 5000, 12000, 'researched', '2026-09-15', 'medium', 'Deep clean 2BHK from 5000; general cleaning from 5500. Post-construction (to 60000) is a different product.', 15, 480, 1, 'invented', null, 'low', 'A full day. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('appliance-repair', 'diagnosis', 'Finding the fault', 'के बिग्रियो हेर्ने', 500, 1000, 'researched', '2026-09-15', 'medium', 'Published ''starting at 500''; the call-out is the floor of this trade.', 16, 45, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('appliance-repair', 'repair', 'Repair, labour only', 'मर्मत, ज्याला मात्र', 1200, 4000, 'researched', '2026-09-15', 'medium', 'Labour only. Parts are quoted separately everywhere, so they are not in the band.', 17, 120, 1, 'invented', null, 'low', 'Guessed; excludes waiting for a part, which is not our time.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('appliance-repair', 'major', 'Compressor, drum or control board', 'कम्प्रेसर, ड्रम वा बोर्ड', 2500, 5000, 'researched', '2026-09-15', 'low', 'Labour for a major strip-down. The part itself is a separate quote and is often the larger figure.', 18, 180, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('carpentry', 'small-fitting', 'Hinge, lock, handle or drawer', 'कब्जा, ताल्चा, ह्यान्डल वा दराज', 500, 1500, 'researched', '2026-09-15', 'low', 'No call-out rate is published for this trade; anchored to the skilled day rate 900-1200.', 19, 45, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('carpentry', 'door-window', 'Door or window repair', 'ढोका वा झ्याल मिलाउने', 1200, 3500, 'researched', '2026-09-15', 'low', 'Half a day of skilled labour plus fittings. Inferred.', 20, 180, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('carpentry', 'furniture-repair', 'Furniture repair', 'फर्निचर मर्मत', 1000, 4000, 'researched', '2026-09-15', 'low', 'Inferred. Published carpentry rates are for fabrication per sq ft, which is a different product.', 21, 180, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('carpentry', 'built-in', 'Cupboard or shelving rebuild', 'दराज वा र्‍याक बनाउने', 2500, 6000, 'researched', '2026-09-15', 'low', 'Approaches fabrication, where 550/sq ft and up is published. New furniture is quoted separately.', 22, 600, 2, 'invented', null, 'low', 'Building in place. Guessed, and the second day is a guess on top of a guess.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('pest-control', 'cockroach', 'Cockroaches or ants', 'कक्रोच र कमिला', 1500, 4000, 'researched', '2026-09-15', 'low', 'Residential prices are quote-after-inspection everywhere. Inferred from the commercial 4-15 per sq ft against a flat.', 23, 60, 1, 'invented', null, 'low', 'The spray is quick; the hours the customer must stay out are not our time and are not counted here.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('pest-control', 'bed-bugs', 'Bed bugs', 'उडुस', 3000, 6000, 'researched', '2026-09-15', 'low', 'Sits at the top of the residential range and needs a follow-up visit. Inferred.', 24, 120, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('pest-control', 'termite', 'Termite treatment', 'धमिरा', 4000, 8000, 'researched', '2026-09-15', 'low', 'The most expensive residential treatment and the one most often quoted per sq ft. Inferred.', 25, 180, 1, 'invented', null, 'low', 'Drilling and injecting. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('painting', 'touch-up', 'Touch-up or one wall, labour only', 'सानो टाल्ने वा एउटा भित्ता, ज्याला मात्र', 1000, 4000, 'researched', '2026-09-15', 'medium', 'Labour 8-15 per sq ft; a small area is under a day of a 900-1200 day rate.', 26, 180, 1, 'invented', null, 'low', 'One wall, one coat. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('painting', 'room-labour', 'One room, labour only', 'एउटा कोठा, ज्याला मात्र', 3000, 7000, 'researched', '2026-09-15', 'medium', 'About 400 sq ft of wall at 8-15 per sq ft.', 27, 480, 2, 'invented', null, 'low', 'Two coats with drying between them, so it does not fit in one day even though the hands-on time would. THIS IS THE CASE THE WHOLE MODEL EXISTS FOR.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('painting', 'room-supplied', 'One room, paint supplied', 'एउटा कोठा, रङसहित', 15000, 25000, 'researched', '2026-09-15', 'medium', '45-90 per sq ft for primer and two coats over roughly 400 sq ft.', 28, 960, 4, 'invented', null, 'low', 'Putty, primer and two coats, each needing the last to cure. Four days of the room being unusable for roughly two days of work.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('painting', 'flat', 'Whole flat, paint supplied', 'पूरै फ्ल्याट, रङसहित', 25000, 40000, 'researched', '2026-09-15', 'medium', 'Several rooms at 45-90 per sq ft. The reason this category cannot be one band.', 29, 3600, 7, 'invented', null, 'low', 'Same sequence, more rooms, and they overlap. The span is the number a customer plans around.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('ac-servicing', 'repair', 'Small repair or fault-finding', 'सानो मर्मत वा खराबी पत्ता लगाउने', 500, 1500, 'researched', '2026-09-15', 'high', 'Repairs published as starting at 500.', 30, 60, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('ac-servicing', 'service', 'Routine service and deep clean', 'नियमित सर्भिस र सफाइ', 1200, 2000, 'researched', '2026-09-15', 'high', 'Published directly by two sources: 1200-2000.', 31, 90, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('ac-servicing', 'gas', 'Gas refill', 'ग्यास भर्ने', 3500, 7500, 'researched', '2026-09-15', 'high', '3500-6000 after a leak fix; 4500-7500 for a full recharge by gas type and tonnage.', 32, 120, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('ac-servicing', 'install', 'Split installation', 'स्प्लिट एसी जडान', 5000, 12000, 'researched', '2026-09-15', 'high', '5000-12000 by copper run, drilling and whether a stabiliser is included.', 33, 240, 1, 'invented', null, 'low', 'Drilling, mounting, bracket and vacuum. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('water-tank-cleaning', 'overhead', 'Overhead tank, up to 1,000 L', 'माथिको ट्याङ्की, १,००० लिटरसम्म', 1500, 2000, 'researched', '2026-09-15', 'high', 'Steel or plastic 1500 for 1000 L, then 1 per extra litre.', 34, 90, 1, 'invented', null, 'low', 'Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('water-tank-cleaning', 'underground', 'Underground tank, up to 6,000 L', 'जमिनमुनिको ट्याङ्की, ६,००० लिटरसम्म', 2400, 3500, 'researched', '2026-09-15', 'high', 'Cemented or plastic 2400 up to 6000 L; 30 paisa per litre beyond 8000.', 35, 180, 1, 'invented', null, 'low', 'Draining is most of it. Guessed.');

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order, typical_working_minutes, typical_elapsed_days, duration_source, duration_checked_at, duration_confidence, duration_note)
values ('water-tank-cleaning', 'combined', 'Large or combined system', 'ठुलो वा जोडिएको ट्याङ्की', 3500, 6000, 'researched', '2026-09-15', 'high', 'Combined cement plus plastic at 70 paisa per litre, plus 100-200 transport outside the Ring Road.', 36, 300, 1, 'invented', null, 'low', 'Guessed.');


-- Every category now carries its Nepali copy, so the columns added in
-- 20260830000001 can stop being nullable. Kept here rather than in that
-- migration because this is the file that fills them.
alter table public.categories
  alter column descriptor_ne set not null,
  alter column description_ne set not null,
  alter column cta_label_ne set not null;


-- Providers (development data) -------------------------------


-- Reviews (development data) ---------------------------------

