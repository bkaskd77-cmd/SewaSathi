-- Was the number we hold still the account's own, at the instant the payout
-- destination changed?
--
-- WHAT THIS CLOSES. `LAUNCH-BLOCKERS.md § payout-notice-undeliverable` has said
-- since it was written that closing it needs the SMS gateway **and** "a recorded
-- history of the contact number, which this schema does not have". The second
-- half was half-wrong about this schema, and the correction is the reason this
-- column is shaped the way it is: `handle_new_user` copies `auth.users.phone`
-- into `profiles.phone` on INSERT and **nothing ever syncs it again**. So the
-- number we hold is ALREADY frozen at sign-up, and an account takeover that
-- changes the phone changes `auth.users.phone` through GoTrue while leaving our
-- copy exactly as it was. The pre-change number the entry asks for is therefore
-- already in `profiles.phone`.
--
-- WHAT WAS GENUINELY MISSING is that nobody could tell the two states apart.
-- "We hold the professional's current number" and "we hold the number from
-- before somebody changed it" looked identical on `/admin/payout-destinations`,
-- which is the screen where a person decides whether to ring it — so the
-- stronger case was being handled with the weaker one's care, which is the same
-- sentence `notice_devices` was added for one reading over.
--
-- A COLUMN FROZEN AT THE CHANGE, NOT A TRIGGER ON `auth.users`. A trigger was
-- the obvious shape and is refused: `auth.users` is written on every sign-in, so
-- a fault in a trigger there is the whole product locked out, and the blast
-- radius of being wrong is not worth a timestamp. `notice_devices` already
-- established the right arrangement — read the state of the account at the
-- moment somebody redirected it, before the row is written, so a later change
-- cannot rewrite the reading.
--
-- NULL IS "NOT RECORDED", NEVER "MATCHED" — rule 6, and it bites on day one:
-- every row written before this column is silent, and a failed read records null
-- too. Reading that silence as "the number is current" is how an admin rings a
-- dead line believing it was checked.

alter table public.payout_destinations
  add column if not exists contact_phone_matched boolean;

comment on column public.payout_destinations.contact_phone_matched is
  'At the instant this destination was recorded, did profiles.phone still equal auth.users.phone for its professional? true: the number we hold is the account''s own. false: the account''s sign-in number had been changed, so the number we hold is the EARLIER one — the number to ring if the change was not theirs, and possibly dead if it was. Null is "not recorded" (every row predating the column, or a failed read) and must never be read as true.';
