# Architecture

The map. Update it in the commit that changes the shape, not afterwards.

The risk this document exists to manage is **shared surface, not file count**.
Every bug that has cost us a rebuild lived in code that many things depend on:
`cn()`'s tailwind-merge config, `MotionProvider` in the root layout, the route
transition in `template.tsx`, the canonical URL on the locale layout, the
Devanagari font on `:root`. Five bugs, five shared files, none caused by the
repo being large. So the containment strategy is: keep the shared list short,
name it, and make everything else private behind a public entry.

---

## Modules

A module is a folder with one public entry. Everything outside it imports from
that entry and nothing else — enforced by `no-restricted-imports` in
`.eslintrc.json`, not by discipline.

| Module | Public entry | Owns |
| --- | --- | --- |
| **booking** | `@/lib/booking` | Status machine, working hours and slots, flow draft persistence |
| **payments** | `@/lib/payments` (server)<br>`@/lib/payments/client` (isomorphic) | Payment status machine, the price-integrity rules, the commission split, the gateway registry, callback reading |
| **notify** | `@/lib/notify` (server) | The channel contract and registry. In-app today; SMS and push are Phase 13 and are one file each. |
| **auth** | `@/lib/auth` (isomorphic)<br>`@/lib/auth/session` (server)<br>`@/lib/auth/otp` (client) | Route rules, redirect safety, phone parsing, session reads, the SMS adapter |
| **triage** | `@/lib/ai/*` | Prompt, schema, price clamp, safety floor, keyword fallback |
| **data** | `@/lib/data/*` | Every read of Supabase, plus the seed fallback |
| **content** | `@/lib/content/*` | Legal and information prose, both languages |
| **config** | `@/lib/config/*` | Categories, areas, brand strings, the guarantee windows |

`auth` has three entries rather than one and the split is forced, not
stylistic: `session.ts` imports `server-only` and `otp.ts` is `"use client"`.
One combined entry would drag `server-only` into the client bundle the moment a
form imported a phone formatter.

`payments` splits for the same kind of reason and it was found the same way —
by the build failing. Its registry reaches every adapter and eSewa's signs its
form with `node:crypto`, so a Client Component importing `@/lib/payments` dies
on an unhandled `node:` scheme. `@/lib/payments/client` re-exports only the
pure half — method names, the price rules, the customer-facing error list —
and `@/lib/payments` is marked `server-only` so the failure can never be quiet
again. What may go in the client entry: pure tables and pure judgements with no
Node builtin anywhere in their import graph. The price rules are there so the
screen can explain why a figure needs approving; they are never the
enforcement.

**Not yet modularised:** `triage`, `data`, `content` and `config` are still
imported by their internal paths. `booking` and `auth` went first because they
are the newest and the least depended on, which made them a safe place to prove
the rule. Extending it is mechanical; do it against a green suite.

`lib/data/recommendations.ts` is pure, like `ranking.ts`: it decides which
professionals a customer is offered after a refusal, and the widening from
ward to city to anywhere is a product rule that has to be testable without a
database. The read that feeds it is `listAlternatives` in
`lib/data/providers.ts`.

### Why `data` is shared rather than split per feature

`lib/data/{providers,categories,ranking}` is read by services, booking *and*
triage. Splitting it into feature-owned copies would either duplicate the
ranking weights — a product decision that must exist once — or produce a
`shared/` module that everything imports, which is the same surface with a new
name. It stays shared, and it stays on the shared-code list below.

---

## Shared surfaces — the higher bar

Changing any of these requires stating, in the phase summary, **what depends on
it and what you checked**. Feature code is cheap to change; these are not.

| Surface | Who depends on it | The bug it has already caused |
| --- | --- | --- |
| `lib/utils/cn.ts` | Every component | tailwind-merge dropped real colours after a new type-scale step was added and not registered |
| `app/[locale]/layout.tsx` | Every page | A canonical URL set here was inherited by every page, so `/services` claimed the homepage |
| `app/**/template.tsx` | Every route in the group | An entrance from `opacity: 0` gave `/login` no first-contentful-paint at all |
| `styles/globals.css` | Every page | `:root[lang="ne"]` styled `<html>` only, so `body`'s own `font-sans` won and `/ne` stopped loading Devanagari |
| `middleware.ts` | Every request | Auth cookies must be copied onto whichever response is returned, or a language switch drops the session |
| `lib/seo.ts` | Every page's metadata | Next *replaces* `openGraph` rather than merging, so a per-page `og:url` silently dropped `og:locale` |
| `lib/supabase/{client,server}.ts` | All data access | Importing the client one into anything the header renders puts ~70 kB of supabase-js on the landing page |
| `lib/ai/safety.ts` | Triage on the server, the cache, and the browser fallback | Matched the noun `गन्ध` but not the verb `गन्हाउनु`, so a Nepali speaker describing a gas leak got the calm path. Bare `करेन्ट` also fired on "करेन्ट आएको छैन" — the power being out. Rebuilt around stems; corpus in `tests/unit/hazard-corpus.test.ts` |
| `lib/auth/routes.ts` | Middleware and every auth page | `safeRedirect` accepted `/\evil.example`, which a browser reads as a jump to another origin |
| `i18n/routing.ts`, `i18n/navigation.ts` | Every link and redirect | — |
| Design tokens in `styles/globals.css` | Every component | — |

---

## External dependencies — one adapter each

Every external service is reached through exactly one file with a typed
interface. Swapping a provider is then one file, not a hunt.

| Service | Adapter | Notes |
| --- | --- | --- |
| SMS / OTP | `lib/auth/otp.ts` | Supabase Auth phone OTP today. Sparrow or Aakash means reimplementing `sendOtp`/`verifyOtp` behind the same signatures. Deliberately not re-exported from `@/lib/auth`, so a second call site cannot appear by accident. |
| Claude | `lib/ai/client.ts` | Model, timeout and token budget live here. |
| Supabase (data) | `lib/supabase/{client,server}.ts` | The only files constructing a client. |
| Supabase (storage) | `lib/data/booking-photos.ts` | Private bucket, signed URLs. The only file that touches `storage`. |
| eSewa | `lib/payments/esewa.ts` | ePay v2. Signed form POST; the signature covers `total_amount,transaction_uuid,product_code` in that order. Refunds are dashboard-only, so `refund()` returns `manualRefundRequired` rather than pretending. |
| Khalti | `lib/payments/khalti.ts` | KPG-2. Server-side initiate returns a `payment_url` and a `pidx`. Amounts are in **paisa**; the ×100 lives here and nowhere else. |
| Cash | `lib/payments/cash.ts` | Not a degraded path — the common one. `isConfigured()` is always true, so the customer is never left with no way to pay, and `verify()` never self-settles: the customer confirming is the only oracle. |
| In-app notifications | `lib/notify/in-app.ts` | A row in `notifications`, written under the service role. Always configured — there is no key to be missing, so something is always recorded. |
| SMS / push notifications | *not built* | Phase 13. One file implementing `NotificationChannel` plus a line in `lib/notify/index.ts`; nothing that decides *what* to notify about changes. |
| Maps | *not built* | `addresses.lat/lng` exist and are unwritten. |

---

## Seams

Where a change on one side cannot reach the other.

- **The database is the authority on who may read what and which status may
  follow which.** RLS policies and the transition trigger are enforced in
  Postgres, so no code path — including one nobody has written yet — can go
  around them. `lib/booking/status.ts` holds the same transition table for the
  interface; `npm run check:transitions` fails the build if the two disagree.
- **`TriageResult` is the contract** between the model, the fallback matcher
  and the card. Everything behind it can be rebuilt as long as that shape and
  the ten category slugs hold.
- **`lib/data/` is the only thing that talks to Supabase.** Pages never do.
- **Two Supabase clients, and the split is about caching as much as identity.**
  `lib/supabase/server.ts` reads cookies and acts as the signed-in person;
  `lib/supabase/public.ts` has no cookies and serves the catalogue. Touching
  `cookies()` makes a route dynamic for ever, so the public directory — the
  same answer for every visitor — was being rendered from scratch on every
  request. Data that depends on who is asking must never move to the public
  client: there is no who.
- **The serverless region and the database region are one decision.**
  Functions are pinned to `sin1` in `vercel.json` because Supabase is in
  `ap-southeast-1`; they were 250ms apart and a page makes a dozen queries.
  `npm run check:timing` is what proves it, from a machine that can reach the
  site.
- **A callback is a claim, never evidence.** `PaymentGateway.verify()` is the
  only thing that may conclude a payment succeeded, and it reaches the
  gateway's own servers to do it. `lib/payments/callback.ts` extracts an
  identifier from a return URL and decides nothing. RLS grants **no** insert or
  update on `payments` to anybody, so every write goes through
  `lib/data/payments.ts` under the service role, after it has re-read the
  booking and reconciled the gateway's figure against ours.
- **Function privileges are part of the schema, not a dashboard setting.**
  `20260903000001_harden_functions.sql` pins every function's `search_path` to
  empty and revokes `execute` from `public` on the trigger functions.
  `is_admin()` is the deliberate exception — six RLS policies call it and
  policy expressions run with the caller's privileges, so it keeps `execute`
  for `authenticated`. Supabase's Security Advisor asks for it anyway; the
  answer is no, and the test that would fail is in the db suite.
- **The motive is removed rather than the report policed.** The platform fee is
  charged on `max(final_amount, quoted_min)` (`settleSplit`), so under-reporting
  a cash job earns nothing. The honest exceptions are handled at two different
  scales and must never be confused: `commission_appeals` per job, decided by a
  person, and `category_pricing_signals` per category — a band that jobs keep
  landing under is our price being wrong, not our professionals.
- **For cash, the customer is the witness.** `blindCashEntry` decides when the
  screen hides the professional's figure; `confirmCashPayment` compares the two
  server-side and settles nothing when they disagree. Both figures survive on
  the booking, which is what a dispute is read from later.
- **Every payout lever lives in `lib/payments/payout.ts`**, differentials at
  zero until chosen. `payout_due_at` is frozen at settlement rather than
  recomputed, so changing a hold time never moves a date somebody was already
  given.
- **An UPDATE may not make a row invisible to the person making it.** Postgres
  applies a table's SELECT policies to the *new* row on UPDATE, on top of the
  update policy's own `with check`. So a professional cannot write their own
  release: the moment `provider_id` is null the booking stops matching
  "Providers read their assigned bookings" and the write is refused whatever
  the update policy says — proved by adding one with `with check (true)` and
  watching it fail identically. `declineJob` therefore proves ownership with an
  RLS **read** and writes the release under the service role. Any future "hand
  this back" path has the same shape.
- **A refusal is a row, not a status.** `booking_refusals` holds one
  professional saying no to one job, written by a trigger so every release path
  records it. Three things read it and all three would be wrong without it: the
  open-job policy (never re-offer a job to whoever refused it), the customer's
  replacement suggestions (never lead with them), and
  `enforce_booking_immutability`, which refuses an assignment back to them from
  any caller. `provider_stats.withdrawals` / `.declines` are the same fact
  counted for ranking; `booking_status_history` remains the narrative.
- **A notification carries a key, not a sentence.** `kind` is a message-catalogue
  key and `params` are its placeholders, so every channel renders in the
  *reader's* language at delivery. A sentence baked in English at write time
  can never be read back in Nepali — and the reader's language can change
  between the event and the reading.
- **The realtime page assumes the socket dies.** `useBookingChannel` re-reads
  the row on subscribe, on every re-subscribe, when the tab becomes visible and
  when the browser reports the network is back. A missed transition is the
  failure that matters, and a phone in a pocket loses its socket without an
  event. The Supabase client is imported inside the effect, so the page paints,
  reads and works on a connection that never finishes fetching it — and so
  ~70 kB stays out of the route's first load.
- **A professional's phone is not on `providers`.** That table is world-readable
  — it is the public directory. The number lives on `provider_contacts`, behind
  a policy that releases it only while a job of theirs is accepted, on the way
  or under way. The window closing again at `completed` is asserted in the db
  suite, because it is the half nobody would notice was missing.
- **Every dependency this product has lives in somebody else's dashboard.**
  A Supabase auth toggle, a Twilio credential, a Vercel environment variable —
  none of them are in this repository, none are covered by `npm run verify`,
  and any of them can be changed by a person who is not looking at this code.
  `GET /api/health` is the one URL that answers "can this serve a customer
  right now"; `?deep=1` (behind `CRON_SECRET`) additionally sends a real OTP,
  because a gateway's credentials cannot be verified any other way. `unknown`
  is never counted as healthy — an unverifiable dependency is what broke
  sign-in.
- **A late cancellation costs the professional a trip, and nothing recovers
  it.** The window blocks a customer from cancelling once a professional is
  `en_route`, which covers the case that matters most, and `cancellation_fee`
  is always 0 — see `lib/booking/cancellation.ts` for why a fee we cannot
  collect is worse than none. What remains uncovered: a customer who cancels at
  `accepted`, seconds before the professional sets off. That is a real cost
  borne entirely by them. It is left open deliberately rather than papered over
  with a charge: the instrument that fixes it is reputation — a completion and
  reliability record on both sides — and that does not exist until Phase 10.
  Revisit it then, as a policy decision, not a schema one; the columns are
  already there.
- **OTP DELIVERY IS UNPROVEN END TO END, AND NOTHING IN THIS REPOSITORY CAN
  PROVE IT.** Measured against production on 2026-09-10: Twilio answered
  `Error sending confirmation OTP to provider: Authenticate` (error 20003).
  The credentials are rejected, so the request never leaves Twilio's front
  door — not a Nepal routing question, not a deliverability question, just no
  messages at all. Phone OTP is the only way into this product, so **today the
  Supabase test numbers are the only way anybody signs in**, and every
  walkthrough runs on them. What would actually prove delivery, in order: a
  contracted Nepali gateway with a registered sender ID; `SMS_GATEWAY` set to
  `sparrow` or `aakash` with credentials, confirmed by `/api/health` reporting
  `sms.gateway: ok`; Supabase's Send SMS Hook pointed at `/api/sms/send`; and
  then `GET /api/health?deep=1` reporting `auth.sms: ok` **and a handset in
  Nepal actually receiving the code on both NTC and Ncell**. The last clause is
  the whole check — every earlier step can be green while nothing arrives,
  which is exactly the shape of the August outage. Tracked as the
  `sms-gateway-unverified` launch blocker.
- **The SMS adapter is shaped for a Nepali gateway, not for Twilio.**
  `lib/sms/` is one interface with `sparrow.ts`, `aakash.ts` and a `log`
  default, chosen by `SMS_GATEWAY`, with the module boundary linted like
  `lib/payments`. Every shape decision is a place a Twilio-shaped adapter
  would have been quietly wrong: **the recipient is ten national digits, never
  E.164** (a surviving `+977` is accepted and never delivered, silent in every
  log we have, which is why `toGatewayNumber` is exported and tested on its
  own); the body is form-encoded, not JSON; auth is a bare token in the body;
  and the sender is a registered alphanumeric ID owned by the account, which
  is why Sparrow takes a `from` and Aakash takes none — a field one
  implementation needs does not belong in the interface.
  **"Accepted" is never "delivered"**: both gateways answer with a queue
  acknowledgement, so nothing in this product may report delivery from a send.
- **Supabase keeps issuing the code; we only carry it.** No Nepali gateway is
  among Supabase's supported providers, and the obvious answer — hand-roll our
  own OTP — is wrong. Issuance is the part that is easy to get subtly and
  expensively wrong (expiry, single use, attempt counting, constant-time
  comparison, minting a session) and Supabase already does all of it.
  **Delivery is the only Nepal-specific part**, so the seam is Supabase's Send
  SMS Hook at `app/api/sms/send/route.ts`: Supabase calls us with a phone and a
  code, and the registry decides which gateway carries it. The price is that
  **the code now passes through our server**, so it is never logged, never
  returned and never put in an error — not even by the `log` adapter, which is
  where it is most tempting and would put one-time codes into Vercel's log for
  everyone with log access. The hook verifies a Standard Webhooks signature in
  constant time before doing anything, because unsigned it is a public endpoint
  that sends SMS on demand, on our bill and under our sender ID. A failed send
  returns non-200 **on purpose**: Supabase turns that into an error the login
  screen already understands, and answering 200 would have the product ask for
  a code that was never sent.
- **THE LIKELIEST PRODUCTION FAILURE IS AN IP ALLOWLIST, AND IT IS NOT IN THE
  CODE.** Sparrow pins an account to registered source addresses and answers
  `1001` otherwise; Vercel's serverless egress addresses are neither fixed nor
  published as a stable list. So the adapter can be perfectly correct and still
  fail for a reason nothing here can see — the same class of fault as the
  `iad1`/`ap-southeast-1` region bug and the placeholder Twilio credentials.
  It is why `unreachable` is a distinct failure from `refused`. The fallback is
  decided in advance in LAUNCH-BLOCKERS.md rather than during an outage, and it
  rests on one property of the design worth stating here: **the Send SMS Hook
  is called by Supabase, not by our Next.js app** — it is a URL in their
  dashboard. So the hook can be moved to any host with a fixed address without
  touching the application, and `lib/sms/` imports nothing from Next so the
  adapters port unchanged. That makes a small relay a real option; its cost is
  not the money but that an unreplicated box would then sit on the sign-in
  path, and Supabase does not retry a failed hook. The cheapest fix is still to
  pick a gateway that does not require an allowlist, which is only available
  before choosing one.
- **OPEN DEPENDENCY: WILL A CODE DELIVER AT 2AM, ON BOTH NETWORKS?** This is
  blocker-level, not a curiosity, and it is the one question where this
  product's positioning and its only authentication path point in opposite
  directions. We sell emergencies. 2am is the moment we most need to work, and
  it is also when promotional SMS routes are most likely to be throttled or
  barred. **The answer is needed in writing** — does the NTA restriction reach
  transactional OTP, and will our codes deliver overnight on NTC and on Ncell —
  because a verbal "should be fine" is worth nothing at 2am with a flooding
  bathroom. Ask also for a **delivery-time target under load, not just under
  normal conditions**: the minute our codes queue behind somebody's campaign is
  the minute sign-in fails, and an average measured on a quiet afternoon will
  never show it.
- **AND IF THE ANSWER IS THAT OTP CAN BE DELAYED OR BARRED AT NIGHT**, the
  response is designed now rather than discovered during a flood. Four parts,
  in the order they should be taken:
  1. **Stop asking a returning customer for a code at all.** Long refresh-token
     lifetimes mean the 2am problem only ever bites a first-time account or a
     new device. It is worth doing whatever the gateway answers, and it shrinks
     the blast radius further than anything else on this list. **It is a
     Supabase project setting, not code** — Auth → Sessions, where a time-box
     or an inactivity timeout must stay off, and `@supabase/ssr`'s cookie
     options are passed through `lib/supabase/server.ts` unchanged so nothing
     here shortens what the project grants. The middleware matcher already
     covers every page, so the refresh runs on every navigation; that is the
     half that *is* ours and it is done.
  2. **Let an emergency booking be placed before verification finishes, and
     verify out of band.** Most of this exists: `/book` is deliberately public
     and the flow already survives a signed-out entry, `bookings` already
     carries `confirmation_required`, `confirmation_hold_until` and
     `confirmed_at`, and `confirmationPlan` already answers an emergency with
     `["tap","call"]` and `callImmediately: true`. **The phone call that
     confirms the trip is the out-of-band identity check**, so the machinery
     built for wasted trips doubles as the answer to an undelivered code. What
     is missing is minting an unverified account under the service role and
     letting one booking hang off it. **The hard constraint, and it is not
     negotiable: an unverified session may WRITE one emergency booking and READ
     nothing.** No history, no addresses, no other booking. Otherwise "book at
     2am without a code" becomes "read anybody's bookings by typing their
     number", and we would have traded an availability problem for account
     takeover. The existing abuse ladder already caps unverified concurrent
     bookings at two, address trust already treats a brand-new address as the
     risk, and the first wasted trip is already on us.
     **The read half of that constraint is built and enforced already, ahead of
     the path it guards**, because the day somebody builds that path will be a
     day sign-in is broken at 2am — the worst possible moment to be re-deriving
     a security rule from a paragraph. `session_is_verified()` is a
     `security definer` predicate on the SELECT policies for `bookings` and
     `addresses`, and `tests/db/unverified-session.test.ts` proves both
     directions against real Postgres, including by breaking it on purpose. It
     **fails open in the one safe direction only**: false solely when there is
     an auth user it can see and can prove is unconfirmed, so no session, an
     invisible row and the service role all pass — a guard sitting on every
     customer read must not be able to empty somebody's account because a
     lookup returned nothing. It is inert today, since verifying an OTP is what
     sets `phone_confirmed_at` and OTP is the only way an account can come to
     exist; confirmed against production before applying, zero accounts
     affected.
  3. **A second delivery channel that is not A2P SMS — and Viber is a second
     channel, never the one we rely on at 2am.** It is widely used in Nepal,
     it is outside SMS routing rules, and Sparrow already sells it, so it is
     one vendor rather than two. But **it only reaches somebody who has it
     installed, signed in and on data**, and the person this is for is
     frightened, possibly on a dying battery, and may never have opened it. A
     channel with a precondition cannot be the floor. It also needs **the same
     written answers SMS does before it counts as an answer at all** —
     template pre-approval, which message categories we are allowed to send
     under, delivery-time targets, and cost — and none of those can be assumed
     from the SMS contract. Voice OTP is the other candidate: a different
     regulatory category, no install required, but it costs more per attempt
     and reading six digits aloud to somebody in a panic is worse than a
     message they can re-read.
  4. **Gateway failover answers "delayed", never "barred".** A second gateway
     routes around congestion at one provider. A regulatory restriction applies
     at the operator, so both gateways would hit it together. Worth stating
     plainly because buying a second gateway *feels* like insurance against the
     night case and is not.
- **A send is acceptance; only a delivery receipt is delivery.** Neither
  gateway's send response says a handset saw anything, so whether we get
  per-message DLR callbacks is a question asked before signing rather than
  discovered afterwards. Without them the only measurement of delivery this
  product will ever have is customers failing to sign in — which is how the
  Twilio failure ran for a day. Equally, **OTP must not ride a promotional
  route**: those are throttled, queued behind campaigns and in some markets
  barred at night, and a code four minutes late is a failed sign-in while one
  barred at 2am is a flooding bathroom nobody can report. Both are in the
  pre-contract question list.
- **A role can wait for its person.** `provisioned_accounts` maps a phone
  number to a role and an optional provider listing, and `handle_new_user`
  applies it at signup. Before it, walking the provider or admin surfaces meant
  signing in and then having somebody run an UPDATE by hand against production
  — manual work that was already automatable, and the exact shape of mistake
  that ends with the wrong profile made admin. It is also the **break-glass**:
  phone OTP is the only way in, so without this the owner is one undelivered
  message from being locked out of their own platform, and the fix for a
  locked-out admin otherwise requires being signed in as one. Paired with a
  Supabase test number, no step depends on delivery. It is a real privilege
  path and is treated as one — **no insert or update policy for anybody**, the
  same rule as `payments`; every application written to the append-only
  `security_events`; the roster in `scripts/provision-accounts.sql`
  deliberately **not** in `supabase/migrations/`, because everything there runs
  against every future deployment and a standing admin grant must not.
  `tests/db/provisioned-accounts.test.ts` proves both directions.
- **Two provider doors, and the first hands over to the second.**
  `/providers/join` is open — no account, five fields, one `provider_leads`
  row — because a login wall on step one is where a supply funnel dies. It used
  to end in "we will call you back", which needed a person and was the only
  thing standing between a professional and the real flow: nothing anywhere
  linked to `/providers/apply`, so the whole verification pipeline was
  reachable only by typing the URL. The join card now carries them to
  `/login?next=/providers/apply&phone=…`, the number they just typed prefills
  the field (validated through `checkNepaliMobile` first — a query parameter
  must not inject text into an input), and `startApplication` seeds the draft
  from the lead so nobody types their name, trade, ward or years twice.
  `seedFromLead` in `lib/verification/lead-seed.ts` is the one place that knows
  which lead field becomes which application field, and it is **there rather
  than in the data layer because `lib/data/applications.ts` is `server-only`**
  and reaches React's `cache` through the audit log — the same move
  `dispatchIsHeld` needed, for the same reason. Signing in on a different
  number finds no lead and starts an empty application; that is the ordinary
  case, not an error. A signed-in visitor at `/join` is redirected to `/apply`,
  and the lead is marked `contacted` (never `onboarded`, which means they
  became a provider and is set at approval).
- **Provider verification answers two questions and keeps them apart.**
  Identity (`provider_documents`, and who the person is) and competence
  (`application_assessments`, and whether they can do the work) are separate
  tables because a citizenship certificate proves nothing about plumbing, and a
  platform that collapses them ends up with a "verified" tick that means
  nothing. `lib/verification/requirements.ts` labels every document with which
  question it answers, and `competenceSatisfied` takes a CTEVT certificate OR a
  recorded practical assessment — twenty years on the tools and no certificate
  is a common case in Nepal, and CTEVT does not certify cleaning, pest control,
  moving or tank cleaning at all.
- **Removal is enforced by match keys, never by a phone number.** A removed
  provider returning on a new SIM is the actual attack, and a number costs a
  hundred rupees. `application_match_keys` holds hashed, normalised
  identifiers computed AT SUBMISSION — a comparison that runs at review time
  quietly stops running the day somebody adds a second review path. The
  intelligence is in the normaliser rather than the comparison, which is what
  lets the keys be hashed: matching is equality. A hit NEVER rejects anybody.
- **FACE MATCHING IS A SEAM, NOT A VENDOR, AND STAYS THAT WAY UNTIL THERE IS
  VOLUME.** `lib/verification/identity.ts` defines one adapter interface with a
  contract test and ships `manual` behind it; every call returns `needs_human`,
  never `match`, because unknown is never ok. **Choosing a vendor needs real
  quotes at real volume and neither exists yet** — at tens of providers the
  strongest verification available is a person meeting them, and buying a
  service now would commit the data model to one vendor's API shape for a job
  that currently takes about an hour a week. Revisit when monthly check volume
  is high enough that the human comparison is the bottleneck; get written
  per-check pricing from at least two providers before committing, and do not
  take a figure from anywhere but the vendor.
- **The reviewer's screen is where verification actually succeeds or fails.**
  Not a clever forgery — a tired person at the end of an afternoon clicking
  approve because the page looked like every other page. So
  `components/admin/review-decision.tsx` counts which documents have actually
  been opened and will not let the confirmation be ticked until all of them
  have. It is friction placed at the one point where friction is worth paying
  for, and it is honest about its limit: nothing can make somebody LOOK, only
  make skipping it deliberate rather than the path of least resistance. The
  risk score is deliberately NOT on that page — a reviewer who is handed a
  conclusion stops looking for what the rule could not see.
- **The guarantee is a re-do and the visit is what verifies it.**
  `lib/config/guarantee.ts` is pure and testable for the same reason as
  `cancellation.ts` and `pricing.ts`: it decides money. The window is per trade,
  and the attending professional's verdict — `sameFault`, `differentProblem`,
  `nothingWrong`, `customerCaused` — decides who pays for the visit. **No
  verdict produces a refund on its own**, which is what stops the policy being
  farmed by reporting a different problem each time in the same trade. The
  claim table and the two screens are Phase 11 (`guarantee-unclaimable` in
  LAUNCH-BLOCKERS.md); the rule they will read already exists and is tested.
- **The returning professional judges their own work, and Phase 11 measures
  it.** On the common path the person who goes back is the one who did the
  original job, and `differentProblem` is the verdict that gets them paid —
  they are deciding, with money on the answer, whether their own repair failed.
  Exactly the shape of under-reporting on the settlement side, and handled the
  same way: do not police the verdict, measure the pattern. Phase 11 records
  the verdict against the attending professional and feeds a run of
  disproportionately `differentProblem` return visits — compared against the
  rate for their trade, never a fixed number — into the leakage score, which
  starts at "you are told, privately". One verdict is never a signal: a real
  second fault is common. Deliberately **not** on `/providers/standards` until
  it is computed; naming a signal we do not measure is a claim we cannot stand
  behind, which is what LAUNCH-BLOCKERS.md exists to stop.
- **Retention numbers are approved and the clock still is not armed.** Booking
  photos 60 days, tied to the repair guarantee they exist to serve; rejected
  identity documents 90 days, because most rejections are a missing police
  clearance rather than a dispute and thirty days makes somebody re-upload
  their whole identity after queuing for weeks. The privacy answer there is not
  a shorter clock but `EARLY_DELETION` — the rejected set goes the moment a
  re-application is approved, which Phase 10 must call at the point of
  approval. Address redaction at 730 days was checked against
  `booking_status_history` and leaves it intact: that table holds no address,
  the address row is redacted rather than deleted so nothing orphans, and no
  claim path reaches back that far.
- **Money and job progress are separate machines.** A booking can be completed
  and unpaid — for cash that is the normal case — so "mark it complete" and
  "mark it paid" are never the same privilege.
- **The seed JSON is both the fixture and the fallback**, so a clone with no
  keys renders the whole product. Reads record which path they took
  (`?debug=data`).
- **Server/client boundary**: functions cannot cross it. Anything a Client
  Component needs formatted arrives as data — see `areaLabels` and `quoteLabel`
  on the booking flow.

---

## Tests

| Suite | Command | What it protects |
| --- | --- | --- |
| Unit | `npm run test` | Safety escalation, price clamp, status machine, slot rules, redirect safety |
| Database | `npm run test:db` | RLS isolation between two customers, illegal transitions, append-only history, and that the function lockdown did not lock the product out — against a real Postgres running the real migrations |
| Flows | `npm run check:flows` | The booking funnel in a browser, including logged-out → login → resume |
| Paint | `npm run check:paint` | Every front door records a first-contentful-paint |
| Budgets | `npm run build` | Per-route JS ceilings |
| Parity | `npm run check:messages` | `en`/`ne` agree on every key and placeholder |
| Transitions | `npm run check:transitions` | The TS and SQL transition tables agree, comparing against the *last* definition across all migrations — a rule amended in a later file wins, as it does in Postgres |
| Hazard corpus | `npm run test` | Realistic Devanagari, Romanized and English hazard sentences reach the safety path — and ordinary complaints do not |
| Price integrity | `npm run test` | The three verdicts and both boundaries: inside the band, over it with approval, and blocked above 2× |
| Gateway contract | `npm run test` | Every adapter satisfies one interface; a **forged callback loses to the gateway**; the gateway's amount is what gets reconciled; a gateway we cannot reach is not a failed payment |
| Callback reading | `npm run test` | Our reference is recovered from either gateway's return URL, and every customer-facing failure reason has copy in both languages |
| Dispatch windows | `npm run test` | First refusal, widening and giving up, per urgency — including that no window gives up before it opens |
| Cancellation windows | `npm run test` | Who may cancel at which status, exhaustively over every status and actor — so a new status fails here rather than defaulting into a branch |

`npm run verify` runs all of it, database suite included — `vitest run` picks up
`tests/unit` and `tests/db` together. The harness needs Postgres 16 binaries on
the machine (`/usr/lib/postgresql/16/bin`); where they are absent the db suite
fails loudly rather than skipping, because a silently skipped RLS test is worse
than no RLS test.

**Known untested:** the storage policies in
`20260901000002_booking_photos.sql`. They need Supabase's `storage` schema,
which is not part of Postgres, so the harness skips that migration. Nothing
pretends otherwise.

**What the harness now also models:** Supabase's default privileges. Supabase
grants `execute` on every function in `public` directly to `anon` and
`authenticated`, not merely through `PUBLIC`. Without that line the harness was
*more* locked down than production, and a migration that revoked only from
`PUBLIC` passed here while changing nothing there — which is exactly what
happened to the first version of `20260903000001`.

**What the database harness stubs:** the identity source only. `auth.uid()` is
backed by a session setting instead of a JWT, the same shape Supabase's local
tooling uses. Every policy, constraint and trigger under test is the one that
ships. A green run proves our policies are right — not that Supabase's auth is.

## Deferred, with a date

Two things were found in the Phase 9 audit, judged, and deliberately not done.
They are here rather than in a comment because a deferral with no date is a
decision that quietly becomes permanent.

### Move the SECURITY DEFINER functions out of `public` — revisit 2026-12-01

`is_admin`, `provider_can_serve`, `provider_refused` and `provider_serves` are
`SECURITY DEFINER` and callable by any signed-in user through PostgREST's RPC
endpoint. `EXECUTE` cannot be revoked: eleven RLS policies call them and a
policy expression is evaluated with the caller's privileges, so revoking it
breaks every read in the product for every signed-in user. Supabase's Security
Advisor flags all four and will keep doing so.

The real fix is to move them into a `private` schema, which PostgREST does not
expose, keeping `EXECUTE` for `authenticated` so policy evaluation still works.
That closes the RPC surface and silences the advisor legitimately rather than
declining it forever.

Not done in Phase 9 because it rewrites eleven live policies in one migration,
and that phase's brief was to break nothing. The exposure meanwhile is small
and bounded: three of the four answer a boolean about the caller themselves;
`provider_serves` takes any provider id and could tell an attacker whether a
given professional covers a given address — but only for an address whose uuid
they already hold.

**Revisit 2026-12-01**, or sooner if anything else needs a policy rewritten,
because the two changes should travel together.

### Upgrade to Next 16 — revisit 2026-11-01

Tracked as the `next-14-advisories` launch blocker with the three advisories
that plausibly reach this deployment. CI gates at `critical` until it lands and
goes back to `high` afterwards. It has to happen before launch; the date here
is when to start rather than when it is due.

