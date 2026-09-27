-- A customer cannot promote themselves to admin. Until this migration, they could.
--
-- THE HOLE. `profiles` has one update policy — "Profiles are updatable by their
-- owner", `using ((select auth.uid()) = id)` — and Supabase grants
-- `authenticated` table-wide UPDATE on every table in `public` through a default
-- privilege. RLS is ROW-level, so those two together let the owner write every
-- column on their own row, `role` among them, and there was no BEFORE UPDATE
-- trigger on the table. One request from any signed-in customer's browser:
--
--     PATCH /rest/v1/profiles?id=eq.<self>   {"role":"admin"}
--
-- `using` and `with check` both pass, because `id` does not change. `is_admin()`
-- then returns true and the six policies behind it open: every profile, every
-- booking, every payment, every triage log, and the identity documents in the
-- private bucket.
--
-- It is the same class CLAUDE.md records for `bookings` — "a policy that lets
-- somebody update a row lets them update every column on it" — one table over.
-- It was found while adding the activity-strip opt-out, which is the product's
-- first customer-facing write to this table: the guard goes in before the write.
--
-- A COLUMN GRANT RATHER THAN A TRIGGER, and the difference is the exception it
-- does not need. `enforce_booking_immutability` exists because the service role
-- legitimately writes the columns it guards, so it carries an `auth.uid() is
-- null` bypass — a bypass is a thing that can be reached the wrong way. A grant
-- is refused by the planner before a row is considered, has no bypass to
-- misjudge, and is readable straight out of `information_schema`.
--
-- THREE COLUMNS, because three are what a browser legitimately writes:
--   * `full_name`, `preferred_language` — `components/auth/onboarding-form.tsx`
--     writes both from the client on the way through onboarding.
--   * `hide_from_activity` — the opt-out on /account.
-- `role`, `id`, `phone` and `created_at` are now unwritable from any browser.
-- `role` is still written by `lib/data/review.ts` when an application is
-- approved, under `createAdminClient()`; `service_role` holds its own grants and
-- nothing here touches them. `phone` comes from the signup trigger and is the
-- login identifier — nothing in the product has ever written it from a session.
--
-- `anon` is included in the revoke although no policy grants it UPDATE. The
-- grant and the policy are two locks and this closes the one that was open.

revoke update on public.profiles from anon, authenticated;

grant update (full_name, preferred_language, hide_from_activity)
  on public.profiles to authenticated;
