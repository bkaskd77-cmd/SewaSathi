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
| `recordAmountAction` | the assigned professional | the final amount on their job | `recordFinalAmount` re-reads; band clamp; ceiling; `security_events` |
| `appealCommissionAction` | the professional who did the job | one appeal on that booking | `openCommissionAppeal` re-reads and refuses an appeal against a floor never applied |
| `setAvailabilityAction` | any professional with a listing | the `available_until` stamp on their own listing | listing resolved from the session; the expiry is computed server-side by `availableUntil`, never passed in |
| `setRateAction` | any professional with a listing | `base_rate` and `base_rate_requested` on their own listing | listing resolved from the session; `clampRate` against the published band for their trades |
| `acceptClaimAction` / `releaseClaimAction` | the professional a claim names | taking or giving back one return visit | provider id from the session; `acceptClaim` re-reads the claim; the claim transition trigger |
| `recordVerdictAction` | the professional who attended | the verdict on one claim | verdict validated against `CLAIM_VERDICTS` here and by the column check; `resolved` is reachable only from `attended` |

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
| `decideApplicationAction` | admins | one provider application | role re-read in the action; document reads logged separately by `recordDocumentAccess`, and the applicant's and referees' phone numbers by `recordContactAccess` on every load of the review screen |

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
| `GET /api/health` | anybody | nothing; reports state, sends no data | `?deep=1` needs `CRON_SECRET`. `db.functions` reads `function_fingerprints()` under the service role and reports hashes and names only — no function bodies leave the database, and the RPC is revoked from `anon` and `authenticated` |
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
| Triage text and photo | `triage_logs` (text only) | to tell whether the bands are right | admins | photo is **never stored** |
| Payment records | `payments`, `refunds` | money moved | the two parties, admins | financial retention, not yet set |
| Provider phone | `provider_contacts` | the customer must be able to call | the customer during a live job; admins | life of the listing |
| Provider lead | `provider_leads` | somebody asked to join | admins | until onboarded or dropped |
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

Four admin screens now exist — `/admin/applications`, `/admin/claims`,
`/admin/survey-fees` and `/admin/appeals`, each listed above. The rules below
were written before any of them and every one of them holds today:

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
