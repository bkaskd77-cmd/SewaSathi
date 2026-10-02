# Security

What this product holds, who may touch it, and where that is enforced.

Written in Phase 9, before provider onboarding, because that phase starts
collecting citizenship certificates and photographs of people's faces and a
storage model designed after the data exists is a migration performed on live
identity documents.

**The sensitive core of this product is home addresses and phone numbers.** A
leak here is not a list of emails. It is where people live, paired with when
they are out and who came to the door.

---

## 1. Authorization — every way in

Every write is a Next server action or a route handler. There are no other
endpoints. The rule they all follow: **the actor is read from the session on
the server, never accepted from the caller**, and the data layer re-reads the
subject and decides.

### Customer surfaces

| Endpoint | Who may call it | What it may act on | Enforced by |
| --- | --- | --- | --- |
| `confirmBookingAction` | any signed-in customer | their own booking, at an address they own | session → `actorId`; RLS insert policy; `enforce_booking_address_ownership` trigger; `booking` rate limit |
| `saveAddressAction` | any signed-in customer | an address owned by them | session → `profileId`; RLS insert policy on `addresses` |
| `uploadPhotoAction` | any signed-in customer | a file under their own storage prefix | session → path prefix; storage insert policy; `checkUploadedImage` |
| `shortlistAction` | anybody signed in | public directory data only | nothing to enforce — it reads what `/services` shows |
| `cancelBookingAction` | the booking's customer | their own booking, only while cancellable | RLS update policy; status trigger; `judgeCancellation` |
| `chooseProviderAction` | the booking's customer | their own pending, refused booking | `chooseProvider` re-reads; immutability trigger checks coverage and refusals |
| `checkForProviderAction` | the booking's customer | their own booking's dispatch stage | `checkDispatchNow` compares `customer_id`; the stage comes from timestamps, so it cannot widen anything early |
| `startPaymentAction` | the booking's customer | a payment on their own booking | `startPayment` re-reads the booking and the amount |
| `approveAmountAction` | the booking's customer | the approval flag on their own booking | `approveFinalAmount` re-reads; the approval is bound to a specific figure |
| `disputeAmountAction` | the booking's customer | a dispute flag on their own booking | `disputeAmount` compares `customer_id` |
| `confirmCashAction` | the booking's customer | settlement of their own cash payment | `confirmCashPayment` compares `customer_id`; blind entry; mismatch stops settlement |
| `recheckPaymentAction` | the booking's customer | re-verification of their own payment | the reference is checked against payments RLS-visible to the caller |
| `abandonPaymentAction` | the booking's customer | an in-flight payment of theirs | `abandonPayment` re-reads and asks the gateway first |
| `respondToQuoteAction` | the booking's customer | approving or declining a surveyed price on their own booking | `respondToQuote` reads through RLS (the ownership check) and compares `customer_id`; the stamp is a service-role write because `enforce_booking_immutability` refuses `quote_approved_at` to every browser caller — RLS is row-level, so the cancel policy would otherwise let a customer approve a price nobody surveyed |

### Provider surfaces

| Endpoint | Who may call it | What it may act on | Enforced by |
| --- | --- | --- | --- |
| `advanceJobAction` | the assigned professional | one booking assigned to them | `getMyProvider` from session; RLS read; `canTransition`; status trigger |
| `offerOverbookAction` | any professional the open job is visible to | claiming one open job, with an offer stamped on it | `getMyProvider` from session; the RLS read is the eligibility check; the offer is a service-role write because `enforce_booking_immutability` refuses it to browsers; the claim itself still goes through RLS so the race is settled by the policy |
| `overbookMissAction` | the assigned professional who made the offer | handing back one job of theirs that they offered on | `getMyProvider` from session; RLS read; refuses unless `overbook_offered_by` is their own listing and the status is `accepted` or `en_route`; the release is service-role because a professional cannot write their own release through RLS |
| _(no provider endpoint)_ `survey_visit_fees` | no professional writes one, through RLS or otherwise | what we owe a surveyor for a visit the customer declined | no INSERT or UPDATE policy exists, same posture as `payments` and `commission_appeals`; rows are written by `lib/data/survey.ts` under the service role and `enforce_survey_visit_fee` refuses one with no recorded arrival, an approval with no `decided_by`, or a fifth approved fee in a month. A professional **reads** their own through RLS on `/provider` — `mySurveyFees` — and can change nothing about it. Approving one is an admin surface, below |
| `recordSurveyQuoteAction` | the assigned professional | the surveyed range on one survey-priced booking of theirs | `getMyProvider` from session; RLS read proves the job is theirs; `enforce_survey_quote` refuses a rewrite after the customer has answered and refuses `in_progress` without an approval |
| `declineJobAction` | the assigned professional | releasing that one booking | RLS read proves ownership, then a server write (an UPDATE may not make a row invisible to its writer) |
| `claimJobAction` | any professional who covers it | one open, unassigned booking | the claim policy's `using` clause settles the race; refusals excluded |
| `recordAmountAction` | the assigned professional | the final amount and the parts figure on their job | `recordFinalAmount` re-reads; band clamp; ceiling; materials bounded to `0..amount` here and by `bookings_materials_within_amount`; both in `security_events`, because the parts line later reduces a refund they may be asked to fund |
| `appealCommissionAction` | the professional who did the job | one appeal on that booking | `openCommissionAppeal` re-reads and refuses an appeal against a floor never applied |
| `setAvailabilityAction` | any professional with a listing | the `available_until` stamp on their own listing | listing resolved from the session; the expiry is computed server-side by `availableUntil`, never passed in |
| `setRateAction` | any professional with a listing | `base_rate` and `base_rate_requested` on their own listing | listing resolved from the session; `clampRate` against the published band for their trades |
| `acceptClaimAction` / `releaseClaimAction` | the professional a claim names | taking or giving back one return visit | provider id from the session; `acceptClaim` re-reads the claim; the claim transition trigger |
| `recordVerdictAction` | the professional who attended | the verdict and the parts answer on one claim | verdict validated against `CLAIM_VERDICTS` here and by the column check; `resolved` is reachable only from `attended`; `parts_failed` is theirs alone to state — the adjudicator was not in the room — and is written on both the attend and resolve moves so an already-attended claim cannot lose it |
| `claimSignals` (read, no action) | admins, through `/admin/guarantee-claims` behind `adminGate` | counts across one professional and one customer | service role; counts only (`head: true`), never rows — the screen needs "how many", never "which"; nothing it returns is read by `refundCeiling`, `judgeRefund` or `enforce_claim_refund` |
| `GET /api/health?deep=1` — `triage.model` | nobody without `CRON_SECRET`; the whole `deep=1` branch refuses otherwise | sends one 1-token message to Anthropic and reports whether the key works | no session exists here, so the secret is the whole guard. It is behind `deep=1` for the same reason the OTP send is: it costs money, and an open endpoint that spends money is a bill. It sends no customer data — the prompt is the literal string `hi` — and the provider's own refusal message is passed through because this is a private endpoint and the MFA bug cost three deploys to a catch that swallowed exactly that sentence |
| `GET /api/health` — `triage.fallback` | public, like the rest of the cheap payload | counts triages in the last hour and how many fell back | service role, two `head: true` counts and no rows: the numbers leave the function and nothing else does — no `input_text`, no user id, no category. A count of requests per hour is the same order of operational detail the endpoint already publishes as region and database latency |
| `listConcentration` / `listRankingEvidence` (read, no action) | admins, through `/admin/signals` behind `adminGate` | aggregate counts over `bookings` and `provider_stats` | service role. **Counts only, never rows**: no professional is named, no booking reference and no customer id leaves either function — the screen reports the busiest share, not who holds it. That is deliberate rather than incidental: a per-person concentration figure read as a suspicion list is the same mistake `payment_mix_signals` refuses by never grouping by professional. Neither is a ranking input |
| `triageAccuracy` (read, no action) | admins, through `/admin/triage-accuracy` behind `adminGate` | aggregate counts over `triage_logs` and the bookings that name one | service role, because `triage_logs` has no read policy for anyone but an admin and the join needs `bookings` across every customer. **It returns counts, never rows**, and it does not even read the identifying columns: `input_text` is not selected, and neither is a booking's `id`, `reference` or `customer_id`. So the screen cannot show what any one person typed about their home, and no future edit to it can start doing so without widening the query first. Nothing it returns is an input to a price band, a ranking weight or the safety floor: it is read by a human and by nothing else |
| `GET /api/payments/reconcile` | nobody without `CRON_SECRET`; refuses outright when the secret is unset | settles stuck payments, then recovers redo debt against due payout **tranches** | service role; no session exists here, so the secret is the whole guard. The recovery half only ever REDUCES a payout that has not been made — nothing is charged, chased or collected, and `provider_ledger` is append-only so a wrong row cannot be quietly corrected. A booking with a long guarantee pays in two tranches, and `provider_ledger_recovery_tranche_idx` is unique on `(booking_id, tranche)` — the old single-column index would have let a released holdback slip past the sweep's own filter unrecovered and unlogged |

**Customer side, added this phase.** `openClaimAction` and
`withdrawClaimAction` take a booking or claim id and nothing else; the actor is
the session. `openClaim` re-reads the booking and judges it with
`claimIsAllowed`, and `enforce_claim_eligibility` refuses a claim on somebody
else's booking, on an unfinished job, or a third one — with no service-role
bypass, because no path in this product does any of those legitimately.
`guarantee_claims` and `provider_ledger` grant nobody an insert or update
through RLS; reads are the customer's own, the professionals a claim names, and
admins. The ledger is append-only and its trigger refuses UPDATE and DELETE for
every caller, service role included.

### Admin surfaces

Every one of these re-reads `profiles.role` from the session **in the action**,
not only on the page. A page guard stops somebody SEEING a screen and does
nothing at all to stop them calling the server action behind it, which is a
public POST endpoint like any other.

| Endpoint | Who may call it | What it may act on | Enforced by |
| --- | --- | --- | --- |
| `decideClaimAction` | admins | one wasted-trip claim | role re-read in the action; `settleNoShowClaim` re-reads the claim |
| `decideSurveyFeeAction` | admins | one pending survey visit fee | role re-read in the action **and** again in `decideSurveyVisitFee`; the update is guarded on `status = 'pending'` so two reviewers produce one decision; `enforce_survey_visit_fee` refuses an approval with no `decided_by` and the fifth approved fee in a month, on the UPDATE as well as the INSERT |
| `resolveAppealAction` | admins | one open commission appeal | role re-read in the action and again in `resolveCommissionAppeal`; refuses an appeal that is not `open`; upholding recomputes the split against the `commission_bps` frozen at settlement, never today's rate; written to `security_events` as `commission.appealResolved` |
| `resolveMismatchAction` | admins | one cash job whose two figures disagree | role re-read in the action **and** again in `resolveAmountMismatch`; refuses a booking with no open mismatch, and the UPDATE repeats `amount_mismatch_resolved_at is null` so two reviewers produce one settlement; the settled amount is judged by `judgeMismatchResolution` against the same 2× quoted-max ceiling the professional faces — including when the customer's own figure is chosen, which nothing had ever checked; only a *third* figure arrives from the form, because the two party figures are re-read from the booking; written to `security_events` as `payment.mismatchResolved` |
| `decideApplicationAction` | admins | one provider application | role re-read in the action; document reads logged separately by `recordDocumentAccess`, and the applicant's and referees' phone numbers by `recordContactAccess` on every load of the review screen |
| `approvePayoutAction` | admins | one drafted payout | `adminActor()` in the action; `approvePayout` re-reads the row and refuses anything that is not still `draft`, anything carrying a `held_reason`, and a session whose `amr` proof is older than `REAUTH_WINDOW_MINUTES` — fifteen minutes, not the eight-hour step-up, because this is the write that releases a week of somebody's earnings. A reason is required and recorded. If the professional's ledger row count has moved since the draft, **nothing is approved**: the figure is recomputed in place (guarded on `status = 'draft'`, which `enforce_payout_transition` is what permits) and the caller is told to read the new number |
| `markSentAction` | admins | one approved payout | `adminActor()`; `markPayoutSent` refuses anything not `approved`, a stale `amr`, a missing transaction reference, and a destination that has changed since the draft. It writes the `payout` ledger row **before** the status, so a half-failure leaves the balance right and the retry idempotent on `provider_ledger_payout_once_idx` |
| `markConfirmedAction` | admins | one sent payout | `adminActor()`; `markPayoutConfirmed` refuses anything not `sent`. **No re-challenge, deliberately**: it records an answer that came from outside and moves no money, and a code demanded for a write that cannot cost anybody anything is how people learn to tap through the ones that can |
| `markFailedAction` | admins | one payout not yet confirmed or failed | `adminActor()`; stale `amr` refused; a reason required and recorded. `needsReversal` decides whether a `payout_reversal` is written — only from `sent`, because a draft and an approval moved nothing — and the `payout` row is never deleted, which an append-only ledger forbids and which would erase the evidence a remittance was attempted |
| `revealDestinationAction` | admins, from `/admin/payouts` | returns one account number in plaintext | `adminActor()`; a reason of at least four characters refused here **and** in `revealDestination`, which writes `security_events` before it opens the envelope. The number is the action's return value and is never rendered into the page, so it stays out of the server HTML, the router cache and anything a later visitor to the screen receives |

**Every admin endpoint above now goes through `adminActor()`**, which is
`adminGate()` collapsed to a profile or null: it re-reads the role *and* the
second factor. An action has no screen to send anybody to, so every refusal
returns the same answer — leaking which half of the gate somebody failed would
tell a caller what to attack next.
| `issueRefundAction` | admins | agrees money back on one guarantee claim | role re-read in the action **and** again in `issueRefund`; `judgeRefund` judges first so the reviewer gets a sentence, and `enforce_claim_refund` — no service-role bypass — refuses a second refund, a rupee over `least(final_amount, customer_reported_amount)`, an unsettled or disputed booking and one past the trade's window; the claim write is guarded on `refund_rupees = 0` so two reviewers produce one refund; writes the `refunds` row at `requested`, never `completed` |
| `markRefundPaidAction` | admins | records that one approved refund has actually been sent | role re-read in the action and again in `markRefundPaid`; guarded on `status = 'requested'`; a reference of at least three characters and a non-future date are required, and `refunds_processed_shape` refuses a completed row with no `processed_at` |
| `sendRefundAction` | admins | sends one approved refund through the gateway that took it | role re-read in both places; `refundRail` refuses every rail but a **configured** Khalti, so a missing key is reported as a missing key rather than silently becoming "manual"; a gateway that does not answer leaves the row at `requested` — the money may already have moved, so nothing is recorded either way |

**Neither money queue can pay itself, and that is the point of both.**
`survey_visit_fees` and `commission_appeals` are born waiting for a person
because an automatic payoff is a farmable one — quote high, get declined,
collect. The screens are that person's hand; they add no rule of their own and
re-implement none of the database's, so a cap refusal reaches the reviewer as
the policy it is rather than as a failed save.

**A guarantee refund now has a screen, and it takes two people's acts rather
than one.** `/admin/guarantee-claims` approves an amount, which writes a
`refunds` row at `requested` and nothing else; a second act records that the
money has actually gone, with the reference it went under and the date. The
split is not ceremony: eSewa has no merchant-initiated refund on ePay v2 and
cash comes back the way it went out, so on two of our three rails a person
leaves this product, moves the money and comes back. A single "refunded"
written at approval would be the product asserting a payment nobody made — and
would remove the only thing that would ever remind us to make it. The queue
surfaces anything sitting at `requested` past `REFUND_PAYMENT_DAYS`, because an
unpaid approved refund is indistinguishable, from the customer's side, from one
refused without being said.

### Public and machine surfaces

| Endpoint | Who may call it | What it may act on | Enforced by |
| --- | --- | --- | --- |
| `joinAction` | anybody | inserts one provider lead | the only anon write in the product; `join` rate limit by IP |
| `signOutAction` | anybody signed in | their own session | Supabase cookie; writes `auth.signedOut` |
| `POST /api/triage` | anybody | nothing — it reads and answers | `triage` rate limit by user or IP; no writes but a log row. The reply now also carries the chosen trade's published sub-bands, for the card's one question — the same rows `category_price_bands` already releases to `anon` under "Price bands are public", so nothing new leaves the database |
| `GET /api/health` | anybody | nothing; reports state, sends no data | `?deep=1` needs `CRON_SECRET`. `db.functions` reads `function_fingerprints()` under the service role and reports hashes and names only — no function bodies leave the database, and the RPC is revoked from `anon` and `authenticated`. `auth.sms.probe` reports whether `SMS_HEALTH_NUMBER` is set and parseable and **never the number itself** — it is a real handset on a public endpoint, and `PhoneError` is a fixed key set carrying no digits. The `deep=1` 401 now separates a wrong token from an unset `CRON_SECRET`: it admits nobody either way, and the only thing disclosed is that the expensive checks are switched off here |
| `GET /api/version` | anybody | nothing | commit and build time only |
| `GET/POST /api/payments/[gateway]/return` | the gateway, and the customer's browser | settles one payment by reference | the callback is a claim: `verify()` asks the gateway's servers and reconciles the figure |
| `GET /api/payments/reconcile` | cron | in-flight payments | `CRON_SECRET`; refuses everything if unset |
| `GET /api/bookings/dispatch` | cron | pending bookings past their window | `CRON_SECRET`; the stage comes from timestamps |

**Removed in this phase:** `POST /api/bookings/[id]/final-amount`. It was the
Phase 7 way to record a final amount before the provider screen existed. The
screen exists now, so this was a second door into the most money-critical
function in the product, with no caller.

### The four claims, and where each is proved

- *A customer cannot read or act on another customer's booking, address,
  payment or profile.* — `tests/db/booking-rls.test.ts`, per table plus the
  catalog-driven sweep.
- *A provider cannot read another provider's jobs, earnings or customer
  contact details.* — "a provider's job list is theirs alone", and
  `provider_contacts` is released only while a job of theirs is live.
- *A customer cannot reach a provider or admin surface.* — every provider
  action starts with `getMyProvider(session)`, which returns null for a
  customer; admin surfaces do not exist yet and `is_admin()` gates the
  policies that will back them.
- *No endpoint trusts an id, actor or role sent by the client.* — audited
  file by file in this phase. One violation found (`addressId`), fixed in the
  database.

### The audit log is readable, and reading it is logged

Nothing had ever read `security_events`. Events have been written since Phase
10 — every admin document view, every contact read, every settlement — and the
only way to see one was the Supabase dashboard, itself an untraceable read. A
log nobody can open proves nothing.

- **`audit.viewed` is written on every open**, before the read rather than
  after: if the read fails the person still asked, and a log that recorded only
  successful looks is one somebody could probe by making it fail.
- **One level, never recursive.** `audit.viewed` is written by
  `recordLogAccess` and by nothing else, and reading an `audit.viewed` row
  writes nothing.
- **The filter is stored as evidence, as ids only.** "An admin opened the log"
  is nearly worthless; "an admin pulled this customer's whole trail" is the
  thing worth being able to answer later. A name or a searched string in
  `detail` would make this table a second, searchable copy of what it exists to
  protect.
- **`detail` is never rendered.** It is written by twenty-odd call sites and one
  plpgsql function; a screen printing whatever is in a jsonb blob leaks the
  first time somebody puts something careless in one. The screen shows the
  shape — who, what kind, which record, when.
- **`recordRiskAccess` now has callers**, having had none since it was written.
  `lib/data/lookup.ts` uses it where it fits exactly: one named customer, their
  no-shows and false addresses beside their phone number. The wasted-trip queue
  shows several customers' histories at once and therefore has no single
  subject, so it writes the same `customerRisk.viewed` kind through
  `recordSecurityEvent` with a **count** — naming one of the several would put
  a wrong id in a permanent record.

### The support lookup reads across everybody, and says so in the log

`/admin/lookup` resolves a booking reference, a payment reference or a phone
number to one booking and shows the customer, the professional, the address,
the history and the customer's risk record. **It widens nothing.** Every field
was already readable by an admin straight through PostgREST or the Supabase
dashboard, with no trace — the hole `lib/audit` names at its own top. What this
adds is the record.

- **`lookup.searched` is written on every search, including the ones that find
  nothing.** Six phone numbers tried in a row and none of them ours is a
  pattern worth being able to see later; a log that recorded only hits would
  hide exactly that.
- **`detail` carries the handle KIND, never the string typed.** A phone number
  in the audit log would make it a second copy of the thing it exists to
  protect — and one readable by every admin, which is a wider circle than the
  person who searched. Same rule as `recordContactAccess` carrying a count
  rather than the numbers.
- **`recordContactAccess` counts the numbers that reached the screen**, and the
  call sits inside `lookup()` before it returns, so a page cannot render them
  without it having run.
- **The address is read with the service role rather than by adding a policy.**
  `addresses` is admin-`none` in `docs/rls-matrix.md` and stays that way: an
  `Admins read every address` policy would have widened the untraceable
  PostgREST route to include everybody's home. Reading it inside a function
  that logs is the same trade `customerHistory` and `applicationForReview`
  already make.
- **The risk record is shown, never scored.** The numbers are what happened. A
  verdict computed on this screen would be a judgement about a person rendered
  beside their phone number, which is the shape of thing that gets acted on
  without anybody deciding to.

### Payment trust comes from the status check, never from a callback

A gateway returns the customer to us with an outcome in the URL, through a
browser we do not control. **Nothing in that URL decides anything.**
`readCallback` takes one field from it — the reference — and `verifyAndSettle`
then asks the gateway's own servers, passing **our** amount off our own row, and
refuses on a mismatch. The settle is guarded on the row's current status, so a
duplicate callback, a refresh and the reconciliation sweep can race and one
wins. The `payment=…` in the redirect is a hint for a heading; the booking page
re-reads the payment itself.

**So there is no inbound signature check, and that is the design rather than a
gap.** A constant-time comparer (`signaturesMatch`) sat exported in
`lib/payments/esewa.ts` for months, exercised only by its own tests, reading
exactly like a guard somebody forgot to wire. It is deleted. Verifying the
callback's signature would prove the payload came from eSewa and prove nothing
about whether the payment happened — a forged callback carrying a perfect
signature is exactly as powerless as one carrying none. The signature we do
compute is **outbound**, signing the form we post.

Anyone tempted to re-add it should change this section instead: the helper's
absence is load-bearing documentation.

### What a leaked backup would expose

Row-level security decides who may read a row **through the database**. It says
nothing about a dump, a replica, a support export or a stolen backup, and an
account number is worth exactly as much to somebody holding one of those.

So `payout_destinations.account_ref` is **sealed with AES-256-GCM**
(`lib/security/secret-box.ts`), key in `PAYOUT_ENCRYPTION_KEY`, held in Vercel
and never in the database. Envelope `v1.<iv>.<ciphertext>.<tag>`, carrying its
key version so a rotation can still open old rows, with a random IV per row —
identical ciphertexts would reveal which professionals share an account without
anybody decrypting anything.

**A missing key throws on write.** This is deliberately the opposite of the rule
the triage path follows: there, a missing `ANTHROPIC_API_KEY` must never reach
the customer as an error, because a keyword-matched answer beats none. Here the
equivalent "keep working" is storing somebody's bank account in the clear, which
is worse than a refused form and — unlike a refused form — invisible.

**The database refuses plaintext**, via
`payout_destinations_account_ref_sealed`. The application seals before writing,
and that is the intent; the constraint is what makes it true when a backfill
script, an admin tool or an MCP call bypasses the intent entirely. Proven as the
service role, the most privileged caller there is, because a constraint that
only stops a browser stops nothing on a service-role-only table.

**No plaintext tail column.** The mask is computed by decrypting server-side;
storing four digits of every account beside the ciphertext would put them in the
same backup the sealing exists to defeat.

**`account_name` and `bank_name` stay in the clear.** The number is the
credential; the name is already on the profile and the application, and sealing
it would mean a decrypt on every row before an admin could see whose account
they are looking at.

### The unkeyed digest beside it, and what fixing it broke

`application_match_keys.key_hash` was an **unkeyed SHA-256** of the normalised
value, under a comment reading "Never the value itself". That was true and not
sufficient: every value fed to it is a short string from a small space — a bank
account, a wallet number, a citizenship number, a referee's phone — so anybody
holding a backup enumerates the space and matches the digest in seconds, with no
key and nothing decrypted. Sealing `account_ref` while leaving that one table over
is a lock on one door of two.

`hashMatchKey` now delegates to `secretDigest` — **HMAC-SHA-256 under
`PAYOUT_ENCRYPTION_KEY`**, still 64 hex characters so the column's check holds,
and still exact-match equal for the same value, which is the one property
duplicate detection needs.

**It throws when the key is absent, and `sealApplication` turns that into a
refused submission.** Falling back to the unkeyed form would reintroduce the
enumerable digest on a product reporting itself healthy — the `no-api-key` lesson
where the cost is a duplicate check that has quietly stopped checking. The
digests are therefore computed **before** the upsert is attempted rather than
inside its argument, so the failure is reportable instead of thrown mid-call.

**Old rows no longer match, and that is a real gap with a measured size.** A
keyed digest of the same value is a different string, so the **10 existing rows
across 2 applications** (of 3, both of those already approved) are dead keys: a
new applicant sharing a bank account or citizenship number with one of them would
not be flagged. The values themselves are still on `provider_applications`, so
re-digesting is possible and is part of the same backfill that seals
`payout_account` — it has to run in Node with the key, because the key is
deliberately not in the database. Until it does, this is stated rather than
assumed away: nothing else in the product can tell a dead key from a value nobody
shares.

### The account number on an application

`provider_applications.payout_account` is the other place a number like this
lives. It is **not** a payable address — it is collected once at review and
nothing sends money to it — but a leaked backup does not care about that
distinction, and two real numbers sat in it in plaintext.

**Sealed on the way in, on the only path that writes it.** `saveStep` seals
before the update; a key failure refuses the step rather than storing the number
in the clear.

**The owner gets their own digits back. An admin does not.** The apply form uses
`payoutAccount` as a field's `defaultValue`, so somebody resuming a draft has to
see what they typed or the only way to fix one character is to retype all of them
— and they are the person who entered it. The reviewer's shape is
`payoutAccountMasked`, **renamed deliberately**: a field still called
`payoutAccount` while holding `••••4567` invites the next person to print it
expecting a number, or to "fix" the mask. `payoutIsSomebodyElses` answers the one
question the digits would be read for, as a boolean, computed from plaintext that
is discarded. There is no audited reveal here, because nothing pays this field;
`payout_destinations` is the payable address and that one has one.

**One function computes the match keys, and that is a correctness fix rather than
tidiness.** The envelope carries a random IV, so digesting the stored string
produces a different key on every submission — account-duplicate detection would
die with no failed write, no exception and no log line. Two callers were building
that shape (the submission and the conversion sweep): one list written twice with
a silent failure at the end of it. `applicationMatchKeys` takes the row **as
stored** and opens the account itself, so no argument exists that somebody could
pass an envelope to. The test for it did not bite until the two were collapsed —
it was covering `hashMatchKey` and the sweep, not the submission path.

**The conversion is done, and it was done in that order for a reason.** Two rows
held bare numbers and 10 match-key rows were dead; a constraint requiring an
envelope, added first, refuses the very UPDATE that converts them. So: widen the
bound, convert, then constrain. The conversion ran as a guarded one-shot
(`CRON_SECRET`, dry run unless `?armed=1`, idempotent because `isSealed` decided
per row rather than a flag somebody keeps correct), writing new keys **before**
removing old ones so no application was ever left with none. It had to be a URL
because the key is a Vercel variable — not a developer's machine, and not the
database, which deliberately does not hold it.

**Measured, not assumed.** The sweep reported `sealed: 2, removed: 10,
written: 12, remainingPlaintext: 0`, and the database was then read directly
rather than taken on the sweep's word: 2 of 2 envelopes at 61 characters, 0 not an
envelope, 12 keys across 2 applications, 0 malformed. The 12-against-10 difference
is the two `reference` keys those applications never had, because
`20260912000001` postdated them.

**`provider_applications_payout_account_sealed` is what makes it stay true.**
Proven by breaking it against production as the owner — the most privileged caller
there is, since every legitimate write here is service-role — with a bare
`9841234567` **and** a 46-character plaintext. That second case is the one the
`payout_destinations` test was originally passing on for the wrong reason, caught
by `char_length` rather than by the shape. Null is still accepted: most drafts have
not reached the payout step, and an unanswered question is not a plaintext account
number.

**The one-shot and the tolerance are gone.** The sweep, its route and the legacy
plaintext branch in `lib/data/payout-account.ts` were deleted in the commit that
added the constraint, which is what that route's own comment promised. The test
asserting the tolerance was **inverted rather than deleted**, so the record that
the shape was once accepted survives.

### The one table whose contents are somebody's bank account

`payout_destinations` holds where a professional is paid — an account number or
a wallet id. It is the only table in this product reached by **no browser at
all**: `anon` and `authenticated` are `revoke all`'d rather than filtered by a
policy, so the planner refuses before a row is considered.

**Deliberately no policy, including no `is_admin()` one.** A SELECT policy would
be a second path to the same rows over `/rest/v1` that writes no audit row, and
the audit is the point: every admin read goes through a separate function that
cannot be quietly skipped, the `recordDocumentAccess` idiom. The professional
sees their own destination **masked**, server-rendered — showing somebody their
own account number in full tells them nothing they do not know and puts it in a
response, a cache and a screenshot.

`tests/db/booking-rls.test.ts` normally fails a table with RLS and no policies,
because that is usually an oversight rather than a decision. This table is named
in `NO_BROWSER_ACCESS` there with its reason, the same "decide out loud" shape as
`PUBLIC_TO_ANON`. That case also now accepts a **refusal** as well as zero rows —
a revoked table throws where a filtered one returns nothing, and the refusal is
the stronger result. It matches `permission denied` specifically, so a typo in
the probe cannot read as a secure table.

**Retire, never edit.** `enforce_destination_immutability` refuses a change to
`kind`, `account_ref`, `account_name`, `bank_name`, `created_at` or
`usable_from` for **every caller including the service role** — no
`auth.uid() is null` bypass, unlike `enforce_booking_immutability`, because
every write here is service-role and a bypass would leave the trigger enforcing
nothing. It also refuses un-retiring a row (resurrecting a replaced address is
the takeover path with an extra step) and refuses overwriting a recorded
first-payout confirmation. A partial unique index keeps one live destination per
professional, refused by the database rather than remembered by the caller.

**`usable_from` is the 72-hour takeover window**, stamped at insert rather than
derived at payout time so the rule cannot be forgotten by a caller.

### What a professional may read about their own money

`providerMoney(providerId)` in `lib/data/payouts.ts` is the one read, and the
listing id comes from the session every time — `getMyProvider(profile.id)` on
`/provider/payouts` and `getProviderDashboard(profile.id)` on `/provider`. **No
provider id crosses the wire on either screen**, which is the shape all three
authorization holes found in this product had in common: an id arrived from a
browser and nothing asked whose it was. It reads through the service role like
every other money surface, so the RLS policies on `payouts` and `provider_ledger`
are a floor under it rather than the filter — the filter is the id from the session.

It returns **no account number**. The destination is masked by
`currentDestination` before it leaves its own data layer, and `revealDestination`
remains the only path in the product that returns digits, reachable only from
`/admin/payouts` and only with a recorded reason.

### The payout run, and what it cannot do

`public.payouts` grants **no insert or update to anybody** — the same posture as
`payments`, `survey_visit_fees` and `commission_appeals`. A professional and an
admin each read through RLS; every write goes through `lib/data/payouts.ts` under
the service role, so a row saying money was sent cannot be forged by the person
receiving it.

**The run can only ever create drafts, and that is structural rather than a
convention.** `payout_transition_allowed` refuses `draft -> sent` however it is
called, so no cron, no retry and no bug in the sweep can reach a rail. A person
approves, a person sends, a person records what came back.

**`enforce_payout_transition` freezes the figures past `draft`** — earnings,
commission, net, tax, and both period dates — for every caller including the
service role, with no `auth.uid() is null` bypass, because every write here is
service-role and a bypass would leave the trigger enforcing nothing. A payout that
can be edited after a person approved it is a payout nobody approved.

**The destination is re-checked at the approval and again at the send.** This is
the one hole the cooldown could not close on its own: a draft agreed against a
confirmed destination, then the address changed, which starts a fresh window on
the NEW row while nothing in the draft mentions an account. `destinationStillGood`
compares the live destination's id against the one frozen on the payout and asks
`destinationReadiness` again; an unreadable destination refuses too, because "we
could not check" must not pass as "we checked".

**`payouts.ledger_rows_at_draft` is a count, and it is sound only because
`provider_ledger_append_only` refuses UPDATE and DELETE for every caller.** The
ledger can change in exactly one way — by growing — so a different count means
rows arrived. `tests/db/payout-run.test.ts` asserts that trigger is still attached
rather than assuming it, because without it a row edited in place leaves the count
identical and an approval pays a figure the ledger no longer supports.

**At most one unresolved payout per professional**, through
`payouts_one_in_flight_idx` — unique on `(provider_id)` where the status is
`draft`, `approved` or `sent`. Without it two unresolved drafts describe the same
money: `net_rupees` is the whole position, so a week drafted at 2,500 that nobody
approves is drafted again the next Tuesday with an unchanged
`ledger_rows_at_draft`, and each send writes its own `payout` row — a ledger that
reconciles perfectly around a double payment. The cost is stated rather than
discovered: an unresolved payout stops the next week being drafted, which is
deliberate and loud, and the way out is a person approving it or failing it with a
reason. **A negative week therefore drafts nothing at all** — a payout row is an
instruction to pay and there is no such instruction; the ledger carries the balance
forward by construction, and the first version's held `negative` row would have
blocked every later week for somebody whose work is all cash.

**Two partial unique indexes make a double payment a database refusal.**
`provider_ledger_payout_once_idx` and `provider_ledger_payout_reversal_once_idx`
are unique on `(payout_id)` per kind — the `our_reference` idiom — so a retried
send, a double submit or two admins pressing at once produce one `payout` row. The
application's duplicate-tolerance is the optimisation; the index is the rule.

### Who may read an account number, and who may change one

`lib/data/payout-destinations.ts` is the only code that reads or writes that
table. Four functions, and the interesting thing about each is what it refuses.

**`currentDestination` never returns plaintext.** It opens the envelope, hands
the result straight to `maskAccountRef` and discards it inside a function whose
return type has no room for digits. It also distinguishes a **failed read** from
**nobody having set one up** — opposite sentences, and collapsing them asks a
professional to re-enter their bank account because of a database blip.

**`revealDestination` is the only path that hands back the number**, and it
writes `security_events` **before** it opens the envelope. Ordering, not error
handling: `recordSecurityEvent` never throws, so nothing could be conditional on
its success, and writing first means a call that dies halfway still left the
record that somebody asked. `recordDestinationAccess` is its own function beside
`recordDocumentAccess`, `recordRiskAccess` and `recordContactAccess` — a `kind`
passed to the general logger is one more argument a call site can forget, and
forgetting it here leaves no trace at all: the professional cannot tell anybody
looked, and somebody who wanted to has no reason to mention it. The log carries
the reason and the provider id, never the number — a log holding what it logs
access to is a second copy in a table designed to be kept for ever.
`security_events.kind` has no check constraint, so this kind needed no migration.

**`changeDestination` takes a `profileId` and resolves the listing itself.** It
never accepts a `providerId`. All three authorization holes found in this product
were the same shape — an id arrived from a browser and nothing asked whose it was
— and the id that would arrive here names the account somebody's earnings go to.

**Re-auth is read from the session token, never from the request — and from
`amr`, not `iat`.** `sessionAuthenticatedAt()` returns the newest `amr`
timestamp, which is when somebody last actually proved who they are.

**The first version read `iat` and was a live hole.** A Supabase access token is
refreshed silently, and each refresh mints a new token with a new `iat` — so for
any session that stays active the value is always minutes old. The gate read
"recently active", which is exactly the state a stolen session is in: the theft
satisfied the control standing in front of it. **A refreshed token passed with no
new code.** `amr` survives a refresh because it describes the session's
authentication events rather than the token carrying them.

The rule was already written down one function away: `mfaState` reads `amr` under
a comment saying the timestamp is "the moment of verification… not the session's
start, and not now". Same shape as `checkTriage` and `checkTriageFallback` —
correct reasoning in one function, the opposite behaviour twenty lines below it.
`authenticatedAt` in `lib/auth/step-up.ts` is the rule now, pure like every other
judgement in that file, so the case that matters — a token refreshed a minute ago
carrying an authentication from six hours ago — is tested without a session, a
browser, or an hour of waiting. Null is expired, never a guess.

**It refuses before it reads anything** when the session has not proved who it is
within `REAUTH_WINDOW_MINUTES` (15). A missing stamp is **expired**, not unknown
— `stepUpFor`'s rule for an absent `amr` claim, applied where guessing wrong
hands somebody's earnings to a stranger. Fifteen minutes rather than
`STEP_UP_HOURS`' eight: that window is long because admin work is batched and a
code every half hour teaches people to tap through approvals, where this happens
once a year and takes a minute. `stepUpFor` itself does not apply at all — it
returns `not-required` for anybody who is not an admin, and the person changing a
destination is a professional. **The OTP behind it cannot reach a real handset
today**; that is the existing `auth.sms` launch blocker, and it does not weaken
this refusal — with no stamp the change is refused, so the failure mode is
"cannot change", never "changed without proof".

**Sealing happens before any write.** `sealSecret` throws on a missing or
wrong-length key, so attempting it first means a key problem leaves the existing
destination live and untouched rather than retired with no replacement.

**The one ordering hazard is named rather than hidden.** The one-live partial
unique index refuses a second live row, so the order must be retire-then-insert,
and supabase-js has no transaction. If the insert fails there is no live
destination: recoverable by re-submitting, and the right direction to fail in —
money pausing beats money following a stale address. `changeDestination` returns
`retiredButNotReplaced` so the screen says that rather than "something went
wrong". If it ever bites, the fix is a `security definer` function doing both
statements in one transaction, not a rollback in TypeScript.

**The notice is written and, today, reaches nobody who is not signed in.**
`payout.destinationChanged` is a notification kind carrying both destinations
**masked** — a warning that an account changed must not be where the account is
printed. It is deliberately absent from `LIST_NOTES`: that allow-list feeds
`/bookings`, a customer's list of jobs, and this has `bookingId: null`. The line
a professional actually reads comes off `payout_destinations` on their own money
view. **When an SMS channel is written, this kind needs a rule of its own** and
getting it wrong warns the attacker: every other kind may look the recipient's
number up at delivery, and this one must deliver to the contact **as it stood
before the change**, because somebody who took an account over changed the phone
number too.

### A definer function is a second door onto the same rows

**Its grant is the only lock on it.** `provider_outstanding` and
`provider_balance` aggregate `provider_ledger`, whose policies scope reads
correctly — the owning professional, and admins. Both functions are
`security definer`, so they never consult those policies, and both carried
`execute` for `authenticated`: any signed-in customer could read any
professional's guarantee debt and net money position by naming their id.

Proven against production as `authenticated`, with a customer's own JWT claim
and somebody else's provider id — the call returned a row. Nothing was
disclosed, because `provider_ledger` is empty; the door being open is the
finding, not the traffic through it.

**Revoked from `authenticated` in `20260930000001`**, and it cost nothing: both
production callers already hold the service role
(`lib/data/provider-profile.ts`, `lib/data/claim-signals.ts`), so the grant
served no legitimate path. `tests/db/ledger-kinds.test.ts` asserts the refusal
as the caller experiences it, including for a professional asking about
themselves — nothing calls these from a browser, and a grant that exists for
nobody is one only an attacker can use.

So before adding a `security definer` function, the question is not "is the
policy right" but **"who may call it, and with whose id"**.
`tests/db/guard-clauses.test.ts` fails on a new definer function signed-in users
can reach with nothing naming the policy that needs it.

### RLS is a floor, not a filter

**A read for a screen that belongs to one person names that person in the
query.** Adding an `Admins read every X` policy silently widens every unscoped
read of X, because a Postgres policy is permissive: the new one ORs alongside
the owner's, and nothing fails.

This is the fourth hole of the family above and the first of its kind. The
other three were *an id arrived from the browser and nothing asked whose it
was*; here **no id arrived at all**. `listBookings()` selected from `bookings`
with no owner predicate and left the filtering to RLS, which was correct until
`"Admins read every booking"` was added for the admin queues. From that day an
admin opening the customer dashboard at `/bookings` saw every customer's jobs,
amounts and professional. Read-only — there is no admin UPDATE policy and every
write path re-checks `customer_id` — but it was the whole product's booking
history on a screen that is not the admin surface. It was found by a person
looking at it, months later.

Nine reads carried the same shape. They are scoped now, and two guards hold the
rule:

- `tests/unit/personal-reads.test.ts` records the filters each personal read
  applies against a recording client, so deleting an `.eq` goes red.
- `tests/db/open-jobs.test.ts` fixtures an admin who is *also* a linked
  professional — the account that made the open-job board leak — and asserts
  `open_job_ids()` gives them their own trade and ward and nothing more.

Where the filter is a function rather than a column, it is written once in SQL
and called by both the policy and the application: `open_job_ids()`, in
`20260925000001_open_job_ids.sql`. Two copies of a rule diverge, and the
divergence stays invisible until somebody is shown a job three wards away.

**Before leaving a read to RLS, ask which admin policy is on that table.**
`docs/rls-matrix.md` lists every one of them.

### And RLS is row-level, so a write policy is not a column policy

`profiles` had one update policy — `"Profiles are updatable by their owner"`,
`using ((select auth.uid()) = id)` — and Supabase grants `authenticated`
table-wide UPDATE on every table in `public` through a default privilege. Those
two together let the owner write **every column on their own row**, and there
was no trigger on the table. So:

    PATCH /rest/v1/profiles?id=eq.<self>   {"role":"admin"}

`using` and `with check` both passed, because `id` never changed. `is_admin()`
then returned true and the six policies behind it opened — every profile, every
booking, every payment, every triage log, and the identity documents in the
private bucket. From any signed-in customer's browser, with the anon key that
ships in the page.

It is the same class as `enforce_booking_immutability`, which this file and
CLAUDE.md both already record for `bookings`; nobody asked the question again
one table over. It was found while adding the activity-strip opt-out — the
product's first customer-facing write to `profiles`.

**The fix is a column grant, in `20260927000005_profiles_column_grants.sql`:**
UPDATE is revoked from `anon` and `authenticated` and granted back on
`full_name`, `preferred_language` and `hide_from_activity` — the three a browser
legitimately writes, in onboarding and on `/account`. `role`, `id`, `phone` and
`created_at` are unwritable from any session. `service_role` is untouched, which
is what keeps `lib/data/review.ts` able to promote an approved applicant.

A grant rather than a trigger, because a trigger on this table would need an
`auth.uid() is null` bypass for exactly that service-role write, and a bypass is
a thing that can be reached the wrong way. `tests/db/profile-escalation.test.ts`
executes the escalation as a signed-in customer rather than reading the catalog,
and asserts the three allowed writes still work — a revoke that took
`full_name` with it would have locked every new customer out of onboarding.

**The guard that could not see it.** `tests/support/postgres.ts` re-granted
table-wide privileges *after* applying the migrations, so any column grant a
migration made was erased before a test looked. It sets Supabase's default
privilege before the migrations instead, which is what the real database does.

**Proven against production, as `authenticated`.** Run in the Supabase SQL
editor inside `begin; set local role authenticated; set_config(
'request.jwt.claim.sub', …); … rollback;` — which is what PostgREST does per
request, so it exercises the same lock a `PATCH` would meet:

- `update public.profiles set role = 'admin' where id = <self>` →
  **`ERROR: 42501: permission denied for table profiles`**
- `update public.profiles set hide_from_activity = true where id = <self>` →
  one row, `true`. The allowed columns still work.

`42501` is `insufficient_privilege`, raised by the planner **before any row is
considered** — which is the property a column grant has and a trigger does not,
and the reason this is a grant. What it does not exercise is PostgREST's own
parsing or the gateway in front of it; the sandbox cannot reach
`*.supabase.co`, so the HTTP layer is asserted by the db suite and not by a live
request.

**AND THE ERROR CARRIES THE INSTRUCTION THAT REOPENS THE HOLE.** Postgres
appends, and the Supabase editor displays, this hint verbatim:

> HINT: Grant the required privileges to the current role with:
> `GRANT UPDATE ON public.profiles TO authenticated;`

That is precisely the statement whose removal closed the escalation — it is the
break-test from the migration's own commit, offered as advice by the tooling.
Anybody debugging a permission error on this table, in a hurry, will be told by
the database to undo the fix, and it will work. `tests/db/profile-escalation.test.ts`
turns red the moment it is run, and `write-grants.test.ts` a second time — but
neither is what somebody reads at 2am with a red panel in front of them, so it
is written here: **on `profiles`, that hint is wrong. Grant the column, never
the table.**

**The sweep that followed found no second hole**, and `tests/db/write-grants.test.ts`
is what stops a seventh arriving unseen. The grant is not the discriminator — every
table in `public` carries table-wide INSERT and UPDATE for `anon` and
`authenticated` through a Supabase default privilege, so listing tables that have
it lists all of them. The POLICY is what decides, and after
`20260928000001` dropped the unused `notifications` policy, exactly five tables
grant a browser role a write:

| table | verbs | what makes it safe |
| --- | --- | --- |
| `addresses` | INSERT, UPDATE | `profile_id = auth.uid()` in `using` **and** `with check` |
| `bookings` | INSERT, UPDATE | `enforce_booking_immutability`; `enforce_booking_transition` pins an INSERT to `pending` and `freeze_booking_band` writes the floor server-side |
| `profiles` | UPDATE | the column grant above |
| `provider_applications` | INSERT, UPDATE | `enforce_application_immutability` — `status`, `risk_score`, `submitted_at` and a change of hands |
| `provider_leads` | INSERT | open on purpose: somebody not signed in must be able to ask to join, and a lead confers nothing until a person acts on it |

`notifications` was a sixth and is gone: its policy granted UPDATE on all seven
columns of a person's own rows and **nothing used it** — `markBookingRead` writes
`read_at` under the service role, and `lib/notify/in-app.ts` inserts the same way.
Own rows only, so no privilege crossed to anybody; a write surface nothing needs
is simply one nobody is watching.

The test names the **guard** on each rather than just permitting the table, because
a list of names still passes the day a trigger is dropped. The list lives in
`tests/support/write-allowlist.ts` and is read by both `write-grants.test.ts` and
`rls-matrix.test.ts`, which held separate copies of it for exactly one commit. It
also pins that no browser role holds DELETE anywhere — true across all 37 tables, never explicitly
decided, and the first one should be an argument somebody makes rather than a line
that slips in.

### A role change writes its own audit row, and until now it wrote none

`lib/data/review.ts` promoted an approved applicant with a bare
`update({ role: 'provider' })` and logged only on failure. So the live audit log
holds two `role.changed` rows and **both say `customer`** — they are written by
`handle_new_user` at provisioning. The two elevations that actually produced the
provider and the admin account left nothing behind, and neither did an admin
being demoted back to customer. Nothing suggests those were anything but the
owner's own SQL; the point is that **the log cannot say so**, and an absent
record read as a clean one is the same mistake as a default read as a
measurement.

**The record is a trigger, not a call in the application.**
`profiles_record_role_change` (`20260928000001`) fires on any change to
`profiles.role` and inserts the event **in the same transaction** — so no record
means no change. That is the opposite of `lib/audit`, which never throws because
the thing it logs has already happened; here the privilege has *not* been granted
yet, and one granted without a trace is the failure this exists to prevent. An
application-side call would also have missed exactly the paths that went
unrecorded: a dashboard query, an MCP call, a future admin tool.

**`via` says what the database can prove.** `current_setting('role')` gives the
caller's effective role — `service-role` is our own server, `direct-sql` is a
dashboard or MCP session, `session` is a browser. `current_user` is no use inside
a `security definer` function, where it is always the owner.

**`public.set_profile_role` is how a path names itself**: two transaction-local
settings the trigger reads, so the approval's row carries
`via: 'application.approved'` and the deciding admin's id rather than just
"our server did it". It is **`security invoker`**, so it can never become a way to
*obtain* a role — the caller's own privileges apply, and the column grant gives
`authenticated` three columns that do not include `role` — with execute revoked
from `public`, `anon` and `authenticated` on top of that.

**The three historical transitions are not backfilled.** Inventing rows for
changes nobody witnessed would manufacture exactly the clean record this change
exists to stop. The gap stands; the log is trustworthy from here.

---

## 2. Data inventory

What we hold, why, who can read it, how long.

| Data | Where | Why | Who can read it | Retention |
| --- | --- | --- | --- | --- |
| Phone number | `profiles.phone`, `auth.users` | it is the login, and how a professional is reached | the person; an assigned professional during a live job; admins | life of the account |
| Full name | `profiles.full_name` | so a professional knows who they are meeting | as above | life of the account |
| **Home address** | `addresses` | the job happens there | the owner; the assigned professional while the job is live; admins | life of the account — **see the gap below** |
| Problem description | `bookings.description` | it is the job | customer, assigned professional, admins | life of the booking |
| **Photo of the problem** | `booking-photos` bucket (private) | the professional needs to see it | the customer; the assigned professional while `accepted`/`en_route`/`in_progress`; admins | life of the booking — **EXIF stripped on upload** |
| Triage text and photo | `triage_logs` (text only) | to tell whether the bands are right, and whether the triage was | admins | photo is **never stored**; `/admin/triage-accuracy` reads this table as counts only and never renders a row |
| Payment records | `payments`, `refunds` | money moved | the two parties, admins | financial retention, not yet set |
| Provider phone | `provider_contacts` | the customer must be able to call | the customer during a live job; admins | life of the listing |
| Provider lead | `provider_leads` | somebody asked to join | admins | until onboarded or dropped |
| Why a job was turned down | `booking_refusals.reason`, `.reason_code` | so a refusal can be read and counted | the professional, admins | life of the booking — a **stated preference**, never a judgement, and not a ranking input |
| **Identity documents** | `provider-documents` bucket (private) | verification | the owner and admins only, every read logged | `delete_after` column exists; policy not yet set |
| Security events | `security_events` | dispute evidence, breach forensics | admins | append-only; no retention rule yet |

### Minimisation — what we deliberately do not keep

- **The triage photo is never stored.** It is looked at and discarded.
- **EXIF comes off every booking photo.** A photograph taken in a kitchen
  carries that kitchen's GPS coordinates.
- **No email, no password.** Phone and OTP only, so there is no password
  database to leak and no reused password to test elsewhere.
- **No card details, ever.** eSewa and Khalti hold them; we hold a reference.

---

## 3. The admin model

Six admin screens now exist — `/admin/applications`, `/admin/claims`,
`/admin/guarantee-claims`, `/admin/survey-fees`, `/admin/appeals` and
`/admin/mismatches`, each listed above, reachable from the `/admin` index and
framed by their own `(admin)` layout. The rules below were written before any
of them and every one of them holds today:

1. **Role in the database, not in a token.** `profiles.role` and `is_admin()`,
   which six policies already call. A role claim in a JWT is a role claim the
   holder of that JWT keeps until it expires.
2. **Separately authenticated.** An admin signs in as an admin, not by their
   customer account acquiring a flag. Same phone, a distinct session, and a
   shorter one. `/admin/login` is that door — the only public path underneath
   `/admin`, carved out by `PUBLIC_EXCEPTIONS` in `lib/auth/routes.ts`. It
   fixes `next` to `/admin` rather than reading `?next=`, so it has no
   open-redirect surface to validate at all.
2a. **There is no admin sign-up, and there will not be one.** Admin accounts
   are provisioned — an existing admin, or the service role — never
   self-registered. A page anybody can reach that mints admin accounts is a
   public door to every customer phone number and every identity document in
   the product. This was asked for as a convenience and refused; so was
   replacing phone+TOTP with a username and password, which trades something
   you hold for a reusable secret that leaks from other people's breaches.
   The friction that prompted both was neither: it was `stepUpFor` returning
   `enrol` for an admin who had not yet set up an authenticator, which bounces
   every visit to `/account/security` until they do.
3. **Every action logged and attributable.** `security_events` with
   `actor_role = 'admin'` and the subject. There is no "system did it" for a
   thing a person did.
4. **Reading a document is an action.** `recordDocumentAccess` is a separate
   function precisely so it cannot be quietly skipped: a professional cannot
   tell that an admin opened their citizenship certificate, and an admin who
   wanted to would have no reason to mention it.
   **So is reading a phone number, and that took longer to notice.**
   `recordContactAccess` writes `contact.viewed` from `applicationForReview` —
   the only path in the product that puts a number in front of a reviewer, and
   it puts up to four there at once: the applicant's own, and their
   references', who never signed up for anything and cannot see that we hold
   their number. A phone number is the login here, so it is the one piece of
   personal data held about everybody. It records the COUNT and never the
   numbers: a log holding what it logs access to is a second copy of that data,
   in a table designed to be kept for ever.
   **What it does not cover, plainly:** the policies "Admins can read every
   profile" and "Admins read every contact" still allow a read straight
   through PostgREST or the Supabase dashboard with no trace. Narrowing those
   two is a schema change and a separate decision.
5. **No bulk export in the product.** Anything that dumps addresses or phone
   numbers is a deliberate, logged, out-of-band operation — not a button.
6. **Admins are the largest single risk here** and the model says so out loud.
   Everything above is written to make an admin's actions visible to another
   admin, not to make them impossible.
7. **An admin needs a second factor, and the product enforces it.** Phone plus
   OTP is the only way in for everybody, which means an admin account — one
   that reaches every customer's phone number, every professional's private
   number and every identity document, all named table by table in
   `docs/rls-matrix.md` — sat behind a single SMS code. An SMS code is the
   factor most easily taken from somebody: a SIM swap costs a conversation at
   a counter. `lib/auth/mfa.ts` is the one file that talks to Supabase MFA,
   `lib/auth/step-up.ts` is the rule, and `lib/auth/admin-gate.ts` is the one
   place six pages and eight actions ask. Customers and professionals are not
   asked for one: their account holds their own bookings and their own address,
   and a TOTP code to look at your own tap repair is theatre charged to the
   wrong person.

### Losing the authenticator — the recovery path, and it is the last resort

`supabase.auth.mfa.unenroll()` needs the locked-out person's own session, so it
cannot help somebody who is locked out. There are no recovery codes: the
`auth.mfa_recovery_codes` table exists in the schema but the installed
supabase-js exposes no method that issues or redeems one.

So recovery is a service-role delete of the factor, run by somebody with
database access:

```sql
-- Find the account, then remove its factor. The person can then sign in with
-- the phone OTP alone and enrol again from /account/security.
delete from auth.mfa_factors
 where user_id = (select id from public.profiles where phone = '<their number>');
```

**Two enrolled admins on two devices is the real redundancy, and the reason
that is the arrangement rather than this query.** Anybody who can run the
statement above can also read every table it protects, so treating it as the
plan rather than the emergency would make the second factor decorative.
Removing a factor is not written to `security_events` by the application —
nothing in the product performs it — so the audit trail for a recovery is the
database's own logs and whoever asked for it.

### `rebandBookings` — the one admin sweep that edits customer bookings

`lib/data/bookings.ts`. Service role, admin-only, and it exists because a
sub-band rule can be found wrong after bookings have already been filed under
it — three of the first five were. It clears `band_slug` and `band_source` on
every booking of one product in a time window, and `sync_booking_duration`
nulls the length estimate along with them.

- **It only clears, never writes a new value.** The customer's own description
  is still on the booking, so re-deriving a product from it is possible — and
  would produce today's guess wearing the appearance of a correction. A null
  says plainly that nobody knows.
- **It touches no money and no state.** `band_slug` and the duration columns
  are scheduling facts; the quote, the final amount and the payment state are
  refused to this path as they are to every other.
- **`band_source` is a browser-supplied hint**, so a sweep that has to be
  certain omits it and clears by product and window alone. Over-clearing costs
  a scheduling estimate; under-clearing leaves a wrong one in the evidence the
  researched durations will be built from.
- **Every run is written to `security_events` as `admin.action`, including runs
  that clear nothing** — "somebody swept and found none" and "nobody swept" are
  different facts and only one means the wrong bands are still out there.

### Break-glass — getting back in when the SMS never arrives

Phone OTP is the only way into this product. That is a deliberate simplicity
and it has one consequence nobody should have to discover during an incident:
**the platform owner is one undelivered message away from being locked out of
their own admin account**, and the fix for a locked-out admin normally requires
being signed in as an admin.

The break-glass is `public.provisioned_accounts` plus a Supabase test number,
and it is built so that **no step depends on a message being delivered**.

1. **The grant is a row, not an UPDATE.** `provisioned_accounts` maps a phone
   number to a role, and `handle_new_user` applies it at signup. Adding a row
   makes that number an admin the moment it signs in, today or in a month.
   The role no longer has to be set by hand against production after the fact,
   which was both manual work and the wrong shape of mistake to invite.
2. **The code does not travel.** Supabase → Authentication → Providers → Phone
   holds a fixed six-digit code per test number, checked by Supabase itself.
   Sign-in with a test number never reaches a gateway, so an admin can get in
   while the SMS provider is entirely dead — which is the state this product
   has actually been in, for a day, undetected.
3. **The break-glass number is not a real SIM, and that is the point.** A test
   entry on a number means that number can never receive a real code again,
   because Supabase answers it itself and never calls the gateway. So the
   break-glass admin is a number nobody carries, and the owner's real number is
   deliberately kept **off** the test list — otherwise the owner loses their
   ordinary way in, and any delivery test run against that number proves
   nothing because no message was ever sent.
4. **Three admin numbers, never one.** A single admin account is a single point
   of failure whether the cause is a dead gateway, a lost SIM or a mistyped
   role. Two work with no gateway at all; one works the day a gateway does.
   All are listed in `provisioned_accounts` with a label.
5. **Recovering from zero admins needs only the service role** — the Supabase
   dashboard, or this repository's MCP connection. Insert a row, add the test
   number, sign in. No support ticket, no vendor.

The trade is explicit: **a fixed code on a live admin number is a password that
never rotates.** So the arrangement is bounded rather than permanent —
`scripts/provision-accounts.sql` carries the roster (never the codes), every
application of a grant is written to the append-only `security_events`, and the
whole thing is a launch blocker (`test-account-otps`) that must be resolved
before real customers exist. Until then the risk is one unshipped product;
after real users it would be an unrotatable admin credential, which is a
different thing entirely.

`provisioned_accounts` grants **no insert or update to anybody** through RLS —
the same rule as `payments` — so it can never become a self-service admin
button. `tests/db/provisioned-accounts.test.ts` proves both directions against
real Postgres: the grant lands at signup, and an ordinary signed-in user can
neither write a grant nor repoint an existing one.

---

## 4. What this phase did not fix

Listed rather than implied.

- ~~OTP requests are not rate-limited by us.~~ **Fixed.** The send and the
  verify moved behind server actions; `otp:number`, `otp:ip` and `otp:attempt`
  now run on our side, keys are hashed, and no response distinguishes a
  registered number from an unregistered one.
- **No retention job is armed.** `lib/retention/policy.ts` holds the proposed
  durations and `GET /api/retention/sweep` reports what they would touch.
  `RETENTION_ENABLED` is unset, so it deletes nothing — deliberately, until the
  numbers are approved. `security_events` is excluded by design: it is
  append-only and expiring it is a deliberate migration.
- **The shared rate-limit store is unconfigured.** Without
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` the counters are
  per-instance. `/api/health` reports which is in force rather than leaving it
  to be assumed.
- **`script-src` keeps `'unsafe-inline'`.** Three inline scripts need it and
  the fix is a per-request nonce from middleware; see the note in
  `next.config.mjs` for why that is not a five-minute change here.
- **Next 14 has two high-severity advisories.** Filed as
  `next-14-advisories`; the fix is a major upgrade.
- **No retention policy is enforced anywhere.** The columns exist
  (`delete_after`); nothing deletes yet. Addresses in particular are kept for
  the life of the account with no rule saying they should be.
- **Server actions are not individually rate-limited.** Only booking creation,
  triage and the join form are. Next's own protections cover origin, not
  volume.
