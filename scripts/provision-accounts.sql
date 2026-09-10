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

insert into public.provisioned_accounts (phone, role, label, provider_id, note)
values
  -- Break-glass. Bikas's real number, so admin is reachable even if the SMS
  -- gateway never delivers a single message. See SECURITY.md.
  ('9779843119897', 'admin', 'Bikas Khadka — break-glass admin', null,
   'Real number. Break-glass: also configured as a Supabase test number so sign-in never depends on delivery.'),

  -- The account that already existed and was promoted by hand in August. The
  -- row is written so the table is the whole answer to "who is an admin",
  -- rather than being true for new accounts and silent about old ones.
  ('9779841234567', 'admin', 'Bikas Khadka — original admin', null,
   'Pre-dates this table. Recorded here so the grant is visible rather than only in profiles.role.'),

  ('9779800000011', 'customer', 'Walkthrough customer A', null,
   'Test number. The household booking a job.'),
  ('9779800000012', 'customer', 'Walkthrough customer B', null,
   'Test number. A second household, for checking that one customer cannot see the other.'),

  -- Linked to seed listings so `/provider/jobs` opens on a real listing rather
  -- than the "your account is not linked" dead end.
  ('9779800000021', 'provider', 'Walkthrough provider A — plumbing',
   'd431eabc-3d3f-5b99-a484-03ffe615e7e9',
   'Test number. Linked to the Ramesh Tamang seed listing (plumbing).'),
  ('9779800000022', 'provider', 'Walkthrough provider B — electrical',
   '852371c7-8dc8-56cf-94bd-c8677f63ef4e',
   'Test number. Linked to the Dipak Shrestha seed listing (electrical).')
on conflict (phone) do update
  set role = excluded.role,
      label = excluded.label,
      provider_id = excluded.provider_id,
      note = excluded.note;

-- Apply to anybody who has already signed in. The trigger only fires on
-- insert, so without this an existing account keeps whatever role it had.
update public.profiles p
   set role = g.role
  from public.provisioned_accounts g
 where p.phone = g.phone
   and p.role is distinct from g.role;

update public.providers pr
   set profile_id = p.id
  from public.provisioned_accounts g
  join public.profiles p on p.phone = g.phone
 where pr.id = g.provider_id
   and pr.profile_id is null;

update public.provisioned_accounts g
   set claimed_at = coalesce(g.claimed_at, now()),
       claimed_by = coalesce(g.claimed_by, p.id)
  from public.profiles p
 where p.phone = g.phone;
