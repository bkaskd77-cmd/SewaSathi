-- Triage logs.
--
-- Every triage, from the first one. This is the only record of what people
-- actually ask for and what we told them it would cost, and it is what Phase 9
-- needs to answer two questions we cannot answer today: are the price bands
-- right, and which categories are we missing?
--
-- What is stored: the text the person typed, whether a photo was attached, and
-- what came back. What is not stored: the photo. It is held in memory for the
-- length of one request and never written anywhere.

create table if not exists public.triage_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Null for the anonymous hero search, which is most of this traffic.
  user_id uuid references auth.users (id) on delete set null,

  input_text text,
  had_photo boolean not null default false,

  -- The result as the user saw it, after the safety floor and the price clamp.
  category text not null,
  urgency text not null check (urgency in ('emergency', 'soon', 'routine')),
  price_low integer not null,
  price_high integer not null,

  -- 'claude' answered, 'cache' repeated an answer, 'fallback' means the
  -- keyword matcher stood in. A rising fallback rate is the alarm.
  source text not null check (source in ('claude', 'cache', 'fallback')),
  model text,
  latency_ms integer,

  -- Which hazard the server-side guard fired on, if any. Lets us audit the
  -- safety path against real inputs instead of trusting it.
  hazard text
);

create index if not exists triage_logs_created_at_idx
  on public.triage_logs (created_at desc);

create index if not exists triage_logs_category_idx
  on public.triage_logs (category, created_at desc);

alter table public.triage_logs enable row level security;

-- No insert or select policy for anon or authenticated on purpose. Writes come
-- from the API route with the service role key, which bypasses RLS; without a
-- policy nobody holding the public anon key can read what strangers typed or
-- write junk rows straight into the training data.
create policy "Admins read triage logs"
  on public.triage_logs
  for select
  to authenticated
  using (public.is_admin());
