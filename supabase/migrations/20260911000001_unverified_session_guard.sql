-- An unverified session may write one emergency booking and read nothing.
--
-- WHY THIS EXISTS BEFORE THE FEATURE THAT NEEDS IT. The product sells
-- emergencies, and phone OTP is the only way in. If a Nepali gateway turns out
-- to delay or bar codes overnight — an open question with the gateways, see
-- ARCHITECTURE.md — then a first-time customer with a flooding bathroom at 2am
-- cannot sign in, and the designed answer is to let them book *before*
-- verification finishes and confirm them out of band by telephone.
--
-- That answer has one constraint that is not negotiable, and it is the reason
-- this migration lands ahead of the path it guards: **an unverified session
-- must be able to READ NOTHING.** No booking history, no addresses, nobody
-- else's anything. Without it, "book at 2am without a code" becomes "read
-- anybody's bookings by typing their phone number" — an availability problem
-- traded for account takeover, which is a far worse bargain than the one it
-- was meant to fix.
--
-- Written down in a policy rather than a document because a rule with no
-- legitimate exception belongs in the database, and because the day somebody
-- builds the booking path in a hurry at 2am is exactly the day a documented
-- constraint gets skipped. `tests/db/unverified-session.test.ts` proves it.
--
-- IT IS INERT TODAY AND THAT IS DELIBERATE. Verifying an OTP is what sets
-- `phone_confirmed_at`, and OTP is the only way an account can come into
-- existence right now, so every account that exists is confirmed and every
-- policy below evaluates exactly as it did before. Nothing about the
-- out-of-band booking path is built here — only the guard it will need.

-- --- the predicate -----------------------------------------------------------
--
-- FAILS OPEN, ON PURPOSE, AND ONLY IN THE ONE SAFE DIRECTION. It returns false
-- ONLY when there is an auth user whose phone is demonstrably unconfirmed.
-- No session, a user row it cannot see, the service role — all true. A guard
-- on every read in the product must not be able to lock out a legitimate
-- customer because of a lookup that returned nothing, and the failure it
-- exists to prevent requires a real unconfirmed user to exist in the first
-- place.
--
-- `security definer` for the same reason `is_admin()` is: it reads `auth.users`,
-- which `authenticated` cannot select from, and a policy expression runs with
-- the caller's privileges.
create or replace function public.session_is_verified()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from auth.users u
    where u.id = (select auth.uid())
      and u.phone_confirmed_at is null
      and u.email_confirmed_at is null
  );
$$;

comment on function public.session_is_verified() is
  'False only when the caller is an auth user with no confirmed phone or email. Guards every customer read so an unverified emergency session can write one booking and read nothing. See ARCHITECTURE.md.';

-- `execute` for `authenticated` is required, not optional: a policy expression
-- is evaluated with the caller''s privileges, so revoking it breaks every read
-- in the product for every signed-in user. Same trap as `is_admin()`, which
-- Supabase''s Security Advisor will also keep asking you to break.
revoke execute on function public.session_is_verified() from public, anon;
grant execute on function public.session_is_verified() to authenticated;

-- --- the reads it guards -----------------------------------------------------
--
-- `bookings` and `addresses`: the customer's own history, and where they live.
-- The provider-side policies are deliberately untouched — a professional's
-- account reaches this product through an application and an approval, never
-- through an unverified 2am booking, so the predicate would be dead weight on
-- a hot path. The admin policy is untouched for the same reason.

drop policy if exists "Customers read their own bookings" on public.bookings;
create policy "Customers read their own bookings"
  on public.bookings
  for select
  to authenticated
  using (
    (select auth.uid()) = customer_id
    and public.session_is_verified()
  );

drop policy if exists "Own addresses are readable" on public.addresses;
create policy "Own addresses are readable"
  on public.addresses
  for select
  to authenticated
  using (
    (select auth.uid()) = profile_id
    and public.session_is_verified()
  );
