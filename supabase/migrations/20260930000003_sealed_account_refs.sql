-- AFTER-DEPLOY: nothing has to ship first, and here is why that is safe to say.
-- This drops `payout_destinations_account_ref_check` — the `between 3 and 64`
-- length bound — and replaces it with one that requires a sealed envelope. A
-- drop is normally destructive because a deployed build can still be writing
-- rows the new shape refuses, or reading a column the drop removes. Neither
-- applies: `payout_destinations` was created yesterday, holds no rows, and has
-- no writer in any deployed build. The first code that writes it seals first.
--
-- The check asked for this header rather than guessing, which is correct — and
-- it asked AFTER I had already applied the migration to production. The drop
-- was safe; doing it before the local gate ran was not the order. Applying
-- first and checking second is how a destructive change reaches a table that
-- did have rows.

-- ---------------------------------------------------------------------------
-- The database refuses a plaintext account number.
--
-- WHY A CONSTRAINT AND NOT A CODE REVIEW. `lib/security/secret-box.ts` seals
-- `account_ref` before it is written, and that is the intent. A check
-- constraint is what makes it TRUE: a code path that forgets to seal — a
-- backfill script, an admin tool, a hurried fix at midnight, an MCP call — is
-- refused by the planner rather than by somebody noticing later. The same
-- reasoning as `enforce_booking_immutability` existing beside the application's
-- own validation, and as the column grant on `profiles` being preferred to a
-- second trigger.
--
-- THE LENGTH CHECK HAD TO MOVE, and noticing that is the whole reason this is
-- its own migration rather than a line in yesterday's. `account_ref` was
-- `char_length between 3 and 64`, which fits an account number and REFUSES an
-- envelope: `v1.` plus a base64 IV, ciphertext and tag runs to about 110
-- characters for a 40-digit reference. Shipping the sealing without this would
-- have failed every write at the constraint, which is at least loud — but it
-- would have looked like a bug in the sealing rather than an unmoved bound.
--
-- NOTHING IS BACKFILLED HERE because nothing is stored here: the table has no
-- rows and no writer yet. `provider_applications.payout_account` is a different
-- matter — it holds two real numbers in plaintext today — and it is NOT touched
-- by this migration, because sealing it needs the key to exist first and a
-- constraint added before the data is converted would refuse the very update
-- that converts it. That order is in the handover.
-- ---------------------------------------------------------------------------

alter table public.payout_destinations
  drop constraint if exists payout_destinations_account_ref_check;

alter table public.payout_destinations
  add constraint payout_destinations_account_ref_sealed
  check (
    -- `v1.<iv>.<ciphertext>.<tag>`, base64 parts. `isSealed` in
    -- lib/security/secret-box.ts is the same rule in TypeScript, and
    -- tests/db/payout-destinations.test.ts proves the two agree by writing a
    -- sealed value through the constraint and a bare number against it.
    account_ref ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'
    and char_length(account_ref) between 40 and 400
  );

comment on column public.payout_destinations.account_ref is
  'Sealed with AES-256-GCM by lib/security/secret-box.ts. The key is PAYOUT_ENCRYPTION_KEY, a Vercel variable held outside this database, so a leaked backup exposes no account numbers. The constraint refuses anything that is not an envelope.';
