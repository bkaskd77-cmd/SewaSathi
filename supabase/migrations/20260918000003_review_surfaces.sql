-- The professional's side of the envelope.
--
-- WHY A COLUMN AND NOT JUST THE FLAG ROWS. Most visits are straightforward and
-- produce no flags at all. Keying the seal on "a flag exists" would mean the
-- common case never counts as answering — and every ordinary job would sit
-- sealed until the fortnight ran out, which is the opposite of what
-- double-blind is for. This records that they ANSWERED, which is the fact the
-- seal actually turns on.

alter table public.bookings
  add column if not exists provider_visit_reviewed_at timestamptz;

comment on column public.bookings.provider_visit_reviewed_at is
  'When the professional answered for this visit. Set whether or not they flagged anything — most visits are fine, and a seal keyed on flag rows would never open for an ordinary job.';

create index if not exists bookings_visit_unreviewed_idx
  on public.bookings (provider_id)
  where status = 'completed' and provider_visit_reviewed_at is null;

-- Not the browser's to write, for the same reason the review's own publication
-- state is not: somebody who could stamp their own side as answered could open
-- the envelope early and read the other one.
create or replace function public.enforce_visit_review_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if new.provider_visit_reviewed_at is distinct from old.provider_visit_reviewed_at then
    raise exception 'A visit answer is recorded by the server, not a browser'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_visit_review_stamp()
  from public, anon, authenticated;

drop trigger if exists bookings_enforce_visit_review on public.bookings;
create trigger bookings_enforce_visit_review
  before update on public.bookings
  for each row execute function public.enforce_visit_review_stamp();

-- Reviews are a public directory read, same as the listing they sit on — but
-- only once they have published. A sealed review is the author's alone.
drop policy if exists "Anyone reads provider reviews" on public.provider_reviews;
create policy "Anyone reads published provider reviews"
  on public.provider_reviews for select
  using (published_at is not null);

drop policy if exists "Customers read their own review" on public.provider_reviews;
create policy "Customers read their own review"
  on public.provider_reviews for select to authenticated
  using (customer_id = (select auth.uid()));

-- No insert or update policy for anybody. A review's publication state is not
-- the author's to set: somebody who could stamp `published_at` on their own row
-- could read the other side's first, which is the one thing double-blind exists
-- to stop. Writes go through lib/data/reviews.ts under the service role.
