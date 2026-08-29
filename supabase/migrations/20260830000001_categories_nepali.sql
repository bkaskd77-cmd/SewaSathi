-- Nepali category copy.
--
-- Phase 5.5 (the next-intl migration) made Nepali a first-class locale rather
-- than a name swap, so the three remaining English-only columns on `categories`
-- get Nepali siblings. The names (`name_ne`) were already here; the descriptor,
-- the description and the short CTA label were not, which is why `/ne/services`
-- would otherwise have rendered Nepali headings over English category copy.
--
-- Nullable on arrival so this can be applied before the seed that fills it;
-- the constraint is added at the end of the seed migration that follows.

alter table public.categories
  add column if not exists descriptor_ne text,
  add column if not exists description_ne text,
  add column if not exists cta_label_ne text;

comment on column public.categories.descriptor_ne is
  'Short Nepali form shown on the landing grid. Authored in lib/data/seed/categories.json.';
comment on column public.categories.description_ne is
  'One-line Nepali description for the catalogue and category page.';
comment on column public.categories.cta_label_ne is
  'Short Nepali label for inline sentences ("… प्राविधिक खोज्नुहोस्").';
