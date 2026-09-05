-- What share of our money moves as cash, and where.
--
-- The customer-side incentive — a credit or a small discount for paying
-- digitally — is deliberately NOT built yet, and this view is why. An
-- incentive with no baseline cannot be evaluated: cash share would drift for a
-- dozen reasons (a new ward, a category mix, a festival month) and any change
-- after launch would be claimed as the incentive's doing. Measure first, then
-- spend.
--
-- PER CATEGORY AND PER WARD, because those are the two axes a decision would
-- actually be taken on. A ward where nobody has a Khalti wallet is not a ward
-- to discount at; a category settled almost entirely in cash — big jobs,
-- older customers — is a different problem from one where digital is already
-- winning. The month is here so a before-and-after is answerable at all,
-- which is the whole point of a baseline.
--
-- NOT PER PROFESSIONAL, on purpose and for the same reason
-- `category_pricing_signals` is not: the customer usually picks the method,
-- and a per-person cash share read as a suspicion list would punish people for
-- the neighbourhood they serve. How somebody's customers choose to pay must
-- never cost them anything — it is not a ranking input and it is not a
-- signal in the enforcement ladder.

create or replace view public.payment_mix_signals as
  select
    b.category_slug,
    a.area_key,
    date_trunc('month', b.completed_at)::date as month,
    count(*) as settled_jobs,
    count(*) filter (where b.payment_method = 'cash') as cash_jobs,
    round(
      100.0 * count(*) filter (where b.payment_method = 'cash')
        / nullif(count(*), 0)
    , 1) as cash_pct,
    coalesce(sum(b.final_amount), 0) as gross,
    coalesce(sum(b.final_amount) filter (where b.payment_method = 'cash'), 0)
      as cash_gross
  from public.bookings b
  join public.addresses a on a.id = b.address_id
  where b.payment_status = 'paid'
    and b.final_amount is not null
    and b.completed_at is not null
  group by b.category_slug, a.area_key, date_trunc('month', b.completed_at);

comment on view public.payment_mix_signals is
  'Cash versus digital share of settled jobs, by category, ward and month. The baseline any customer-side payment incentive has to be measured against. Never grouped by professional: the customer picks the method.';

-- Support's number, and meaningless unless it is everybody's: a view runs with
-- the caller's own policies, so a customer reading it would see their own two
-- rows and get an average of nothing.
revoke all on public.payment_mix_signals from public, anon, authenticated;
