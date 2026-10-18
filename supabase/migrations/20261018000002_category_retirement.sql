/*
 * A TRADE A PERSON CAN OPEN AND WITHDRAW — AND A WITHDRAWN ONE THAT CAN STILL
 * BE NAMED.
 *
 * `categories.is_active` has existed since the first migration, it is read by
 * the table's own policy AND by `getCategories`' query, and **nothing in the
 * product could ever write it**. So withdrawing a trade meant a migration, and
 * `applyRedoRecovery`'s four-phase sin applies to a column as much as to a
 * function: a gate nothing can move is not a gate.
 *
 * THREE COLUMNS, BECAUSE A BOOLEAN CANNOT ANSWER THE QUESTION THAT GETS ASKED.
 * `is_active = false` records that we stopped and nothing else — not when, not
 * why, not who — and "why did we stop selling water tank cleaning" is exactly
 * what somebody asks six months on. This is `areas_retired_shape` one table
 * over, deliberately the same shape so the two screens read alike.
 *
 * `categories_retired_shape` TIES THE PAIR, which is the part worth reading.
 * `is_active` and `retired_at` are one fact in two columns — this repo's
 * most-repeated sin — and they cannot be collapsed into one: the policy below
 * and `lib/data/categories.ts`' query both name `is_active`, and making it a
 * GENERATED column means dropping and re-adding it, which this transport
 * refuses and which would take the policy with it. So the constraint is the
 * invariant instead: `is_active = (retired_at is null)`, enforced by the
 * database, so no caller can set one without the other.
 *
 * AND THE POLICY WIDENS TO EVERY ROW, which is the bug this migration found.
 * `using (is_active)` hid a withdrawn trade from `anon` — and every booking
 * ever taken keeps its `category_slug` with no foreign key behind it, while
 * `/bookings/[id]` and `/provider/jobs` BOTH fall back to printing the bare
 * slug when the lookup misses. Retiring a trade would therefore have put
 * `water-tank-cleaning` on a customer's own booking page. Which rows are SOLD
 * is `getCategories`' filter, where it belongs — RLS is a floor, not a filter —
 * and the row carries `retired_at`, so nothing can read it as sellable.
 * `lib/data/categories.ts`' `allCategories` is the label read, the same split
 * `allAreas` / `bookableAreas` already makes for wards.
 *
 * Ordering: columns, then comments, then the constraint, then the policy. Per
 * `npm run check:migrations` — stopping anywhere leaves the table no more open
 * than it started, and the widened policy lands last because it is the only
 * clause here that shows anybody anything new.
 */

alter table public.categories
  add column if not exists retired_at timestamptz,
  add column if not exists retired_reason text,
  add column if not exists retired_by uuid references public.profiles (id) on delete set null;

comment on column public.categories.retired_at is
  'When we stopped selling this trade. NULL is "we still sell it", never "unknown" — categories_retired_shape keeps it in step with is_active.';
comment on column public.categories.retired_reason is
  'Why, in somebody''s own words. Required whenever retired_at is set: a withdrawal nobody can answer a question about later is the thing the constraint exists for.';
comment on column public.categories.retired_by is
  'The admin who withdrew it. NULL also means their profile was since deleted (on delete set null), so it is never read as "nobody did it".';

alter table public.categories
  drop constraint if exists categories_retired_shape;
alter table public.categories
  add constraint categories_retired_shape check (
    is_active = (retired_at is null)
    and (
      (retired_at is null and retired_reason is null and retired_by is null)
      or (
        retired_at is not null
        and retired_reason is not null
        and length(btrim(retired_reason)) > 0
      )
    )
  );

drop policy if exists "Anyone reads active categories" on public.categories;
drop policy if exists "Anyone reads every category" on public.categories;
create policy "Anyone reads every category"
  on public.categories for select
  to anon, authenticated
  using (true);

/*
 * No grant clause: `categories` has carried `select` for both browser roles
 * since it was created and this migration neither widens nor narrows that.
 * Writes stay where `20261011000004` left them — revoked schema-wide from both
 * browser roles, so every write here is `lib/data/categories-admin.ts` under
 * the service role, behind a fresh second factor.
 */
