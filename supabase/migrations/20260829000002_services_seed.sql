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

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('plumbing', 'Plumbing', 'प्लम्बिङ', 'Leaks, blocked drains, fittings', 'Taps, pipes, drains, tanks and the pump that stopped working.', 'plumbing', 900, 4500, 'Wrench', 1)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('electrical', 'Electrical', 'बिजुली मर्मत', 'Wiring, switches, inverters', 'Switches, sockets, MCBs, inverters and the light that will not come on.', 'electrical', 800, 4000, 'Zap', 2)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('home-cleaning', 'Home Cleaning', 'घर सरसफाइ', 'Deep clean, kitchen, bathrooms', 'Deep cleans, kitchens, bathrooms and the flat you are moving out of.', 'home cleaning', 1500, 5000, 'Sparkles', 3)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('appliance-repair', 'Appliance Repair', 'उपकरण मर्मत', 'Fridge, washing machine, geyser', 'Fridges, washing machines, geysers, microwaves and televisions.', 'appliance repair', 1200, 4000, 'WashingMachine', 4)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('carpentry', 'Carpentry', 'सिकर्मी काम', 'Doors, furniture, fittings', 'Doors, cupboards, hinges, shelves and furniture that needs rebuilding.', 'carpentry', 1000, 3500, 'Hammer', 5)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('pest-control', 'Pest Control', 'किरा नियन्त्रण', 'Cockroaches, termites, bed bugs', 'Cockroaches, termites, bed bugs and rodents, treated flat by flat.', 'pest control', 2000, 6000, 'Bug', 6)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('painting', 'Painting', 'रङरोगन', 'Interior, exterior, touch-ups', 'Interior and exterior painting, damp patches and touch-ups.', 'painting', 4000, 25000, 'PaintRoller', 7)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('ac-servicing', 'AC Servicing & Gas Refill', 'एसी सर्भिसिङ', 'Servicing, gas top-up, install', 'Servicing, gas top-ups and installation for split and window units.', 'AC servicing', 1800, 5500, 'AirVent', 8)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('water-tank-cleaning', 'Water Tank Cleaning', 'पानी ट्यांकी सफाइ', 'Tanks, sumps, overhead drums', 'Overhead drums, underground sumps and the water that started smelling.', 'water tank cleaning', 1500, 4000, 'Droplets', 9)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.categories (slug, name_en, name_ne, descriptor, description, cta_label, base_price_min, base_price_max, icon, sort_order)
values ('movers-packers', 'Movers & Packers', 'सामान सार्ने सेवा', 'Shifting flats, offices, storage', 'Shifting a flat or an office, packing, loading and storage.', 'moving & packing', 5000, 20000, 'Truck', 10)
on conflict (slug) do update set
  name_en = excluded.name_en, name_ne = excluded.name_ne,
  descriptor = excluded.descriptor, description = excluded.description,
  cta_label = excluded.cta_label,
  base_price_min = excluded.base_price_min, base_price_max = excluded.base_price_max,
  icon = excluded.icon, sort_order = excluded.sort_order;


-- Providers (development data) -------------------------------

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('d431eabc-3d3f-5b99-a484-03ffe615e7e9', 'Ramesh Tamang', 'Twelve years on Kathmandu Valley plumbing. Most of my work is leaks and blocked lines in older buildings, and I carry the common fittings on the bike so a single visit usually finishes it.', ARRAY['lalitpur-4', 'lalitpur-3', 'lalitpur-10']::text[], 12, true, now() - interval '72 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('d431eabc-3d3f-5b99-a484-03ffe615e7e9', 'plumbing') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('d431eabc-3d3f-5b99-a484-03ffe615e7e9', 4.8, 212, 231, 98, 12, now() - interval '4 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'Sabina Maharjan', 'I run a two-person cleaning team, mostly deep cleans and move-outs. We bring our own supplies and we do not charge extra for the kitchen.', ARRAY['lalitpur-3', 'lalitpur-4', 'kathmandu-10']::text[], 7, true, now() - interval '67 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1600)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 4.9, 168, 187, 99, 9, now() - interval '11 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'Dipak Shrestha', 'Licensed electrician. Wiring faults, MCB tripping and inverter installs. I explain what failed before I quote, because most people have been overcharged for a fuse at least once.', ARRAY['kathmandu-10', 'kathmandu-31', 'kathmandu-32']::text[], 15, true, now() - interval '75 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 850)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'electrical') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('852371c7-8dc8-56cf-94bd-c8677f63ef4e', 4.7, 304, 342, 97, 15, now() - interval '2 minutes')
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
values ('5ed12c82-9a80-5836-ba8e-215c7312b1bf', 4.6, 141, 166, 95, 42, now() - interval '180 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('abda134f-2de4-547a-85d8-d0c122e657b2', 'Anita Rai', 'AC servicing and gas top-ups, plus fridge and washing machine work. I trained with a Samsung service centre and still use their diagnostic order.', ARRAY['kathmandu-10', 'kathmandu-31', 'lalitpur-10']::text[], 6, true, now() - interval '66 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1800)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('abda134f-2de4-547a-85d8-d0c122e657b2', 'ac-servicing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('abda134f-2de4-547a-85d8-d0c122e657b2', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('abda134f-2de4-547a-85d8-d0c122e657b2', 4.8, 97, 108, 98, 18, now() - interval '7 minutes')
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
values ('e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 4.5, 88, 102, 94, 35, now() - interval '95 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('6324d929-612e-59e9-b327-4638ffa42b7e', 'Sunita Karki', 'Cleaning and pest treatment. For cockroaches I do the gel treatment first and a follow-up after two weeks, which is included in the price.', ARRAY['kathmandu-26', 'kathmandu-16', 'kathmandu-4']::text[], 5, true, now() - interval '65 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1700)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('6324d929-612e-59e9-b327-4638ffa42b7e', 'home-cleaning') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('6324d929-612e-59e9-b327-4638ffa42b7e', 'pest-control') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('6324d929-612e-59e9-b327-4638ffa42b7e', 4.7, 124, 139, 96, 14, now() - interval '20 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('18f47ede-45d4-5765-804e-59e38c10b176', 'Manoj Yadav', 'Electrical and appliance repair. Geysers and washing machines are most of it. I tell you the part price before I open anything.', ARRAY['kathmandu-31', 'kathmandu-32', 'kathmandu-10']::text[], 11, true, now() - interval '71 days', 'verified', ARRAY['id', 'skill']::text[], 'now', 900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('18f47ede-45d4-5765-804e-59e38c10b176', 'electrical') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('18f47ede-45d4-5765-804e-59e38c10b176', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('18f47ede-45d4-5765-804e-59e38c10b176', 4.6, 176, 203, 95, 22, now() - interval '35 minutes')
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
values ('f11ef900-5841-5189-9bad-40e5f38db33d', 4.4, 73, 91, 92, 55, now() - interval '240 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('54054138-1656-5c5a-8c6a-897284a44c42', 'Rita Shrestha', 'Regular household cleaning, weekly or fortnightly. Most of my customers have been with me over a year, which I take as the review that matters.', ARRAY['kathmandu-4', 'kathmandu-7', 'kathmandu-26']::text[], 4, true, now() - interval '64 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('54054138-1656-5c5a-8c6a-897284a44c42', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('54054138-1656-5c5a-8c6a-897284a44c42', 4.9, 96, 104, 99, 11, now() - interval '6 minutes')
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
values ('6381912d-d0af-5b06-82d6-935d1edf95f3', 4.7, 112, 128, 96, 90, now() - interval '600 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'Sanjay Magar', 'AC only. Servicing, gas, installation and the drainage problems that come with a badly fitted unit.', ARRAY['kathmandu-10', 'kathmandu-32', 'lalitpur-10']::text[], 7, true, now() - interval '67 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'ac-servicing') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 4.6, 84, 97, 95, 17, now() - interval '15 minutes')
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
values ('30fad070-2519-5b23-9119-e183e667ae8f', 4.5, 131, 152, 93, 40, now() - interval '120 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'Kamala Tamang', 'Cleaning and tank washing. Newer to the platform but not to the work — I did the same job for a housing society for six years.', ARRAY['lalitpur-10', 'lalitpur-14']::text[], 3, true, now() - interval '63 days', 'verified', ARRAY['id', 'background']::text[], 'now', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'home-cleaning') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'water-tank-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('ef54ba0f-3453-5e37-bf5f-c18ae40235de', 4.4, 41, 47, 93, 25, now() - interval '40 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('e3b65774-6005-5667-b177-370b514a8b72', 'Gopal Bhattarai', 'Plumbing, mostly in the old town where the pipework is a hundred years of patches. I like the puzzles nobody else wants.', ARRAY['kathmandu-26', 'kathmandu-16', 'kathmandu-4']::text[], 14, true, now() - interval '74 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1000)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('e3b65774-6005-5667-b177-370b514a8b72', 'plumbing') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('e3b65774-6005-5667-b177-370b514a8b72', 4.7, 198, 224, 96, 16, now() - interval '9 minutes')
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
values ('bc2457f8-7b02-5b57-befd-633e39067337', 4.8, 67, 74, 97, 30, now() - interval '60 minutes')
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
values ('797da64c-0bf4-5024-a32b-72e6e63203c7', 4.3, 58, 72, 90, 65, now() - interval '300 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('a04d411f-3f95-5fe5-905d-94f195400400', 'Milan Basnet', 'Electrical work in Bhaktapur. Switchboards, new points and the inverter wiring people put off until load-shedding returns.', ARRAY['bhaktapur-4', 'bhaktapur-6', 'kathmandu-32']::text[], 5, true, now() - interval '65 days', 'verified', ARRAY['id', 'background']::text[], 'now', 800)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('a04d411f-3f95-5fe5-905d-94f195400400', 'electrical') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('a04d411f-3f95-5fe5-905d-94f195400400', 4.5, 52, 61, 94, 20, now() - interval '25 minutes')
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
values ('2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 4.6, 103, 119, 95, 120, now() - interval '720 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('19aca5c4-5511-5ef2-879c-d06fb51b2193', 'Laxmi Poudel', 'Household cleaning. I am building up my rating here — my background check is still with the office, and the price reflects that.', ARRAY['kathmandu-14', 'kathmandu-16']::text[], 2, true, now() - interval '62 days', 'pending', ARRAY['id']::text[], 'now', 1500)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('19aca5c4-5511-5ef2-879c-d06fb51b2193', 'home-cleaning') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('19aca5c4-5511-5ef2-879c-d06fb51b2193', 4.2, 18, 21, 90, 28, now() - interval '18 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'Roshan Khadka', 'Plumbing and small appliance work. I take the jobs other people call too small — a single tap, a running cistern.', ARRAY['kathmandu-10', 'kathmandu-31']::text[], 4, true, now() - interval '64 days', 'verified', ARRAY['id', 'background']::text[], 'now', 900)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'plumbing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 4.1, 34, 44, 88, 45, now() - interval '30 minutes')
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
values ('514a4c29-97be-5e53-ab6a-276a2ee18068', 4.7, 79, 88, 97, 38, now() - interval '110 minutes')
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
values ('74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 4.6, 71, 82, 95, 80, now() - interval '420 minutes')
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
values ('fecdccb9-87a4-5c20-89e9-7f8396761f52', 4.5, 94, 111, 93, 50, now() - interval '200 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 'Ganesh Bhandari', 'AC servicing and basic electrical. New here — my documents are with the verification team and I am pricing low while my rating builds.', ARRAY['kathmandu-26', 'kathmandu-4']::text[], 3, false, null, 'pending', ARRAY[]::text[], 'now', 1800)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 'ac-servicing') on conflict do nothing;
insert into public.provider_categories (provider_id, category_slug) values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 'electrical') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('911633b9-2f9e-5369-a1bd-2d76200885c2', 4.3, 12, 15, 87, 33, now() - interval '50 minutes')
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
values ('73045464-f18d-54c8-9a37-77ee2641dc33', 4.5, 7, 8, 88, 60, now() - interval '240 minutes')
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
values ('eba746b2-0c68-55a3-bfe3-905978fa0e3d', 4.2, 44, 58, 89, 95, now() - interval '480 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();

insert into public.providers (id, display_name, bio, service_areas, years_experience, is_verified, verified_at, id_document_status, checks, availability, base_rate)
values ('f0829cde-c83b-50f7-b9af-ab1306785bac', 'Sarita Gurung', 'Appliance repair, specialising in front-load washing machines. Only a handful of jobs here so far, so the rating is thin — ask me anything before booking.', ARRAY['lalitpur-3', 'kathmandu-10', 'kathmandu-32']::text[], 5, true, now() - interval '65 days', 'verified', ARRAY['id', 'background', 'skill']::text[], 'now', 1250)
on conflict (id) do update set
  display_name = excluded.display_name, bio = excluded.bio,
  service_areas = excluded.service_areas, years_experience = excluded.years_experience,
  is_verified = excluded.is_verified, verified_at = excluded.verified_at,
  id_document_status = excluded.id_document_status, checks = excluded.checks,
  availability = excluded.availability, base_rate = excluded.base_rate;

insert into public.provider_categories (provider_id, category_slug) values ('f0829cde-c83b-50f7-b9af-ab1306785bac', 'appliance-repair') on conflict do nothing;

insert into public.provider_stats (provider_id, rating_avg, rating_count, jobs_completed, completion_rate, avg_response_minutes, last_active_at)
values ('f0829cde-c83b-50f7-b9af-ab1306785bac', 5, 9, 11, 100, 13, now() - interval '12 minutes')
on conflict (provider_id) do update set
  rating_avg = excluded.rating_avg, rating_count = excluded.rating_count,
  jobs_completed = excluded.jobs_completed, completion_rate = excluded.completion_rate,
  avg_response_minutes = excluded.avg_response_minutes,
  last_active_at = excluded.last_active_at, updated_at = now();


-- Reviews (development data) ---------------------------------

insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('41ddbe97-e0f9-582a-8680-cbd141f0b19e', 'd431eabc-3d3f-5b99-a484-03ffe615e7e9', 'Anup K.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '3 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('7117d4ee-ba83-590e-ae95-bd8d722941ad', 'd431eabc-3d3f-5b99-a484-03ffe615e7e9', 'Sarita M.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '14 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('77f43ce5-37be-58c4-83d0-efb1043e01c9', 'd431eabc-3d3f-5b99-a484-03ffe615e7e9', 'Bijay S.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '25 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('9bde2c69-5578-5da9-89b3-b7bb0d5f2b9d', 'd431eabc-3d3f-5b99-a484-03ffe615e7e9', 'Nirmala T.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '36 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('7fa16016-3614-5022-ac10-86e2e3149a63', '1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'Nirmala T.', 5, 'Second time using this service. Same quality both times.', now() - interval '10 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('fb272fd9-520c-53e0-9aa6-2c88dd322846', '1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'Prabin R.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '21 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('90e1f5b9-a9fb-5b3b-ad60-31d77d87b013', '1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'Sushila G.', 4, 'Job done well. Communication could be a little better.', now() - interval '32 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('03357e5a-38b4-555b-8ac0-aedeed0d055f', '1d6a72bd-83eb-59e6-9ba5-3caee8e94740', 'Dhiraj B.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '43 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('08eb8c96-8121-5043-9ada-2979267b3d18', '852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'Dhiraj B.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '17 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('56431d66-35e7-55f6-9aa7-a81db0e236da', '852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'Rekha P.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '28 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('8acbdb57-6271-5c84-ae2b-13ede900101c', '852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'Nabin C.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '39 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ece3433c-3f8f-5178-a041-591c9896198f', '852371c7-8dc8-56cf-94bd-c8677f63ef4e', 'Manisha D.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '50 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('7cb15dea-10ae-57ec-8dc7-399babb361e1', '5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'Manisha D.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '24 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('b10037ae-83d9-5c0f-b83a-af0ea50076eb', '5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'Kiran L.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '35 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('f2d49ab8-669c-58f5-9cf0-5e68e8d17180', '5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'Anjali S.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '46 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('82d459b7-eefa-5a5e-81da-a71b9610c619', '5ed12c82-9a80-5836-ba8e-215c7312b1bf', 'Anup K.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '57 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('3e1ffafa-a9c6-599d-8f89-850d725f0a35', 'abda134f-2de4-547a-85d8-d0c122e657b2', 'Anup K.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '31 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('c8e2ecd7-3cd2-572b-92ef-7d6064985bd9', 'abda134f-2de4-547a-85d8-d0c122e657b2', 'Sarita M.', 4, 'Job done well. Communication could be a little better.', now() - interval '42 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('a96439ce-9e3d-5099-94c9-b8e851a16384', 'abda134f-2de4-547a-85d8-d0c122e657b2', 'Bijay S.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '53 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('1793476a-d012-57f2-ad3a-887b1214ddb4', 'abda134f-2de4-547a-85d8-d0c122e657b2', 'Nirmala T.', 5, 'Second time using this service. Same quality both times.', now() - interval '64 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ec2cb49a-d8dd-5cee-be75-1c5b51a2270c', 'e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'Nirmala T.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '38 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('a4294b8e-8b5d-507b-8a94-49e377ec1ec0', 'e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'Prabin R.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '49 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('37bf2e3a-1202-5bf5-a94a-9781db280ddb', 'e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'Sushila G.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '60 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('371e419d-ec24-5481-8171-bb3ab87338c1', 'e9de47ed-35b2-5be2-b067-e8de3dfcc17c', 'Dhiraj B.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '71 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('5d7efadb-65e3-5dd8-b6be-62a8d2414413', '6324d929-612e-59e9-b327-4638ffa42b7e', 'Dhiraj B.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '45 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('16257b63-14be-5b48-84db-7e62d59623cd', '6324d929-612e-59e9-b327-4638ffa42b7e', 'Rekha P.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '56 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('d8f94cf8-13c9-5436-af6f-cb4f987ca04d', '6324d929-612e-59e9-b327-4638ffa42b7e', 'Nabin C.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '67 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('f8074e10-b0f9-5dec-b547-e013a93bcf53', '6324d929-612e-59e9-b327-4638ffa42b7e', 'Manisha D.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '78 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('d69f66df-704a-50fe-89ff-8057ac30ea8f', '18f47ede-45d4-5765-804e-59e38c10b176', 'Manisha D.', 4, 'Job done well. Communication could be a little better.', now() - interval '52 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ccb11560-e6ba-5d36-a624-85e5e21ea79c', '18f47ede-45d4-5765-804e-59e38c10b176', 'Kiran L.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '63 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('4a5036c2-5236-53a0-a55a-21e2cfcc83ef', '18f47ede-45d4-5765-804e-59e38c10b176', 'Anjali S.', 5, 'Second time using this service. Same quality both times.', now() - interval '74 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('80df86e6-8cce-5fa0-8f78-92e72d136204', '18f47ede-45d4-5765-804e-59e38c10b176', 'Anup K.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '85 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ffd02f45-8b11-5cd7-a951-e5a3af959ac2', 'f11ef900-5841-5189-9bad-40e5f38db33d', 'Anup K.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '59 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('7bb4eb39-15f8-5efd-bc16-a32f58796e4a', 'f11ef900-5841-5189-9bad-40e5f38db33d', 'Sarita M.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '70 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('4ab3f0fc-d1d6-59af-92cd-23697192a7c9', 'f11ef900-5841-5189-9bad-40e5f38db33d', 'Bijay S.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '81 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('e2bb0b52-f011-52ad-be67-852676348ce6', 'f11ef900-5841-5189-9bad-40e5f38db33d', 'Nirmala T.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '92 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('5d06a28d-9917-5716-8813-f387f7ffa2dc', '54054138-1656-5c5a-8c6a-897284a44c42', 'Nirmala T.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '66 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('af997d19-2134-5fc5-90b8-999f73514ed1', '54054138-1656-5c5a-8c6a-897284a44c42', 'Prabin R.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '77 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('163e7002-d94e-5dce-9e57-838a667a7d89', '54054138-1656-5c5a-8c6a-897284a44c42', 'Sushila G.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '88 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('1710e178-21a2-5ffc-8e49-cf9be22f4e9b', '54054138-1656-5c5a-8c6a-897284a44c42', 'Dhiraj B.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '9 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('2186f8c1-0a47-5fa8-8e1b-857d769868ac', '6381912d-d0af-5b06-82d6-935d1edf95f3', 'Dhiraj B.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '73 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('5a67234c-cdd0-5f5e-b5c9-c92aecf3c523', '6381912d-d0af-5b06-82d6-935d1edf95f3', 'Rekha P.', 5, 'Second time using this service. Same quality both times.', now() - interval '84 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('47034815-a52e-57c4-9a9b-81dd03ee3f4f', '6381912d-d0af-5b06-82d6-935d1edf95f3', 'Nabin C.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '5 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('782f8694-3616-572f-9643-e323f147a9aa', '6381912d-d0af-5b06-82d6-935d1edf95f3', 'Manisha D.', 4, 'Job done well. Communication could be a little better.', now() - interval '16 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('115bb16d-d0fc-5702-8e9f-49dc8f06abd5', '101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'Manisha D.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '80 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('7207e54b-ca73-5591-9d9c-8d0abd184a31', '101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'Kiran L.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '91 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('479da6fc-b89d-5e11-aa2c-40ab46f895f9', '101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'Anjali S.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '12 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('4c28dd15-eb25-540f-8ac4-649b59b5e0a8', '101f71bb-2af5-5ea9-91e9-aa5a03bfe274', 'Anup K.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '23 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('1fa35b31-95e6-5b07-95ac-d25c8a66e856', '30fad070-2519-5b23-9119-e183e667ae8f', 'Anup K.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '87 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('5fcd4898-a70b-5076-8adc-31c25be59aa0', '30fad070-2519-5b23-9119-e183e667ae8f', 'Sarita M.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '8 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('34519705-6b00-58f0-af11-8558faff0281', '30fad070-2519-5b23-9119-e183e667ae8f', 'Bijay S.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '19 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('4d5a0a39-1165-5026-94a9-75b0cfb4c6ed', '30fad070-2519-5b23-9119-e183e667ae8f', 'Nirmala T.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '30 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('61559e39-b97c-5a80-b16b-1f925dcc14ad', 'ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'Nirmala T.', 5, 'Second time using this service. Same quality both times.', now() - interval '4 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('79c1e7b2-d436-5fd4-a5b2-d07f9e2d10dd', 'ef54ba0f-3453-5e37-bf5f-c18ae40235de', 'Prabin R.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '15 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('67dee968-7e73-559d-bbba-e2f39ff5cfb2', 'e3b65774-6005-5667-b177-370b514a8b72', 'Dhiraj B.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '11 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('c1093f27-01d9-5b28-8ffa-f8968bd4b595', 'e3b65774-6005-5667-b177-370b514a8b72', 'Rekha P.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '22 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('adb68a44-b008-55c2-9782-982550d01a27', 'e3b65774-6005-5667-b177-370b514a8b72', 'Nabin C.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '33 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('71b21de2-790c-5f9d-b8d7-df2d8cbb218f', 'e3b65774-6005-5667-b177-370b514a8b72', 'Manisha D.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '44 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('6dd68e18-acf2-549e-b4c7-de492d9758e2', 'bc2457f8-7b02-5b57-befd-633e39067337', 'Manisha D.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '18 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('9449bb91-5693-5482-a32d-ef6aab596c02', 'bc2457f8-7b02-5b57-befd-633e39067337', 'Kiran L.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '29 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('5ab03956-c11c-55c0-a589-5a517d46d878', 'bc2457f8-7b02-5b57-befd-633e39067337', 'Anjali S.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '40 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('6ffc02f9-e612-5ba6-ab1d-a28fc02a4e87', 'bc2457f8-7b02-5b57-befd-633e39067337', 'Anup K.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '51 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('c1ee3bd3-362e-5d7e-b74a-48a8be8af965', '797da64c-0bf4-5024-a32b-72e6e63203c7', 'Anup K.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '25 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('6459f951-ea02-53d6-93ff-5a3519aa23e9', '797da64c-0bf4-5024-a32b-72e6e63203c7', 'Sarita M.', 4, 'Job done well. Communication could be a little better.', now() - interval '36 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('bda73fde-b6c4-5d95-978f-21cf99ad5e79', '797da64c-0bf4-5024-a32b-72e6e63203c7', 'Bijay S.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '47 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('01be1712-a5c4-5494-864d-8f60fbaa48e9', '797da64c-0bf4-5024-a32b-72e6e63203c7', 'Nirmala T.', 5, 'Second time using this service. Same quality both times.', now() - interval '58 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('8e3d0067-c021-5683-a3c1-6489205bc4b1', 'a04d411f-3f95-5fe5-905d-94f195400400', 'Nirmala T.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '32 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('2952ddc4-4ac5-5180-bbe7-7fb8048e8c09', 'a04d411f-3f95-5fe5-905d-94f195400400', 'Prabin R.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '43 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('6af0d63c-b8be-5d87-9a92-e0d5237bc2ad', 'a04d411f-3f95-5fe5-905d-94f195400400', 'Sushila G.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '54 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('160fc2a0-bc40-53a0-b9c3-4d2776bdb160', 'a04d411f-3f95-5fe5-905d-94f195400400', 'Dhiraj B.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '65 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('8205c6fa-6a16-5d56-bb53-8770aa069fe8', '2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 'Dhiraj B.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '39 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('9cc44840-8b64-5367-bc7f-05918b9bca65', '2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 'Rekha P.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '50 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('841cd5b5-42f8-55d1-90bc-df3ab4e99e92', '2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 'Nabin C.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '61 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('836c73cf-4349-59c0-8917-718cd8f014bc', '2787c848-eb9d-5e1b-aa12-c03c4fc02dbc', 'Manisha D.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '72 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('49769a1f-f47d-5d37-a47a-be195ac000ac', '19aca5c4-5511-5ef2-879c-d06fb51b2193', 'Manisha D.', 4, 'Job done well. Communication could be a little better.', now() - interval '46 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('27abfe8c-84c1-5ade-a71d-44757a9c9f9b', '19aca5c4-5511-5ef2-879c-d06fb51b2193', 'Kiran L.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '57 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('aa7a7488-6afc-5087-a714-840065a92d1a', '8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'Anup K.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '53 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('5f335441-8132-5e77-99fc-128db113aa5e', '8674dcbf-94c7-56d3-bfcc-119a9210ac4d', 'Sarita M.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '64 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('047b73ca-d19b-5455-86d6-54bee6e36ae7', '514a4c29-97be-5e53-ab6a-276a2ee18068', 'Nirmala T.', 5, 'Answered at nine at night when the water was running down the wall. Came at seven the next morning.', now() - interval '60 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('c2845e2a-6cb7-589b-9c25-66acfc51e4cd', '514a4c29-97be-5e53-ab6a-276a2ee18068', 'Prabin R.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '71 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ec5bf2db-b522-5ece-957a-321acbd53b5d', '514a4c29-97be-5e53-ab6a-276a2ee18068', 'Sushila G.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '82 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('d5580e3f-5acc-502f-b7e2-9bf09a9f450f', '514a4c29-97be-5e53-ab6a-276a2ee18068', 'Dhiraj B.', 3, 'The work is fine but I had to follow up twice to get the visit scheduled.', now() - interval '3 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('07edb561-1416-561a-b498-0c410483c35f', '74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'Dhiraj B.', 4, 'Good work. Arrived about forty minutes later than agreed but called ahead to say so.', now() - interval '67 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ea3dc0e4-0dbd-562c-a6d1-39855128e686', '74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'Rekha P.', 5, 'Second time using this service. Same quality both times.', now() - interval '78 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('74f4cea8-b327-59aa-9674-58aade1902b8', '74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'Nabin C.', 4, 'Careful and thorough. Took longer than I expected for what it was.', now() - interval '89 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('ef75ba0d-8a67-5639-8f58-581712eefc59', '74726026-e9d0-5a0a-a7ec-a1a22b5cfe7e', 'Manisha D.', 4, 'Job done well. Communication could be a little better.', now() - interval '10 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('86a4724f-4f12-5b74-836b-accdb9cf5730', 'fecdccb9-87a4-5c20-89e9-7f8396761f52', 'Manisha D.', 5, 'Did not try to sell me anything I did not need. Rare.', now() - interval '74 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('cf420f46-bd63-5084-a639-5ec6258696cf', 'fecdccb9-87a4-5c20-89e9-7f8396761f52', 'Kiran L.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '85 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('59cc9c26-fa15-56fb-9c2c-16d246f7561d', 'fecdccb9-87a4-5c20-89e9-7f8396761f52', 'Anjali S.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '6 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('222e891a-af71-56a0-bd9f-3e8f8120ba05', 'fecdccb9-87a4-5c20-89e9-7f8396761f52', 'Anup K.', 4, 'Fixed it properly. Slightly more than the estimate because a part was needed, but he showed me the old one.', now() - interval '17 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('7a65d2f6-f018-538e-80b0-e0def5c70b87', '911633b9-2f9e-5369-a1bd-2d76200885c2', 'Anup K.', 5, 'Came the same afternoon, found the leak was the joint not the pipe, and charged what he said on the phone.', now() - interval '81 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('e965d931-ee04-5c75-958a-308486c8f6f8', '911633b9-2f9e-5369-a1bd-2d76200885c2', 'Sarita M.', 5, 'Explained the problem in Nepali for my mother, which mattered more than the price.', now() - interval '92 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('66cd8cbf-e1c8-529c-8210-466ba4b05dfb', 'eba746b2-0c68-55a3-bfe3-905978fa0e3d', 'Dhiraj B.', 5, 'Very neat work and a fair price for the amount of time it took.', now() - interval '5 days')
on conflict (id) do nothing;
insert into public.provider_reviews (id, provider_id, author_name, rating, comment, created_at)
values ('1a2099b2-d950-5306-80ce-9f6643feeb85', 'eba746b2-0c68-55a3-bfe3-905978fa0e3d', 'Rekha P.', 5, 'Polite, on time, cleaned up afterwards. Booked again for the other bathroom.', now() - interval '16 days')
on conflict (id) do nothing;
