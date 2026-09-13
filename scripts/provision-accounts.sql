-- The walkthrough roster. Environment data, applied by hand, NOT a migration.
--
-- DELIBERATELY NOT IN `supabase/migrations/`. Everything in that directory runs
-- against every deployment and every fresh clone, and these rows are privilege
-- grants: a migration carrying them would put a standing admin grant for two
-- named phone numbers into any future project built from this repository.
-- Schema belongs in a migration; who is an admin does not.
--
-- It is checked in anyway, because the alternative is a set of grants that
-- exist only in one database with no record of who put them there or why —
-- which is the thing `provisioned_accounts.label` exists to prevent.
--
-- Applied with the Supabase MCP against the live project. Re-running it is
-- safe: every statement is an upsert and none of them touches `claimed_at`.
--
-- THE CODES ARE NOT HERE. The six-digit OTP for each number lives in Supabase
-- → Authentication → Providers → Phone → test numbers, and nowhere in this
-- repository. A fixed code beside the number it opens is a password written on
-- the door.
--
-- ---------------------------------------------------------------------------
-- ONE NUMBER, ONE ENTITY. The rule, and why the roster was rewritten.
-- ---------------------------------------------------------------------------
--
-- The first roster had two customers, two providers and three admins, and
-- within a fortnight reality had drifted off it entirely: the two "customer"
-- numbers had been used to walk the provider application and become providers,
-- and the original admin account had also made every booking in the database
-- AND been linked to a seed listing. One account was all three entities at
-- once, which is precisely why nobody could tell which dashboard was which.
--
-- A test account that can be two things cannot test either. So there is now
-- exactly one number per role, and the roster is the whole answer to which is
-- which — see TESTING.md for the table a person reads.
--
-- The grants below are also what UNDOES the drift: a `customer` or `admin`
-- grant strips any listing the account had picked up, because an admin who
-- owns a listing is an admin with a work surface, and that is the blur the
-- separation exists to remove.

insert into public.provisioned_accounts (phone, role, label, provider_id, note)
values
  -- The customer. It owns every booking made so far, which is deliberate:
  -- the dashboard is three tiers deep now and an empty one proves nothing.
  ('9779841234567', 'customer', 'TEST — customer', null,
   'The customer walkthrough account. Owns every booking made so far, so the dashboard has real content.'),

  -- The professional. Linked to its own listing, so `/provider` and
  -- `/provider/jobs` open on something real rather than the unlinked dead end.
  ('9779800000011', 'provider', 'TEST — professional',
   '8e4f6040-d678-494f-b347-08b39245beb9',
   'The professional walkthrough account. Linked to its own listing.'),

  -- The admin. No listing and no bookings, on purpose.
  ('9779800000012', 'admin', 'TEST — admin', null,
   'The admin walkthrough account. No listing and no bookings: an admin is not a third kind of customer.'),

  -- Break-glass, and NOT a walkthrough account.
  --
  -- A Supabase test number short-circuits the gateway: the code is checked by
  -- Supabase itself and no message is ever sent. That is exactly what makes it
  -- a break-glass — it works while the gateway is dead — and it is also why
  -- the break-glass must not be somebody's real number. A test entry on a real
  -- number means that number can never receive a real code again, which costs
  -- the owner their ordinary way in and, worse, makes any delivery test run
  -- against it meaningless.
  ('9779800000001', 'admin', 'Break-glass admin — test number only', null,
   'Not a walkthrough account. Never receives real SMS by design. See SECURITY.md.')
on conflict (phone) do update
  set role = excluded.role,
      label = excluded.label,
      provider_id = excluded.provider_id,
      note = excluded.note;

-- Apply to anybody who has already signed in. The trigger only fires on
-- insert, so without this an existing account keeps whatever role it had.
-- Both directions happen in one statement, so there is never a moment with no
-- admin in the project.
update public.profiles p
   set role = g.role
  from public.provisioned_accounts g
 where p.phone = g.phone
   and p.role is distinct from g.role;

-- Link the professional to their listing.
update public.providers pr
   set profile_id = p.id
  from public.provisioned_accounts g
  join public.profiles p on p.phone = g.phone
 where pr.id = g.provider_id
   and pr.profile_id is null;

-- ...and UNLINK everybody else from one. An account granted `customer` or
-- `admin` must not keep a listing it acquired by walking the application:
-- that is how one number came to be all three entities at once. The listings
-- themselves are left alone, because bookings reference them and history must
-- not change under a test-account tidy-up.
update public.providers
   set profile_id = null
 where profile_id in (
   select p.id from public.profiles p
   join public.provisioned_accounts g on g.phone = p.phone
   where g.role <> 'provider'
 );

update public.provisioned_accounts g
   set claimed_at = coalesce(g.claimed_at, now()),
       claimed_by = coalesce(g.claimed_by, p.id)
  from public.profiles p
 where p.phone = g.phone;
