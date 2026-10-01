-- ---------------------------------------------------------------------------
-- Who the account is actually in the name of.
--
-- THE FIELD THAT WAS NEVER ASKED FOR. `provider_applications` collects
-- `payout_method`, `payout_account` and `payout_bank_name` — and no payee name.
-- `payout_destinations.account_name` is `not null`, so approval could not seed a
-- destination row without inventing one, and the only name to hand is the
-- applicant's own.
--
-- INVENTING IT WOULD HAVE BEEN WRONG IN THE EXACT CASE THE PRODUCT ALREADY
-- KNOWS ABOUT. `payoutIsSomebodyElses` exists because plenty of tradespeople in
-- Nepal do not hold their own wallet — it is a spouse's, a son's, a parent's —
-- and that is more common the older and the poorer the applicant. Writing
-- `full_name` into the payee field would assert something false for exactly
-- those people, which is rule 6 in the shape it takes for a form: a value nobody
-- stated, presented as one they did.
--
-- NULLABLE, AND NOT BACKFILLED. Null here is "we never asked", never a name. The
-- three applications that predate this column keep it, and approval SKIPS
-- seeding a destination for them rather than guessing — they state it on
-- /provider/payouts instead.
--
-- NOT SEALED, unlike `payout_account` beside it, and for the reason SECURITY.md
-- already gives for `payout_destinations.account_name`: the number is the
-- credential, the name is not, and sealing it would mean a decrypt on every row
-- before a reviewer could see whose account they are looking at.
--
-- A NAME THAT DIFFERS FROM THE APPLICANT'S IS ALLOWED. It is shown to the
-- reviewer beside their own, who records why they accepted it in
-- `application_decisions.internal_note`. It is never compared automatically and
-- never scored: a fuzzy match across Devanagari and Latin spellings of the same
-- person is how a signal starts crying wolf, which is the same reasoning
-- `foldNepali` is deliberately narrow for.
-- ---------------------------------------------------------------------------

alter table public.provider_applications
  add column if not exists payout_account_name text
  check (char_length(payout_account_name) between 2 and 120);

comment on column public.provider_applications.payout_account_name is
  'The name the payout account is held in, as stated by the applicant. May legitimately differ from their own — the wallet is often a family member''s. Null means we never asked (it postdates three applications), never that it matches. Shown to the reviewer, never scored.';
