-- A browser gets the columns it writes, and not the table.
--
-- WHAT THIS CLOSES, AND WHY A TRIGGER WAS NOT ENOUGH ON ITS OWN. Supabase's
-- default privilege handed `anon` and `authenticated` INSERT and UPDATE on every
-- column of every table in `public`, so on `bookings` the ONLY thing standing
-- between a signed-in customer and `final_amount`, `platform_fee`,
-- `payment_status` or `provider_id` was `enforce_booking_immutability`. That is
-- a good guard and it held for months — and then somebody rebuilt the function
-- from a stale copy and applied it to the live database only, where no test in
-- this repository could see it. Production spent weeks missing the block that
-- stops a customer writing `billable` on their own booking, the reassignment
-- ban and the `provider_serves` coverage check.
--
-- A grant has the property a trigger does not: **it is refused by the planner,
-- before any row is considered, and it cannot be rebuilt wrongly.** There is no
-- stale copy of a column privilege. `profiles` learned this when a customer
-- could set `role = 'admin'` on their own row; `20260927000005` fixed that one
-- table and nobody asked the question again on the other four.
--
-- THE TRIGGER STAYS. This is a second layer and not a replacement: the trigger
-- is what guards a column the SERVICE ROLE legitimately writes and a browser
-- must not, which is most of them, and it carries the sentences that tell
-- somebody why a write was refused. Defence in depth means the grant refuses
-- first and the trigger refuses anyway.
--
-- EVERY LIST BELOW IS WHAT THE PRODUCT ACTUALLY WRITES THROUGH RLS, read out of
-- `lib/data/` rather than guessed. A column missing from one of these lists is
-- a feature that stops working with `42501 permission denied`, which is loud —
-- and `tests/db/browser-column-grants.test.ts` performs each real write as the
-- customer, so a miss fails there rather than in production.

-- ---------------------------------------------------------------------------
-- First, the whole schema — because the five tables below were never special
-- ---------------------------------------------------------------------------
--
-- `20261002000001_default_privileges_closed.sql` revoked Supabase's default
-- privilege so that a NEW table grants a browser nothing. It could not touch
-- the tables that already existed, because a default privilege applies only at
-- CREATE time — and that half was never done. Read live before this ran:
-- `anon` and `authenticated` each held INSERT and UPDATE on 31 tables and
-- DELETE on 36.
--
-- All of it was inert, and inert is a property of the POLICIES rather than of
-- the privilege. Every table in `public` has RLS enabled (checked, not assumed),
-- `anon` has exactly one write policy in the product and there is no DELETE
-- policy anywhere at all. So nothing was reachable — and every one of those 36
-- tables was one policy away from being reachable with no column guard on it,
-- which is the `payouts` incident's precondition rather than a hypothetical:
-- that table was briefly writable by `anon` through nothing anybody wrote.
--
-- The DELETE grants are the clearest case. Rows in this product are ended by a
-- status or a stamp and never removed; `write-grants.test.ts` pins that no
-- DELETE policy exists. A privilege for a verb the product does not have is
-- 36 locks left open for nothing.
--
-- SELECT IS NOT TOUCHED. Reads are what the policies are for and every public
-- page depends on them; `service_role` is not named, because it is how every
-- server write in `lib/data/` reaches these tables.
--
-- The two statements are split because the agent's connection hangs for a
-- minute and rolls back on a statement carrying both an update and a delete
-- keyword — see the schema notes in CLAUDE.md. Either alone is instant.

revoke insert, update on all tables in schema public from anon, authenticated;
revoke delete on all tables in schema public from anon, authenticated;

-- A table-level revoke takes the column-level privileges with it, so
-- everything a browser may write is granted back below and nowhere else.

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------

revoke insert, update on public.bookings from anon, authenticated;

/*
 * INSERT — `createBooking` in lib/data/bookings.ts, which is the one path a
 * browser creates a booking through.
 *
 * `quoted_min`, `quoted_max` and `quote_model` are here and that is deliberate
 * rather than an oversight: the customer's own call computes them from the
 * published band, and a forged pair mostly hurts the forger — a low ceiling
 * lowers what they can be charged, and `band_min`, which is what commission is
 * charged on, is written by `freeze_booking_band` from `booking_band_bounds`
 * and is NOT grantable here.
 *
 * What is now unreachable on INSERT is the set that matters:
 * `payment_status`, `final_amount`, `platform_fee`, `provider_earning`,
 * `payout_due_at`, `billable`, `guarantee_claim_id` and every stamp. Before
 * this, a hand-crafted POST could have inserted its own booking already marked
 * `paid` with a `platform_fee` — which `/admin/revenue` sums.
 */
grant insert (
  reference,
  customer_id,
  provider_id,
  category_slug,
  address_id,
  description,
  photo_url,
  urgency,
  scheduled_for,
  quoted_min,
  quoted_max,
  quote_model,
  payment_method,
  first_choice_provider_id,
  triage_log_id,
  terms_version,
  band_slug,
  band_source,
  band_asked_at,
  locale
) on public.bookings to authenticated;

/*
 * UPDATE — three paths and five columns between them. `cancelBooking` writes
 * the four cancellation columns, `advanceJob` writes `status`, and `claimJob`
 * writes `provider_id` and `status`.
 *
 * `cancellation_fee` IS NOT HERE, and the write that set it is gone with it.
 * The column defaults to 0, which is what `judgeCancellation` returns for every
 * window — cancelling is always free because our money moves after the work —
 * so omitting it stores exactly what the old write stored. The columns exist so
 * that a fee is later a constant rather than a migration, and the day one is
 * non-zero that path has to move server-side, because a browser cannot write
 * the column. `cancelBooking` refuses rather than under-charging silently.
 *
 * Every stamp a status change implies — `cancelled_at`, `started_at`,
 * `completed_at`, `accepted_at` — is written by `enforce_booking_transition`
 * from inside the trigger, which needs no grant of its own: Postgres checks
 * column privileges against the statement's SET list, never against what a
 * BEFORE trigger assigns to NEW.
 */
grant update (
  status,
  provider_id,
  cancelled_by,
  cancelled_by_role,
  cancellation_reason
) on public.bookings to authenticated;

-- ---------------------------------------------------------------------------
-- addresses
-- ---------------------------------------------------------------------------
--
-- THE ALLOW-LIST SAID "no column here confers anything" AND THAT STOPPED BEING
-- TRUE. It was written when the table held a label and an area; four columns
-- have been added since, and all four are the server's:
--
--   * `lat` / `lng` — the ward centroid, which is a ranking input. A customer
--     who could move their own pin could move themselves to the front of every
--     professional's distance sort.
--   * `upheld_no_shows` — their own no-show history. Writable means erasable.
--   * `first_confirmed_at` — what the trip-confirmation risk rule reads.
--
-- The table was guarded by its policy alone, which validates `profile_id` on
-- both sides and so has nothing to say about which column is being written.
-- That is the `profiles` hole exactly: a correct row guard and no column guard.

revoke insert, update on public.addresses from anon, authenticated;

/* INSERT — `addAddress`. The form's own fields, plus the owner. */
grant insert (
  profile_id,
  label,
  area_key,
  city,
  ward_number,
  tole,
  landmark,
  directions_note
) on public.addresses to authenticated;

/*
 * UPDATE — one column. The only address write a browser makes today is
 * choosing which one is the default, and an edit screen does not exist yet. If
 * one lands it fails with `42501` on the first save, which is the right way to
 * find out that a grant needs widening.
 */
grant update (is_default) on public.addresses to authenticated;

-- ---------------------------------------------------------------------------
-- provider_applications
-- ---------------------------------------------------------------------------
--
-- NOTHING IS GRANTED BACK, because nothing writes it from a browser. Every
-- write — the draft insert, each step save, the submit, the review decision —
-- goes through `createAdminClient()` in `lib/data/applications.ts`,
-- `verification.ts` and `review.ts`. There is not one `createClient()` call
-- against this table in the product.
--
-- So its INSERT and UPDATE policies were a door nobody used, which is exactly
-- what `notifications` turned out to be in `20260928000001`. The policies stay —
-- removing one cannot be applied over the agent's connection, and this file is
-- worded to carry no destructive keyword at all so that it can be — and they are
-- inert without a privilege: the planner refuses before a policy is consulted.
--
-- `enforce_application_immutability` stays too, and keeps being the thing that
-- would refuse `status` or `risk_score` if a grant were ever handed back.

revoke insert, update on public.provider_applications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What is deliberately NOT changed
-- ---------------------------------------------------------------------------
--
-- `service_role` is untouched everywhere above — it is how every server write
-- in `lib/data/` reaches these tables, and `profiles` made the same exception
-- for the same reason.
--
-- Nothing. Every allow-listed table is below or above.

-- ---------------------------------------------------------------------------
-- profiles — the other half of the table this whole idea came from
-- ---------------------------------------------------------------------------
--
-- `20260927000005` closed UPDATE down to three columns and left INSERT
-- table-wide for both browser roles, which is the second lock on the door it
-- had just fitted a lock to. It is inert today: there is no INSERT policy on
-- `profiles`, so RLS refuses, and a row only ever arrives from
-- `handle_new_user` or `claim_provisioned_account` — `security definer`
-- functions running as the owner, which a revoke here does not touch. Nothing
-- in `lib/` inserts a profile at all.
--
-- It is revoked anyway, by the argument that migration made in its own words:
-- "the grant and the policy are two locks and this closes the one that was
-- open". The cost of leaving it is that an INSERT policy added later — for an
-- onboarding step, a referral, anything — is live and unguarded the moment it
-- lands, on the table where `role` lives.

revoke insert on public.profiles from anon, authenticated;

-- And the three columns back, because the blanket revoke above took them.
-- `20260927000005` granted these and it runs earlier in filename order, so a
-- schema-wide `revoke update` after it wipes them — found by
-- `profile-escalation.test.ts` refusing the onboarding write, which is the
-- right way round: a grant list that is too narrow breaks a feature loudly
-- rather than exposing anything. Restated here verbatim rather than reordered,
-- so that reading this file alone tells you what a browser may write.

grant update (full_name, preferred_language, hide_from_activity)
  on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- provider_leads — open to `anon` by design, which is not the same as open
-- ---------------------------------------------------------------------------
--
-- `lib/data/provider-leads.ts` CARRIES A COMMENT SAYING THIS TABLE "grants
-- anonymous visitors INSERT and nothing else", and it was describing behaviour
-- the database did not have: the default privilege gave `anon` UPDATE as well,
-- on all ten columns. That comment is load-bearing — it is the recorded reason
-- the duplicate lead is handled in TypeScript rather than by an upsert, because
-- `on conflict do update` needs an UPDATE policy and an open form must never
-- have one — so the privilege is removed and the sentence becomes true.
--
-- The UPDATE is inert today (there is no UPDATE policy) and `status` is moved
-- only by `createAdminClient()` in `lib/data/applications.ts`. Inert is the
-- state `provider_applications` was in too, and it is one policy away from not
-- being.
--
-- THE INSERT IS NARROWED FOR A REASON THAT IS NOT HYPOTHETICAL. `status` was
-- grantable, so a stranger could post a lead already marked `contacted` — and
-- `startApplication` moves a lead on with `.eq("status", "new")`, so a forged
-- status means a real applicant silently never enters the pipeline. `id` and
-- `created_at` go with it: both have defaults and the form names neither, and a
-- caller-chosen `created_at` is a lead that sorts wherever it likes in the
-- queue somebody works through.

revoke insert, update on public.provider_leads from anon, authenticated;

grant insert (
  full_name,
  phone,
  category_slug,
  area_key,
  years_experience,
  note,
  locale
) on public.provider_leads to anon, authenticated;
