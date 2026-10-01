-- AFTER-DEPLOY: this drops `provider_applications_payout_account_check` — the
-- `char_length <= 400` widening from 20260930000004 — and replaces it with one
-- requiring a sealed envelope. Nothing has to ship first, and here is why that is
-- safe to say: the build that seals on write is ALREADY deployed (0cab9b3), and
-- the two rows that predated it were converted by the maintenance sweep before
-- this file was written — 2 of 2 sealed, 0 not an envelope, confirmed by reading
-- the live table rather than by trusting the sweep's own report. So there is no
-- deployed code path that can still write a shape this refuses.
--
-- The check asked for this header rather than guessing, which is right. Last time
-- it asked AFTER I had already applied the migration; this one is written first.

-- ---------------------------------------------------------------------------
-- The database refuses a plaintext account number on an application too.
--
-- THIS IS THE STEP THAT COULD NOT COME EARLIER, and the ordering is the whole
-- reason it is its own migration. Two rows held real account numbers in the
-- clear; a constraint requiring an envelope, added before they were converted,
-- refuses the very UPDATE that converts them. So the sequence was: widen the
-- bound (20260930000004), convert (the maintenance sweep, run against
-- production), then constrain. Confirmed against the live database before this
-- was written — 2 of 2 sealed, 0 not an envelope, both 61 characters.
--
-- WHY A CONSTRAINT WHEN THE WRITE PATH ALREADY SEALS. `saveStep` seals before
-- the update, and that is the intent. This is what makes it TRUE for the paths
-- that bypass the intent entirely: a backfill script, an admin tool, an MCP
-- call, a hurried fix at midnight. Identical reasoning to
-- `payout_destinations_account_ref_sealed`, and to `enforce_booking_immutability`
-- existing beside the application's own validation.
--
-- NULL IS ALLOWED, because most applications have not answered the payout step
-- yet. An unanswered question is not a plaintext account number, and a NOT NULL
-- here would refuse every draft before step six.
--
-- WHAT THIS RETIRES. `lib/data/payout-account.ts` carried a branch returning a
-- bare number unchanged, for exactly the two rows that are now converted; the
-- sweep and its route existed only to convert them. All three go in the commit
-- that adds this, because a tolerance for a shape the database now refuses is
-- dead code that reads like a hedge.
-- ---------------------------------------------------------------------------

alter table public.provider_applications
  drop constraint if exists provider_applications_payout_account_check;

alter table public.provider_applications
  add constraint provider_applications_payout_account_sealed
  check (
    payout_account is null
    or (
      -- `v1.<iv>.<ciphertext>.<tag>`, base64 parts. `isSealed` in
      -- lib/security/secret-box.ts is the same rule in TypeScript, and the
      -- envelopes in this table are 61 characters — well inside the bound the
      -- identical constraint on payout_destinations.account_ref uses.
      payout_account ~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$'
      and char_length(payout_account) between 40 and 400
    )
  );

comment on column public.provider_applications.payout_account is
  'Sealed with AES-256-GCM by lib/security/secret-box.ts. The key is PAYOUT_ENCRYPTION_KEY, a Vercel variable held outside this database, so a leaked backup exposes no account numbers. The constraint refuses anything that is not an envelope. The applicant sees their own value back on their own draft; an admin sees it masked.';
