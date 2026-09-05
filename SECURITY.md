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

### Provider surfaces

| Endpoint | Who may call it | What it may act on | Enforced by |
| --- | --- | --- | --- |
| `advanceJobAction` | the assigned professional | one booking assigned to them | `getMyProvider` from session; RLS read; `canTransition`; status trigger |
| `declineJobAction` | the assigned professional | releasing that one booking | RLS read proves ownership, then a server write (an UPDATE may not make a row invisible to its writer) |
| `claimJobAction` | any professional who covers it | one open, unassigned booking | the claim policy's `using` clause settles the race; refusals excluded |
| `recordAmountAction` | the assigned professional | the final amount on their job | `recordFinalAmount` re-reads; band clamp; ceiling; `security_events` |
| `appealCommissionAction` | the professional who did the job | one appeal on that booking | `openCommissionAppeal` re-reads and refuses an appeal against a floor never applied |

### Public and machine surfaces

| Endpoint | Who may call it | What it may act on | Enforced by |
| --- | --- | --- | --- |
| `joinAction` | anybody | inserts one provider lead | the only anon write in the product; `join` rate limit by IP |
| `signOutAction` | anybody signed in | their own session | Supabase cookie; writes `auth.signedOut` |
| `POST /api/triage` | anybody | nothing — it reads and answers | `triage` rate limit by user or IP; no writes but a log row |
| `GET /api/health` | anybody | nothing; reports state, sends no data | `?deep=1` needs `CRON_SECRET` |
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

## 3. The admin model — defined before it is built

No admin UI exists. When it does:

1. **Role in the database, not in a token.** `profiles.role` and `is_admin()`,
   which six policies already call. A role claim in a JWT is a role claim the
   holder of that JWT keeps until it expires.
2. **Separately authenticated.** An admin signs in as an admin, not by their
   customer account acquiring a flag. Same phone, a distinct session, and a
   shorter one.
3. **Every action logged and attributable.** `security_events` with
   `actor_role = 'admin'` and the subject. There is no "system did it" for a
   thing a person did.
4. **Reading a document is an action.** `recordDocumentAccess` is a separate
   function precisely so it cannot be quietly skipped: a professional cannot
   tell that an admin opened their citizenship certificate, and an admin who
   wanted to would have no reason to mention it.
5. **No bulk export in the product.** Anything that dumps addresses or phone
   numbers is a deliberate, logged, out-of-band operation — not a button.
6. **Admins are the largest single risk here** and the model says so out loud.
   Everything above is written to make an admin's actions visible to another
   admin, not to make them impossible.

---

## 4. What this phase did not fix

Listed rather than implied.

- **OTP requests are not rate-limited by us.** `lib/auth/otp.ts` is a client
  module: the browser calls Supabase directly, so only Supabase's own limits
  apply. Ours would need the send moved behind a server action, which is a
  change to the only door into the product, and it should be made deliberately
  and after the SMS gateway is verified (`sms-gateway-unverified`). The limits
  are already written and named — `otp:number`, `otp:ip`, `otp:attempt` — so
  wiring them is the small half.
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
