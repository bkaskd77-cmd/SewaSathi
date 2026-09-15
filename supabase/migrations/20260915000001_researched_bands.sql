-- The nine researched bands, and a tenth trade that refuses to have one.
--
-- FLOORS SIT AT THE BOTTOM OF EACH RESEARCHED RANGE, NOT ITS MIDDLE, and the
-- reason is a bias we can name. Published prices come from firms that advertise;
-- the independent mistri a customer would otherwise ring from a shop window is
-- cheaper and publishes nothing. So every researched figure carries an upward
-- skew. `clampRate` then moves a professional's own rate UP into the band —
-- which takes money from customers and inflates the commission basis, since the
-- fee is charged on max(final_amount, quoted_min). Erring low costs us a little
-- fee on a job priced under the band; erring high overcharges a customer and
-- overcharges the professional for the privilege. Take the error low.
--
-- Every note records its sources and that reasoning, because a figure whose
-- provenance is a commit message is a figure nobody can re-derive.

alter table public.categories
  add column if not exists pricing_confidence text not null default 'low'
    check (pricing_confidence in ('high', 'medium', 'low')),
  add column if not exists pricing_model text not null default 'band'
    check (pricing_model in ('band', 'survey'));

comment on column public.categories.pricing_confidence is
  'How much the band is worth trusting. Governs how large a sample our own data needs before it may propose a revision — a guess earns a challenge sooner than a well-sourced number.';
comment on column public.categories.pricing_model is
  'band publishes a price range; survey publishes none because the trade has no price until somebody has looked. Movers quote after a free survey everywhere in the market.';

-- ------------------------------------------------------------------ --
-- The nine
-- ------------------------------------------------------------------ --

update public.categories set
  base_price_min = v.low, base_price_max = v.high,
  pricing_source = 'researched',
  pricing_checked_at = date '2026-09-15',
  pricing_confidence = v.confidence,
  pricing_model = 'band'
from (values
  ('plumbing',            350,  6000, 'high'),
  ('electrical',          350,  5000, 'high'),
  ('home-cleaning',       800, 12000, 'medium'),
  ('appliance-repair',    500,  5000, 'medium'),
  ('carpentry',           500,  6000, 'low'),
  ('pest-control',       1500,  8000, 'low'),
  ('painting',           1000, 40000, 'medium'),
  ('ac-servicing',        500, 12000, 'high'),
  ('water-tank-cleaning',1500,  6000, 'high')
) as v(slug, low, high, confidence)
where public.categories.slug = v.slug;

-- ------------------------------------------------------------------ --
-- The tenth: change the model rather than force a band
-- ------------------------------------------------------------------ --

-- Two searches, one of them in Nepali, found NO published Nepali pricing for
-- movers and packers. Every operator quotes after a survey. That is the finding,
-- not a gap in the research, and inventing a range would fabricate the one
-- number the market itself refuses to state before looking at the job.
--
-- So the category keeps its listing and loses its band. It stays `invented`
-- deliberately: `npm run check:blockers` goes on refusing a launch build until
-- the request-a-survey flow exists, because until then the category page would
-- still be promising a price nobody quoted.
update public.categories
   set pricing_model = 'survey',
       pricing_source = 'invented',
       pricing_checked_at = null,
       pricing_confidence = 'low'
 where slug = 'movers-packers';

-- The notes are long and carry the sources; they are written from the seed by
-- `npm run seed:sql` so the JSON stays the single source of truth.
