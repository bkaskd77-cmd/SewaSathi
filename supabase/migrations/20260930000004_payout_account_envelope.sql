-- ---------------------------------------------------------------------------
-- Make room for a sealed account number on an application.
--
-- WHY THIS IS A WIDENING AND NOT THE SEALING CONSTRAINT. `payout_account` is
-- `char_length <= 40`, which fits an account number and REFUSES an envelope:
-- `v1.` plus a base64 IV, ciphertext and tag runs to about 110 characters. The
-- same bound that had to move on `payout_destinations.account_ref`, and the same
-- reason it was caught in time — noticing it before shipping the sealing rather
-- than after every write started failing at the constraint.
--
-- THE SHAPE CHECK CANNOT COME YET, and the order is the whole point. There are
-- two real plaintext account numbers in this table today. A constraint requiring
-- an envelope, added now, would refuse the very UPDATE that converts them — the
-- rule `20260930000003`'s header already states, applied to a table that HAS
-- rows rather than one that does not. So: widen, convert, then constrain.
--
-- The lower bound goes too. A sealed value is never 3 characters and an account
-- number's minimum length was never enforceable here anyway: `accountKey` in
-- `lib/verification/match-keys.ts` normalises what people type, and a check on
-- the stored form would be a rule about our own encoding wearing the costume of
-- a rule about their bank.
-- ---------------------------------------------------------------------------

alter table public.provider_applications
  drop constraint if exists provider_applications_payout_account_check;

alter table public.provider_applications
  add constraint provider_applications_payout_account_check
  check (char_length(payout_account) <= 400);

comment on column public.provider_applications.payout_account is
  'Where the applicant says they want to be paid. Sealed with AES-256-GCM by lib/security/secret-box.ts once 20260930000005 lands; two rows predate that and are converted by the maintenance sweep at /api/maintenance/seal-applications. The applicant sees their own value back on their draft; an admin sees it masked.';
