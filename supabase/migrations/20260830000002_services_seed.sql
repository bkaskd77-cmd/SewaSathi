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
    check (pricing_model in ('band', 'survey')),
  add column if not exists max_concurrent_jobs integer not null default 2
    check (max_concurrent_jobs between 1 and 10);

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('plumbing', 'Plumbing', 'प्लम्बिङ', 'Leaks, blocked drains, fittings', 'चुहावट, जाम, फिटिङ', 'Taps, pipes, drains, tanks and the pump that stopped working.', 'धारा, पाइप, ढल, ट्यांकी र नचल्ने पम्प।', 'plumbing', 'प्लम्बिङ', 350, 6000, 2, 'researched', '2026-09-15', 'Cheapest published service 350; consultation 300-600; leak 500-1200; pipes/sink 1500-3000; geyser 1000-2000. A full bathroom fitting (8000-15000) is deliberately outside the band as a renovation quoted on site. Sajilo Sewa, Technical Sewa, Repairing Service Nepal. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'Wrench', 1)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('electrical', 'Electrical', 'बिजुली मर्मत', 'Wiring, switches, inverters', 'वायरिङ, स्विच, इन्भर्टर', 'Switches, sockets, MCBs, inverters and the light that will not come on.', 'स्विच, सकेट, एमसीबी, इन्भर्टर र नबल्ने बत्ती।', 'electrical', 'बिजुली मर्मत', 350, 5000, 3, 'researched', '2026-09-15', 'Socket fitting 350, MCB 500, light point 550, decorative 650; one firm''s minimum service charge is 650 but that is their policy, not a market floor, so the floor is the cheapest real line item. Rewiring is quoted after a visit. Sajilo Sewa rate card. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'Zap', 2)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('home-cleaning', 'Home Cleaning', 'घर सरसफाइ', 'Deep clean, kitchen, bathrooms', 'गहिरो सफाइ, भान्सा, बाथरुम', 'Deep cleans, kitchens, bathrooms and the flat you are moving out of.', 'गहिरो सफाइ, भान्सा, बाथरुम र सर्नुपर्ने फ्ल्याट।', 'home cleaning', 'घर सरसफाइ', 800, 12000, 1, 'researched', '2026-09-15', 'Basic housekeeping visit 800-1500 for 1-2 hours; standard 2BHK from 2500; deep clean from 5000. Post-construction (to 60000) excluded as a different product. Namaste Nepal Cleaning, Royal Cleaning. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'medium', 'band', 'Sparkles', 3)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('appliance-repair', 'Appliance Repair', 'उपकरण मर्मत', 'Fridge, washing machine, geyser', 'फ्रिज, वासिङ मेसिन, गिजर', 'Fridges, washing machines, geysers, microwaves and televisions.', 'फ्रिज, वासिङ मेसिन, गिजर, माइक्रोवेभ र टेलिभिजन।', 'appliance repair', 'उपकरण मर्मत', 500, 5000, 2, 'researched', '2026-09-15', 'Only a published ''starting at 500'' was found, plus universal quote-before-repair and parts charged separately. The band is labour and diagnosis; the part is its own quote. Sajilo Sewa. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'medium', 'band', 'WashingMachine', 4)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('carpentry', 'Carpentry', 'सिकर्मी काम', 'Doors, furniture, fittings', 'ढोका, फर्निचर, फिटिङ', 'Doors, cupboards, hinges, shelves and furniture that needs rebuilding.', 'ढोका, दराज, कब्जा, र्‍याक र बनाउनुपर्ने फर्निचर।', 'carpentry', 'सिकर्मी काम', 500, 6000, 2, 'researched', '2026-09-15', 'No per-call-out rate published anywhere; the figures that exist are for fabrication (550/sq ft up to 2200-3200/sq ft) which is not the hinge, lock and door work this category sells. Anchored to the skilled-trade day rate 900-1200 and the shape of the other repair trades. Homeplex, Ghatal Groups. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'low', 'band', 'Hammer', 5)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('pest-control', 'Pest Control', 'किरा नियन्त्रण', 'Cockroaches, termites, bed bugs', 'साङ्लो, धमिरा, उडुस', 'Cockroaches, termites, bed bugs and rodents, treated flat by flat.', 'साङ्लो, धमिरा, उडुस र मुसा — फ्ल्याटैपिच्छे उपचार।', 'pest control', 'किरा नियन्त्रण', 1500, 8000, 2, 'researched', '2026-09-15', 'Only commercial rates are published: 4-15 per sq ft with an 800 sq ft minimum. Every residential provider quotes after inspection, so the residential floor is inference and is set low accordingly. Orange Ball. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'low', 'band', 'Bug', 6)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('painting', 'Painting', 'रङरोगन', 'Interior, exterior, touch-ups', 'भित्र, बाहिर, टचअप', 'Interior and exterior painting, damp patches and touch-ups.', 'भित्री र बाहिरी रङरोगन, ओसका दाग र टचअप।', 'painting', 'रङरोगन', 1000, 40000, 3, 'researched', '2026-09-15', 'Labour only 8-15 per sq ft; labour plus materials 45-90; repaint 25-50; skilled labour 900-1200 a day. The band is wide because a labour-only repaint and a supply-and-paint job are two products - see the sub-bands. Reshape Home, Ghar Durbar, Ghatal Groups. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'medium', 'band', 'PaintRoller', 7)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('ac-servicing', 'AC Servicing & Gas Refill', 'एसी सर्भिसिङ', 'Servicing, gas top-up, install', 'सर्भिसिङ, ग्यास, जडान', 'Servicing, gas top-ups and installation for split and window units.', 'स्प्लिट र विन्डो एसीको सर्भिसिङ, ग्यास भर्ने र जडान।', 'AC servicing', 'एसी सर्भिसिङ', 500, 12000, 2, 'researched', '2026-09-15', 'Repairs start at 500; deep-clean service 1200-2000; gas refill 3500-7500; split installation 5000-12000. The previous band was wrong at both ends. Everest Electro, Blue Diamond Service Centre. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'AirVent', 8)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('water-tank-cleaning', 'Water Tank Cleaning', 'पानी ट्यांकी सफाइ', 'Tanks, sumps, overhead drums', 'ट्यांकी, सम्प, माथिको ड्रम', 'Overhead drums, underground sumps and the water that started smelling.', 'माथिको ड्रम, भूमिगत ट्यांकी र गन्हाउन थालेको पानी।', 'water tank cleaning', 'पानी ट्यांकी सफाइ', 1500, 6000, 1, 'researched', '2026-09-15', 'The best-published trade: steel/plastic 1500 for 1000L then 1/L; cemented 2400 to 6000L; beyond 8000L at 30 paisa/L; combined at 70 paisa/L; 100-200 transport outside the Ring Road. United Facility. Floor set at the bottom of the researched range, not its middle: published prices come from firms that advertise, while the independent mistri who does not publish is cheaper, so every researched figure carries an upward bias. clampRate moves a professional''s rate UP into the band, which takes money from customers and inflates the commission basis, so the error is taken low on purpose.', 'high', 'band', 'Droplets', 9)
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
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, descriptor_ne, description, description_ne, cta_label, cta_label_ne, base_price_min, base_price_max, max_concurrent_jobs, pricing_source, pricing_checked_at, pricing_note, pricing_confidence, pricing_model, icon, sort_order)
values ('movers-packers', 'Movers & Packers', 'सामान सार्ने सेवा', 'Shifting flats, offices, storage', 'फ्ल्याट, अफिस, भण्डारण सार्ने', 'Shifting a flat or an office, packing, loading and storage.', 'फ्ल्याट वा अफिस सार्ने, प्याकिङ, लोडिङ र भण्डारण।', 'moving & packing', 'सामान सार्ने', 5000, 20000, 1, 'invented', null, 'No Nepali pricing is published by anybody: two searches, one in Nepali, found only quote-after-survey. That is the finding, and forcing a band onto it would invent the one number the market refuses to state. The category moves to a request-a-survey model and shows no band; these figures are the old guess and must not be displayed. Deliberately still `invented` so check:blockers keeps refusing launch until the survey flow exists.', 'low', 'survey', 'Truck', 10)
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

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'inspection', 'Inspection only', 'जाँच मात्र', 350, 600, 'researched', '2026-09-15', 'high', 'Consultation 300-600 across two sources; floored at the category minimum.', 1);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'leak', 'Tap or joint leak', 'धारा वा जोर्नीबाट चुहावट', 500, 1200, 'researched', '2026-09-15', 'high', 'Published directly: fixing a leak 500-1200.', 2);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'blockage', 'Blocked drain or commode', 'ढल वा कमोड जाम', 1200, 3000, 'researched', '2026-09-15', 'high', 'Published directly as blocked-drain clearing.', 3);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'pipe-work', 'Pipe replacement or new fitting', 'पाइप फेर्ने वा नयाँ फिटिङ', 1500, 3000, 'researched', '2026-09-15', 'high', 'Changing pipes 1500-3000; kitchen sink install the same.', 4);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'geyser', 'Geyser fitting or repair', 'गिजर जडान वा मर्मत', 1000, 2000, 'researched', '2026-09-15', 'high', 'Geyser installation 1000-2000.', 5);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'no-water', 'No water, pump or airlock', 'पानी नआएको, पम्प वा हावा अड्केको', 1000, 2800, 'researched', '2026-09-15', 'medium', 'Inferred from pump and pipe work rates; not separately published.', 6);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('plumbing', 'burst', 'Burst pipe or flooding', 'पाइप फुटेको वा पानी पसेको', 1500, 6000, 'researched', '2026-09-15', 'medium', 'Emergency work is not separately published; anchored to pipe work plus urgency.', 7);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('electrical', 'fitting', 'Socket, switch or light point', 'सकेट, स्विच वा बत्तीको पोइन्ट', 350, 650, 'researched', '2026-09-15', 'high', 'Rate card: socket 350, light point 550, decorative 650.', 8);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('electrical', 'mcb', 'MCB or fuse replacement', 'एमसीबी वा फ्युज फेर्ने', 500, 1200, 'researched', '2026-09-15', 'high', 'MCB replacement 500; the upper end allows for a board with several ways.', 9);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('electrical', 'decorative', 'Decorative or extra lighting', 'सजावटी वा थप बत्ती', 650, 2500, 'researched', '2026-09-15', 'medium', 'Decorative light 650 per unit including 3m of wiring; several units reach the top.', 10);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('electrical', 'fault', 'Short circuit, sparking or burning smell', 'सर्ट सर्किट, आगोको झिल्का वा पोलेको गन्ध', 1500, 4000, 'researched', '2026-09-15', 'medium', 'Fault-finding is not published as a line item; anchored to the trade''s day rate.', 11);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('electrical', 'rewiring', 'Rewiring a room', 'कोठाको वायरिङ फेर्ने', 2500, 5000, 'researched', '2026-09-15', 'low', 'Quoted after a visit everywhere. A judgement, not a citation.', 12);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('home-cleaning', 'single-room', 'One room, kitchen or bathroom', 'एउटा कोठा, भान्सा वा बाथरुम', 800, 1500, 'researched', '2026-09-15', 'high', 'Basic housekeeping visit 800-1500 for 1-2 hours.', 13);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('home-cleaning', 'standard', 'Standard clean, whole flat', 'सामान्य सफाइ, पूरै फ्ल्याट', 2500, 5000, 'researched', '2026-09-15', 'medium', 'Standard 2BHK from 2500; larger flats reach the top.', 14);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('home-cleaning', 'deep', 'Deep clean, whole flat', 'गहिरो सफाइ, पूरै फ्ल्याट', 5000, 12000, 'researched', '2026-09-15', 'medium', 'Deep clean 2BHK from 5000; general cleaning from 5500. Post-construction (to 60000) is a different product.', 15);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('appliance-repair', 'diagnosis', 'Finding the fault', 'के बिग्रियो हेर्ने', 500, 1000, 'researched', '2026-09-15', 'medium', 'Published ''starting at 500''; the call-out is the floor of this trade.', 16);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('appliance-repair', 'repair', 'Repair, labour only', 'मर्मत, ज्याला मात्र', 1200, 4000, 'researched', '2026-09-15', 'medium', 'Labour only. Parts are quoted separately everywhere, so they are not in the band.', 17);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('appliance-repair', 'major', 'Compressor, drum or control board', 'कम्प्रेसर, ड्रम वा बोर्ड', 2500, 5000, 'researched', '2026-09-15', 'low', 'Labour for a major strip-down. The part itself is a separate quote and is often the larger figure.', 18);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('carpentry', 'small-fitting', 'Hinge, lock, handle or drawer', 'कब्जा, ताल्चा, ह्यान्डल वा दराज', 500, 1500, 'researched', '2026-09-15', 'low', 'No call-out rate is published for this trade; anchored to the skilled day rate 900-1200.', 19);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('carpentry', 'door-window', 'Door or window repair', 'ढोका वा झ्याल मिलाउने', 1200, 3500, 'researched', '2026-09-15', 'low', 'Half a day of skilled labour plus fittings. Inferred.', 20);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('carpentry', 'furniture-repair', 'Furniture repair', 'फर्निचर मर्मत', 1000, 4000, 'researched', '2026-09-15', 'low', 'Inferred. Published carpentry rates are for fabrication per sq ft, which is a different product.', 21);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('carpentry', 'built-in', 'Cupboard or shelving rebuild', 'दराज वा र्‍याक बनाउने', 2500, 6000, 'researched', '2026-09-15', 'low', 'Approaches fabrication, where 550/sq ft and up is published. New furniture is quoted separately.', 22);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('pest-control', 'cockroach', 'Cockroaches or ants', 'कक्रोच र कमिला', 1500, 4000, 'researched', '2026-09-15', 'low', 'Residential prices are quote-after-inspection everywhere. Inferred from the commercial 4-15 per sq ft against a flat.', 23);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('pest-control', 'bed-bugs', 'Bed bugs', 'उडुस', 3000, 6000, 'researched', '2026-09-15', 'low', 'Sits at the top of the residential range and needs a follow-up visit. Inferred.', 24);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('pest-control', 'termite', 'Termite treatment', 'धमिरा', 4000, 8000, 'researched', '2026-09-15', 'low', 'The most expensive residential treatment and the one most often quoted per sq ft. Inferred.', 25);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('painting', 'touch-up', 'Touch-up or one wall, labour only', 'सानो टाल्ने वा एउटा भित्ता, ज्याला मात्र', 1000, 4000, 'researched', '2026-09-15', 'medium', 'Labour 8-15 per sq ft; a small area is under a day of a 900-1200 day rate.', 26);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('painting', 'room-labour', 'One room, labour only', 'एउटा कोठा, ज्याला मात्र', 3000, 7000, 'researched', '2026-09-15', 'medium', 'About 400 sq ft of wall at 8-15 per sq ft.', 27);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('painting', 'room-supplied', 'One room, paint supplied', 'एउटा कोठा, रङसहित', 15000, 25000, 'researched', '2026-09-15', 'medium', '45-90 per sq ft for primer and two coats over roughly 400 sq ft.', 28);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('painting', 'flat', 'Whole flat, paint supplied', 'पूरै फ्ल्याट, रङसहित', 25000, 40000, 'researched', '2026-09-15', 'medium', 'Several rooms at 45-90 per sq ft. The reason this category cannot be one band.', 29);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('ac-servicing', 'repair', 'Small repair or fault-finding', 'सानो मर्मत वा खराबी पत्ता लगाउने', 500, 1500, 'researched', '2026-09-15', 'high', 'Repairs published as starting at 500.', 30);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('ac-servicing', 'service', 'Routine service and deep clean', 'नियमित सर्भिस र सफाइ', 1200, 2000, 'researched', '2026-09-15', 'high', 'Published directly by two sources: 1200-2000.', 31);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('ac-servicing', 'gas', 'Gas refill', 'ग्यास भर्ने', 3500, 7500, 'researched', '2026-09-15', 'high', '3500-6000 after a leak fix; 4500-7500 for a full recharge by gas type and tonnage.', 32);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('ac-servicing', 'install', 'Split installation', 'स्प्लिट एसी जडान', 5000, 12000, 'researched', '2026-09-15', 'high', '5000-12000 by copper run, drilling and whether a stabiliser is included.', 33);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('water-tank-cleaning', 'overhead', 'Overhead tank, up to 1,000 L', 'माथिको ट्याङ्की, १,००० लिटरसम्म', 1500, 2000, 'researched', '2026-09-15', 'high', 'Steel or plastic 1500 for 1000 L, then 1 per extra litre.', 34);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('water-tank-cleaning', 'underground', 'Underground tank, up to 6,000 L', 'जमिनमुनिको ट्याङ्की, ६,००० लिटरसम्म', 2400, 3500, 'researched', '2026-09-15', 'high', 'Cemented or plastic 2400 up to 6000 L; 30 paisa per litre beyond 8000.', 35);

insert into public.category_price_bands (category_slug, slug, label_en, label_ne, low, high, pricing_source, pricing_checked_at, pricing_confidence, pricing_note, sort_order)
values ('water-tank-cleaning', 'combined', 'Large or combined system', 'ठुलो वा जोडिएको ट्याङ्की', 3500, 6000, 'researched', '2026-09-15', 'high', 'Combined cement plus plastic at 70 paisa per litre, plus 100-200 transport outside the Ring Road.', 36);


-- Every category now carries its Nepali copy, so the columns added in
-- 20260830000001 can stop being nullable. Kept here rather than in that
-- migration because this is the file that fills them.
alter table public.categories
  alter column descriptor_ne set not null,
  alter column description_ne set not null,
  alter column cta_label_ne set not null;


-- Providers (development data) -------------------------------

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('d431eabc-3d3f-5b99-a484-03ffe615e7e9', 'Ramesh Tamang', 'Twelve years on Kathmandu Valley plumbing. Most of my work is leaks and blocked lines in older buildings, and I carry the common fittings on the bike so a single visit usually finishes it.', ARRAY['lalitpur-4', 'lalitpur-3', 'lalitpur-10']::text[], 12, true, now() - interval '72 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('d431eabc-3d3f-5b99-a484-03ffe615e7e9', 'plumbing') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('d431eabc-3d3f-5b99-a484-03ffe615e7e9', 0, 0, 0, 100, 120, now() - interval '4 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'Sabina Maharjan', 'I run a two-person cleaning team, mostly deep cleans and move-outs. We bring our own supplies and we do not charge extra for the kitchen.', ARRAY['lalitpur-3', 'lalitpur-4', 'kathmandu-10']::text[], 7, true, now() - interval '67 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1600)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 0, 0, 0, 100, 120, now() - interval '11 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'Dipak Shrestha', 'Licensed electrician. Wiring faults, MCB tripping and inverter installs. I explain what failed before I quote, because most people have been overcharged for a fuse at least once.', ARRAY['kathmandu-10', 'kathmandu-31', 'kathmandu-32']::text[], 15, true, now() - interval '75 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 850)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'electrical') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('852371c7-8dc8-56cf-94bd-c8677f63ef4e', 0, 0, 0, 100, 120, now() - interval '2 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'Krishna Bahadur Gurung', 'Carpenter by training, twenty years. Doors, cupboards and window frames. I take painting jobs when the carpentry is finished, so a room can be done in one go.', ARRAY['kathmandu-16', 'kathmandu-14']::text[], 20, true, now() - interval '80 days', 'verified', ARRAY['id', 'skill']::text[], 'today', 1100)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'carpentry') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'painting') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('5ed12c82-9a80-5836-ba8e-215c7312b1bf', 0, 0, 0, 100, 120, now() - interval '180 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('abda134f-2de4-547a-85d8-d0c122e657b2', 'Anita Rai', 'AC servicing and gas top-ups, plus fridge and washing machine work. I trained with a Samsung service centre and still use their diagnostic order.', ARRAY['kathmandu-10', 'kathmandu-31', 'lalitpur-10']::text[], 6, true, now() - interval '66 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1800)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('abda134f-2de4-547a-85d8-d0c122e657b2', 'ac-servicing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('abda134f-2de4-547a-85d8-d0c122e657b2', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('abda134f-2de4-547a-85d8-d0c122e657b2', 0, 0, 0, 100, 120, now() - interval '7 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'Bikash Thapa', 'Plumbing and tank cleaning around Bhaktapur. Tanks are the half of the job nobody thinks about until the water tastes wrong.', ARRAY['bhaktapur-4', 'bhaktapur-6', 'bhaktapur-9']::text[], 9, true, now() - interval '69 days', 'verified', ARRAY['id', 'background']::text[], 'today', 950)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'plumbing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'water-tank-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 0, 0, 0, 100, 120, now() - interval '95 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('6324d929-612e-59e9-b327-4638ffa42b7e', 'Sunita Karki', 'Cleaning and pest treatment. For cockroaches I do the gel treatment first and a follow-up after two weeks, which is included in the price.', ARRAY['kathmandu-26', 'kathmandu-16', 'kathmandu-4']::text[], 5, true, now() - interval '65 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1700)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('6324d929-612e-59e9-b327-4638ffa42b7e', 'home-cleaning') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('6324d929-612e-59e9-b327-4638ffa42b7e', 'pest-control') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('6324d929-612e-59e9-b327-4638ffa42b7e', 0, 0, 0, 100, 120, now() - interval '20 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('18f47ede-45d4-5765-804e-59e38c10b176', 'Manoj Yadav', 'Electrical and appliance repair. Geysers and washing machines are most of it. I tell you the part price before I open anything.', ARRAY['kathmandu-31', 'kathmandu-32', 'kathmandu-10']::text[], 11, true, now() - interval '71 days', 'verified', ARRAY['id', 'skill']::text[], 'today', 900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('18f47ede-45d4-5765-804e-59e38c10b176', 'electrical') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('18f47ede-45d4-5765-804e-59e38c10b176', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('18f47ede-45d4-5765-804e-59e38c10b176', 0, 0, 0, 100, 120, now() - interval '35 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('f11ef900-5841-5189-9bad-40e5f38db33d', 'Prakash Lama', 'Shifting flats and small offices with a four-person crew and our own truck. We wrap furniture properly; the cheap quotes usually do not.', ARRAY['kathmandu-14', 'kathmandu-16', 'lalitpur-14']::text[], 8, true, now() - interval '68 days', 'verified', ARRAY['id', 'background']::text[], 'today', 6000)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('f11ef900-5841-5189-9bad-40e5f38db33d', 'movers-packers') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('f11ef900-5841-5189-9bad-40e5f38db33d', 0, 0, 0, 100, 120, now() - interval '240 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('54054138-1656-5c5a-8c6a-897284a44c42', 'Rita Shrestha', 'Regular household cleaning, weekly or fortnightly. Most of my customers have been with me over a year, which I take as the review that matters.', ARRAY['kathmandu-4', 'kathmandu-7', 'kathmandu-26']::text[], 4, true, now() - interval '64 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('54054138-1656-5c5a-8c6a-897284a44c42', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('54054138-1656-5c5a-8c6a-897284a44c42', 0, 0, 0, 100, 120, now() - interval '6 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('6381912d-d0af-5b06-82d6-935d1edf95f3', 'Hari Prasad Adhikari', 'Interior and exterior painting with a three-man team. I measure and quote per square foot after seeing the walls; damp patches change the price and I will say so.', ARRAY['lalitpur-10', 'lalitpur-14', 'kathmandu-31']::text[], 18, true, now() - interval '78 days', 'verified', ARRAY['id', 'skill']::text[], 'scheduled', 5000)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('6381912d-d0af-5b06-82d6-935d1edf95f3', 'painting') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('6381912d-d0af-5b06-82d6-935d1edf95f3', 0, 0, 0, 100, 120, now() - interval '600 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'Sanjay Magar', 'AC only. Servicing, gas, installation and the drainage problems that come with a badly fitted unit.', ARRAY['kathmandu-10', 'kathmandu-32', 'lalitpur-10']::text[], 7, true, now() - interval '67 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'ac-servicing') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 0, 0, 0, 100, 120, now() - interval '15 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('30fad070-2519-5b23-9119-e183e667ae8f', 'Nabin Shakya', 'Fridge and washing machine repair. Compressor work included, and I will tell you honestly when a fifteen-year-old machine is not worth the part.', ARRAY['lalitpur-3', 'lalitpur-4', 'kathmandu-10']::text[], 10, true, now() - interval '70 days', 'verified', ARRAY['id', 'skill']::text[], 'today', 1300)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('30fad070-2519-5b23-9119-e183e667ae8f', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('30fad070-2519-5b23-9119-e183e667ae8f', 0, 0, 0, 100, 120, now() - interval '120 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'Kamala Tamang', 'Cleaning and tank washing. Newer to the platform but not to the work — I did the same job for a housing society for six years.', ARRAY['lalitpur-10', 'lalitpur-14']::text[], 3, true, now() - interval '63 days', 'verified', ARRAY['id', 'background']::text[], 'today', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'home-cleaning') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'water-tank-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 0, 0, 0, 100, 120, now() - interval '40 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('e3b65774-6005-5667-b177-370b514a8b72', 'Gopal Bhattarai', 'Plumbing, mostly in the old town where the pipework is a hundred years of patches. I like the puzzles nobody else wants.', ARRAY['kathmandu-26', 'kathmandu-16', 'kathmandu-4']::text[], 14, true, now() - interval '74 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1000)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('e3b65774-6005-5667-b177-370b514a8b72', 'plumbing') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('e3b65774-6005-5667-b177-370b514a8b72', 0, 0, 0, 100, 120, now() - interval '9 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('bc2457f8-7b02-5b57-befd-633e39067337', 'Deepa Newar', 'Pest control with child-safe treatments. I will tell you what I am spraying and how long to keep the room shut.', ARRAY['kathmandu-7', 'kathmandu-10', 'bhaktapur-9']::text[], 6, true, now() - interval '66 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 2200)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('bc2457f8-7b02-5b57-befd-633e39067337', 'pest-control') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('bc2457f8-7b02-5b57-befd-633e39067337', 0, 0, 0, 100, 120, now() - interval '60 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('797da64c-0bf4-5024-a32b-72e6e63203c7', 'Suresh Chaudhary', 'Moving and the carpentry that comes after — refitting beds and cupboards in the new flat, which is where most shifting days go wrong.', ARRAY['kathmandu-31', 'kathmandu-32', 'bhaktapur-9']::text[], 9, true, now() - interval '69 days', 'verified', ARRAY['id']::text[], 'today', 5500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('797da64c-0bf4-5024-a32b-72e6e63203c7', 'movers-packers') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('797da64c-0bf4-5024-a32b-72e6e63203c7', 'carpentry') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('797da64c-0bf4-5024-a32b-72e6e63203c7', 0, 0, 0, 100, 120, now() - interval '300 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('a04d411f-3f95-5fe5-905d-94f195400400', 'Milan Basnet', 'Electrical work in Bhaktapur. Switchboards, new points and the inverter wiring people put off until load-shedding returns.', ARRAY['bhaktapur-4', 'bhaktapur-6', 'kathmandu-32']::text[], 5, true, now() - interval '65 days', 'verified', ARRAY['id', 'background']::text[], 'today', 800)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('a04d411f-3f95-5fe5-905d-94f195400400', 'electrical') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('a04d411f-3f95-5fe5-905d-94f195400400', 0, 0, 0, 100, 120, now() - interval '25 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 'Pemba Sherpa', 'Furniture and fitted cupboards, made on site. I book a week ahead because the work takes days, not hours.', ARRAY['kathmandu-26', 'kathmandu-4', 'kathmandu-7']::text[], 16, true, now() - interval '76 days', 'verified', ARRAY['id', 'skill']::text[], 'scheduled', 1200)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 'carpentry') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 0, 0, 0, 100, 120, now() - interval '720 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('19aca5c4-5511-5ef2-879c-d06fb51b2193', 'Laxmi Poudel', 'Household cleaning. I am building up my rating here — my background check is still with the office, and the price reflects that.', ARRAY['kathmandu-14', 'kathmandu-16']::text[], 2, true, now() - interval '62 days', 'pending', ARRAY['id']::text[], 'today', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('19aca5c4-5511-5ef2-879c-d06fb51b2193', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('19aca5c4-5511-5ef2-879c-d06fb51b2193', 0, 0, 0, 100, 120, now() - interval '18 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'Roshan Khadka', 'Plumbing and small appliance work. I take the jobs other people call too small — a single tap, a running cistern.', ARRAY['kathmandu-10', 'kathmandu-31']::text[], 4, true, now() - interval '64 days', 'verified', ARRAY['id', 'background']::text[], 'today', 900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'plumbing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 0, 0, 0, 100, 120, now() - interval '30 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('514a4c29-97be-5e53-ab6a-276a2ee18068', 'Arjun Thapa Magar', 'Tank and sump cleaning, mechanical scrub and chlorine rinse. Photographs before and after, because you cannot see inside your own tank.', ARRAY['kathmandu-14', 'kathmandu-16', 'lalitpur-14']::text[], 11, true, now() - interval '71 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1600)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('514a4c29-97be-5e53-ab6a-276a2ee18068', 'water-tank-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('514a4c29-97be-5e53-ab6a-276a2ee18068', 0, 0, 0, 100, 120, now() - interval '110 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'Sita Devi Sah', 'Pest control and deep cleaning together, which is usually what a kitchen problem actually needs.', ARRAY['kathmandu-31', 'kathmandu-32']::text[], 7, true, now() - interval '67 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'scheduled', 2100)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'pest-control') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 0, 0, 0, 100, 120, now() - interval '420 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('fecdccb9-87a4-5c20-89e9-7f8396761f52', 'Bishnu Maharjan', 'Painting and carpentry in Patan. Old wooden windows are my usual work — repair first, replace only when it cannot be saved.', ARRAY['lalitpur-3', 'lalitpur-4', 'lalitpur-10']::text[], 13, true, now() - interval '73 days', 'verified', ARRAY['id', 'skill']::text[], 'today', 4500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('fecdccb9-87a4-5c20-89e9-7f8396761f52', 'painting') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('fecdccb9-87a4-5c20-89e9-7f8396761f52', 'carpentry') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('fecdccb9-87a4-5c20-89e9-7f8396761f52', 0, 0, 0, 100, 120, now() - interval '200 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 'Ganesh Bhandari', 'AC servicing and basic electrical. New here — my documents are with the verification team and I am pricing low while my rating builds.', ARRAY['kathmandu-26', 'kathmandu-4']::text[], 3, false, null, 'pending', ARRAY[]::text[], 'today', 1800)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 'ac-servicing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 'electrical') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 0, 0, 0, 100, 120, now() - interval '50 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('73045464-f18d-54c8-9a37-77ee2641dc33', 'Tenzin Dolma', 'Cleaning, mostly small flats. I have just started on the platform.', ARRAY['kathmandu-7', 'kathmandu-4']::text[], 1, false, null, 'not_submitted', ARRAY[]::text[], 'today', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('73045464-f18d-54c8-9a37-77ee2641dc33', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('73045464-f18d-54c8-9a37-77ee2641dc33', 0, 0, 0, 100, 120, now() - interval '240 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('eba746b2-0c68-55a3-bfe3-905978fa0e3d', 'Umesh Nepali', 'Shifting service with a hired truck. Cheaper than the big companies, and I will say plainly what will not fit in one trip.', ARRAY['lalitpur-10', 'lalitpur-14', 'kathmandu-31']::text[], 6, true, now() - interval '66 days', 'verified', ARRAY['id', 'background']::text[], 'scheduled', 5200)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('eba746b2-0c68-55a3-bfe3-905978fa0e3d', 'movers-packers') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('eba746b2-0c68-55a3-bfe3-905978fa0e3d', 0, 0, 0, 100, 120, now() - interval '480 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('f0829cde-c83b-50f7-b9af-ab1306785bac', 'Sarita Gurung', 'Appliance repair, specialising in front-load washing machines. Only a handful of jobs here so far, so the rating is thin — ask me anything before booking.', ARRAY['lalitpur-3', 'kathmandu-10', 'kathmandu-32']::text[], 5, true, now() - interval '65 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'today', 1250)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('f0829cde-c83b-50f7-b9af-ab1306785bac', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('f0829cde-c83b-50f7-b9af-ab1306785bac', 0, 0, 0, 100, 120, now() - interval '12 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();


-- Reviews (development data) ---------------------------------

