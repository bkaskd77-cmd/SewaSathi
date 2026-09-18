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
| **provider** | `@/lib/provider` (isomorphic) | What a professional controls about their own listing: the rate clamp, the availability decay, and whether they can serve a given time |
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
| Every `security definer` trigger function | Every write to the table it guards | `create or replace` takes the text you paste, not the text that is there — three times it has taken a version nobody intended, and all three were caught by a behavioural test happening to cover the clause that went. `tests/db/guard-clauses.test.ts` is the inventory: each clause with what it protects and what breaks without it, plus an inverse check so a guard added without an entry fails |
| `lib/text/nepali.ts` | `lib/ai/safety.ts`, `lib/ai/mockTriage.ts`, the `/services` catalogue search | Nepali writes a nasal before a consonant two ways and every safety stem was authored one way, so `गंध`, `सिलिंडर` and `करेंट` reached the gas and live-wire guards undetected. 18 stems in that state and one hand-patched variant beside them. Folded on both sides now; anusvara cases in `tests/unit/hazard-corpus.test.ts` |
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

- **A number on the front page shows only when the rows behind it are real, and
  the filter comes before the floor.** `platformStats` counts a professional
  only when they are verified AND came through `provider_applications` — reading
  the live database found 26 of 28 "verified" providers were seeded fixtures, so
  a floor of 25 would have passed and put "28 ID-verified professionals" on the
  landing page: a smaller lie, arrived at carefully. Below a floor the strip
  shows **no number and no substitute number**; all four items are true on day
  one. `STAT_FLOORS.ratedJobs` is `RATING_PRIOR_COUNT` rather than its own
  constant — "is this evidence yet" is the same question about one listing and
  about the platform. `check:blockers` enforces that `trust-strip-counts` cannot
  resolve while `seed-providers-and-reviews` is open.
- **Reviews are sealed by the database, not by the screen.** Nobody holds an
  insert or update policy on `provider_reviews`: an author who could stamp their
  own `published_at` could read the other side first, which is the one thing
  double-blind exists to stop. `provider_visit_reviewed_at` is refused to
  browsers for the same reason, and it is a column rather than a flag row
  because most visits produce no flags — a seal keyed on "a flag exists" would
  never open for an ordinary job. `lib/reviews` holds the rules; publication
  rides the dispatch cron.
- **The money guards are tested by name, because they once vanished without a
  line of code changing.** `enforce_booking_immutability` lost every settlement
  check to a migration rebuilt from a stale copy — `create or replace` takes the
  version you paste, not the version that is there. Five of the twenty-five
  guarded columns happened to have tests; nineteen had none, and a rebuild that
  dropped only those would have gone green to production.
  `tests/db/booking-rls.test.ts` now names every guarded column, refuses each
  one from a customer session, asserts the trigger is still **attached**, and
  asserts that the function guards **nothing the list does not name** — so the
  list and the function cannot drift apart in either direction.
- **The database is the authority on who may read what and which status may
  follow which.** RLS policies and the transition trigger are enforced in
  Postgres, so no code path — including one nobody has written yet — can go
  around them. `lib/booking/status.ts` holds the same transition table for the
  interface; `npm run check:transitions` fails the build if the two disagree.
- **`TriageResult` is the contract** between the model, the fallback matcher
  and the card. Everything behind it can be rebuilt as long as that shape and
  the ten category slugs hold.
- **`lib/data/` is the only thing that talks to Supabase.** Pages never do.
- **What a booking needs from its customer is one pure function.**
  `attentionFor` decides it, returns at most one thing per booking, and is the
  only place that ranking lives — so `/bookings`, and any later badge or
  notification, cannot disagree about whether somebody is being waited on.
- **The customer's product and the professional's product are two route groups,
  not two sets of cards.** `app/[locale]/(app)/` carries the marketing header
  and the full footer, because a customer who signs in is still shopping.
  `app/[locale]/(work)/` carries `WorkHeader`, two tabs and a phone number,
  because a professional is working. The URLs are unchanged — a route group is
  a frame, not a path — and the `--work` tokens in `styles/globals.css` are
  what makes the two unmistakable at a glance for the person who is both.
  Adding a professional screen means adding it to `(work)`; the frame comes
  with it.
- **A guarantee claim reaches `resolved` only through `attended`.** The visit is
  the verification, and the edge is enforced in Postgres
  (`claim_transition_allowed`) as well as in `lib/booking/claim-status.ts`.
  `npm run check:transitions` now parses three pairs rather than two. A refund
  needs a person on top of that: `refund_rupees > 0` without
  `refund_decided_by` is refused for every caller, service role included.
- **Whether a window is already taken is the database's answer, not a
  screen's.** `enforce_slot_capacity` is a BEFORE trigger because a booking
  gains a professional five ways — the customer choosing one, `claimJob`,
  `chooseProvider` after a withdrawal, the dispatch sweep and an admin — and
  writing the check at each is four chances to forget the one that
  double-books. `lib/booking/capacity.ts` is the same rule in TypeScript so a
  row can be greyed before anybody taps it; the trigger is the one that cannot
  be bypassed. It **serialises on the professional** with a transaction-scoped
  advisory lock: two claims for two different jobs are not competing for the
  same row, so no policy `using` clause can settle that race, and under read
  committed both would otherwise count zero and both commit.
  `tests/db/slot-capacity.test.ts` fails without the lock.
- **Past the cap there is exactly one door, and a professional opens it.**
  `overbook_offered_by` is per booking, never a standing setting and never
  something a customer can ask for — `enforce_booking_immutability` refuses the
  column to every browser caller — and `capacityFor` adds exactly one seat, or
  offers stack until the cap is decorative. An offer is only stamped when the
  window is genuinely full; a professional who could take the job ordinarily
  gets the ordinary claim, because `overbook_offers` is the denominator of the
  miss rate and diluting it is how a real pattern stops showing up.
  **A miss is counted and is never a refusal**: `record_provider_release` skips
  the `booking_refusals` row when `overbook_missed_at` is set, the same shape as
  `widened_by_customer_at`. Somebody who offered to squeeze a job in and ran out
  of day did not turn it down, and barring them from that customer's
  replacement list would punish exactly the behaviour the offer exists to
  encourage. `/providers/standards` says so under *What is never a signal*.
- **A full window is the one refusal that stops a booking at every urgency.**
  Every other `canServeAt` refusal is a note the product says and carries on
  past, because the booking would still work. This one would not — the trigger
  refuses the insert — so `blocksBooking` treats it as a stop, and the greyed
  row carries the next slot the picker itself offers rather than only a no.
  `lib/data/capacity.ts` is the one read, deliberately thin: a window start and
  nothing else, never whose job it is or where.
- **Whether a professional can come is three facts and only two are theirs.**
  `providerState` in `lib/provider/availability.ts` is the single rule:
  `on_job_since` (ours, written by a trigger from booking status) beats
  `busy_until` beats `available_until`, and the stored `availability` column is
  only the base underneath all three. The precedence is the anti-gaming core —
  nobody is listed "available now" while `en_route` to a house, whatever their
  switch says. There is NO sweep for any of it: a background job that turns
  flags off is one that stops running some night, so every read computes it and
  the directory query widens in SQL and narrows in JS.
- **"Can they come?" is a property of the professional AND of when the customer
  wants them, and `canServeAt` in `lib/provider/serving.ts` is the only place
  that decides it.** A state shown on a card and read by nothing else is
  decoration: a customer could see "On a job", tap Book, walk four screens and
  confirm without the product ever repeating what it already knew. Every
  surface now reads the same answer — the shortlist, the review screen,
  `createBooking`, `chooseProvider` and `pickAlternatives` — so none of them can
  say a different thing about the same person. **Only an emergency is a stop**
  (`blocksBooking`): the customer picking emergency has already told us they
  need somebody now, so the screen hands them who is free instead. Everything
  else books, is notified, and can be widened after `DISPATCH_WINDOWS`'
  first-refusal window. Being on a job at 11am is never allowed to count
  against a Thursday slot — that branch is the one a careless edit breaks, and
  `tests/unit/provider-serving.test.ts` pins it hardest.
- **A customer can stop waiting on silence, and it is not a refusal.**
  `widenBooking` sets `bookings.widened_by_customer_at`, and
  `record_provider_release` reads that stamp and records nothing. Without it,
  clearing `provider_id` would count a decline against somebody who did nothing
  and hide the job from them for ever via `provider_refused` — contradicting
  "Turning work down. You are allowed to be busy" on `/providers/standards`.
  The db suite asserts both halves.
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
- **The floor of a quote is the professional's own starting price; the ceiling
  is always ours.** `quoteFloor` (`lib/provider/rates.ts`) is the rule and it is
  `clampRate` against the band of the trade being booked — a multi-trade
  professional is clamped against the UNION of their bands, so taking their rate
  raw would write `quoted_min` above `quoted_max` and the table's own check
  would refuse the insert. `createBooking` writes it; after that
  `bookings_sync_quote_floor` maintains it, because a job changes hands five
  ways and the one that matters is a widened job claimed by somebody cheaper —
  a stale floor would charge them a commission built from a price they never
  set. Released bookings fall back to the category floor, and
  `freeze_quote_after_work` refuses any change once `final_amount` is set, with
  no service-role bypass. **That trigger's name is load-bearing**: BEFORE
  triggers fire alphabetically and `bookings_enforce_immutability` raises on a
  `quoted_min` change from any browser session, which `claimJob` is — the db
  suite asserts the ordering.
- **A default is never a measurement, and `lib/provider/measured.ts` is where
  that is decided.** `hasRating`, `hasResponse`, `hasCompletion` — one
  definition each, asked by the ranking and by every screen, because the rule
  was previously re-derived per surface and the surfaces disagreed (the
  catalogue card gated the response time on `jobsCompleted`, `scoreParts` on
  `responseSamples`). Unmeasured scores mid-scale rather than at an extreme, the
  shape `bayesianRating` had first. See rule 6 in CLAUDE.md for the four times
  this has bitten.
- **A declined guarantee claim reaches somebody else.** `/legal/refunds`
  promises a visit without conditions; `acceptClaim` admitted only the original
  professional or the one already attending, and `releaseClaim` did not clear
  `attending_provider_id` — so a hand-back left the claim open to nobody at all.
  `claimOpenToAll` is the rule, applied in TypeScript and again in the
  `Providers read open claims in their trade` policy so a screen and the
  database cannot disagree: first refusal to the professional whose work it was
  for `CLAIM_FIRST_REFUSAL_MINUTES`, then the trade. **Settling it instead was
  rejected** — the guarantee is a re-do a visit verifies, and a claim that pays
  out because somebody was hard to reach is the repeatable route to free money
  the whole policy is shaped to avoid. The money keeps the path it had:
  `provider_ledger` charges the original a redo debt only when somebody else
  attends and finds the same fault.
- **A band is proposed by the system and decided by a person. It never applies
  itself — and the reason is not caution, it is that the measurement is
  circular.** The band sets the quote; the quote is what a professional sees
  before naming a figure and what a customer expects to pay; those agreed
  figures are the `final_amount` rows the next proposal is computed from. An
  auto-adjusting band therefore **measures its own shadow**: raise the floor and
  next quarter's settlements drift up, which the loop reads as evidence the
  floor should rise again. Nothing in the data can tell that apart from the
  market actually moving, because the two are the same rows.
  Two independent reasons on top of that, either of which would be enough. The
  band is **published copy** — a promise on a public page — and copy that
  rewrites itself is copy nobody has read. And it **moves commission**: the fee
  is charged on `max(final_amount, quoted_min)` and the floor starts from the
  band, so an automatic band change silently changes what every professional in
  that trade pays us. That is a business decision with an owner, not a computed
  one. `docs/PRICING-BANDS.md` holds the proposal mechanism, the review screen
  it is meant for, and the robust statistic that keeps a handful of large jobs
  from dragging a proposal.
- **The keyword matcher routes to the wrong trade, and the two causes are
  mechanical rather than a question of which words are in the lists.** Found by
  `tests/unit/triage-corpus.test.ts`, which runs twenty jobs through it in
  Devanagari, Romanized Nepali and English. Five cases land wrong and each is
  pinned there as current behaviour, so the fix arrives as a visible diff.
  **First, substring matching on Latin text**: `tap` matches inside `tapai`
  ("you"), so "pura ghar rangnu paryo rang tapai le lyaune" — a whole-flat
  repaint — is sent to plumbing. Substring matching is *correct* for
  Devanagari, which has no usable word boundary for a regex and is why the
  lists are built on stems; it is wrong inside a Latin word.
  **Second, longest-wins ranks a generic symptom above a named object**,
  because length is not specificity: `बिग्रियो` ("broke", 8) outranks `स्विच`
  ("switch", 5) so a switch goes to appliance repair, `ढोका बिग्रियो` the same,
  and `cooling` (7) outranks `fridge` (6) so a fridge goes to an AC technician.
  Three absences sit beside them: painting has no Nepali keyword in either
  script, pest-control none in Romanized, and the tank rule spells tank
  `ट्यांकी` while a customer may type `ट्याङ्की` — with neither matching, the
  generic `सफा गर्न` wins and a tank clean becomes a house clean. **Devanagari
  turns out to have the same unstandardised-spelling problem the Romanized
  lists are deliberately loose about**, which the stem rule in CLAUDE.md does
  not cover. The words belong in `lib/data/synonyms.ts`, the one table both
  this matcher and the catalogue search read. It is the *fallback* path — it
  answers when the key is missing, the call times out or validation fails — so
  this is a quality gap rather than a live defect on the normal path, which is
  why it is recorded rather than rushed.
- **A job has a duration, and the scheduler reasons in it.** This was the named
  structural gap and it is closed. `WORKING_HOURS.slotHours` is still 2, but it
  is now only the width of a slot the picker OFFERS — how long a job HOLDS is
  its own fact, on the booking. The two were one number, which is why a tap
  washer and a whole-flat repaint reserved the same block.
  **Two numbers, because for painting they diverge.** `typical_working_minutes`
  is how long the professional is on the tools and fills their calendar;
  `typical_elapsed_days` is how long the customer's home is a building site and
  is what they plan around. A room takes four days and a painter a few hours of
  each, because putty dries and coats need hours between them. `booking_days`
  is that split made real: the professional is held for the day's minutes on
  each day of the run, the SITE is held for the whole span, and the gap between
  them is the drying.
  **The collision the old model missed**, and it missed it on the screen and in
  the database alike: a four-hour job from ten runs to two, a forty-five-minute
  job at one lands inside it, and a fixed two-hour window said the first ended
  at noon so the two never met. It is asymmetric too — swap the lengths and the
  same two start times stop colliding — which one constant cannot be.
  **An invented number may reserve, it may not claim, and it may not reserve
  more than a day.** All 36 sub-band durations are guesses, so minutes are used
  (a wrong one costs 90 minutes where 120 was right, bounded and no worse than
  the flat window it replaced) and spans are refused (a wrong one takes four
  days of real capacity, invisibly, and nothing distinguishes it from a
  measurement). `spansDays` in `lib/booking/duration.ts` and the matching gate
  in `sync_booking_days` are the rule; `hasPublishableDuration` keeps every
  figure off every screen; `multi-day-scheduling` in LAUNCH-BLOCKERS.md is
  chained to `sub-band-durations` so neither gate can be opened quietly.
  **The TypeScript and the SQL are held together by a check, not a comment.**
  `enforce_slot_capacity` carried `interval '120 minutes'` under a note asking
  the next reader to keep it in step by hand; `npm run check:duration` now fails
  if the constants or the precedence disagree, and is proven by breaking both.
  **`max_concurrent_jobs` was two facts under one name and is now neither.**
  "Do not block a painter while the first coat dries" was never concurrency, it
  was job length — which is why every category value above 1 existed — and the
  interval scheduler models it directly, so the category column is **dropped**.
  "A firm with three trucks does three moves" is crew size, which duration says
  nothing about, and that half survives as `providers.crew_count`: admin-set
  from verified crew at onboarding, null meaning one, probation capping it
  whatever an admin wrote. **The rename is the point** — a column called
  `max_concurrent_jobs` invites the next reader to set it to 3 because a painter
  is idle on Wednesday, and that is now exactly wrong. Pinning the category
  column at 1 was the alternative and is worse: a constant nobody may change is
  a trap that keeps implying concurrency is a property of a trade.
  `p_category_slug` stays on `booking_slot_capacity` unused, because dropping a
  parameter forces a rewrite of `enforce_slot_capacity` and that rewrite has
  taken a version nobody intended three times.
- **The surveyor's fee is never paid automatically, and that is the whole
  anti-farming design.** A fee that pays itself is farmable — quote high, get
  declined, collect — so `survey_visit_fees` rows are born `pending` and move
  only when a person decides, the same shape as `commission_appeals` and the
  guarantee refund. Two more guards live in `enforce_survey_visit_fee`: **no
  trip, no fee** (a row is refused without a `booking_arrivals` record, so the
  journey — most of the real cost — is mandatory), and the monthly cap counts
  **approved** rows only, so a queue of honest declines never blocks a real
  claim. The decline-rate signal is `survey_decline_signals` and it is **per
  trade, never per professional**: a trade where most quotes are declined is our
  pricing, not a list of people, which is the same rule
  `category_pricing_signals` follows and the same reason.
- **A trade whose price does not exist until somebody has looked.** Movers and
  packers carries `quote_model = 'survey'` and a **null band**, and the survey
  visit is a booking — a real professional at a real door — rather than a second
  record with its own dispatch, tracking and cancellation to reconcile. The
  surveyed range is what the customer approves, and `enforce_survey_quote`
  refuses `in_progress` until they have, so the 2× overcharge ceiling in
  `judgeFinalAmount` is never measured off a figure nobody agreed to. **Two
  independent guards, because this is the money path**: that trigger, and every
  money function refusing a null band on its own (`not-surveyed`, never
  coerced to zero — `null * 2` is NaN and NaN compares false against every
  amount, so a missing ceiling would silently stop being a ceiling).
  `bookings_band_only_null_for_survey` makes a null band impossible anywhere
  else — a nullable money column is the thing that leaks into another code path
  three phases later. **A declined or lapsed quote is free to the customer, paid
  to the surveyor (`surveyVisitFeeNpr`, capped monthly), and recorded against
  nobody**: counting it would teach surveyors to quote low enough to be accepted
  rather than high enough to be true.
- **The narrowed figure is the promise, so the sub-bands are data.**
  `category_price_bands` holds one row per product inside a trade — AC servicing
  is a routine service, a gas refill and an installation, not one 500-12,000
  range — each with its own provenance, date and confidence. They were a
  hand-written string per category in `lib/ai/price-bands.ts`, which meant the
  number a customer actually reads could not be measured, revised by evidence or
  sourced. **The category band is the union of its sub-bands, exactly**, and
  `tests/unit/sub-bands.test.ts` asserts it: a sub-band outside the category
  range would quote a figure `quoteFloor` then clamps away, so the triage and
  the booking would disagree. The model's note is generated from the table, so
  repricing a product reprices the prompt with it.
- **A trade with no market price publishes none.** `categories.pricing_model` is
  `band` or `survey`. Movers is `survey`: no Nepali operator publishes a figure,
  every one quotes after a look, so the category keeps its listing and loses its
  range rather than carrying an invented one. The prompt lists a survey trade
  without a range at all, because handing the model bounds is handing it a
  number to assert.
- **Every published band records where it came from, and a guess cannot
  launch.** `categories.pricing_source` is `invented`, `researched` or
  `observed`, beside `pricing_checked_at` and `pricing_note`. All ten are
  `invented` today — a developer's guess at a Kathmandu price, on every category
  card, in the triage answer, and as the floor of every quote the fee is charged
  on. `npm run check:blockers` reads the seed directly, so `category-price-bands`
  cannot be marked resolved while any category still says `invented`: the one
  entry in that register checked against data rather than taken at its word.
- **Two floors on a booking, and only one of them is ours.** `band_min` is the
  category band as published when the booking was made, frozen by
  `freeze_booking_band` (filled at insert, pinned on update); `quoted_min` is
  the holding professional's starting price. `category_pricing_signals` counts
  `below_band_jobs` against ours and `below_quote_jobs` against theirs, because
  they answer different questions — our price being wrong versus the commission
  floor biting on one person, which `commission_appeals` handles. Before the
  split there was one column and the quote-floor change silently turned the
  band-review signal into a measure of how expensive individual professionals
  are. It is frozen rather than joined to `categories` at read time so the
  question stays "was the band we PUBLISHED right" rather than re-judging every
  past job against a band we have since moved.
- **A professional's rate is clamped on OUR writes too, not only on theirs.**
  `clampRate` ran on the dashboard save and nowhere else, while approval wrote a
  flat Rs 500 — below every band floor we publish. Every professional approved
  through the real application flow was therefore listed at a price the product
  refuses from them. `lib/data/review.ts` now writes the floor of their own
  band, and the db suite reads the catalog to assert no listing sits outside it.
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
- **DUPLICATE NUMBERS ARE JUDGED PER RELATIONSHIP, NEVER BY ONE BLANKET RULE.**
  "No identical numbers anywhere" would be wrong here: a shared family wallet
  is normal in Nepal, a professional's own number legitimately appears both as
  their sign-in and as their published contact, and a foreman vouching for his
  whole crew is the supply this platform wants rather than a fraud. So each
  pairing gets its own answer, and `lib/verification/applicant-rules.ts` holds
  them. Every comparison folds the country code, leading zeros and Devanagari
  numerals through one normaliser, because otherwise every rule below is
  defeated by typing `+977` in front of a number.
  - **Refused at the moment of typing**, because no reading of the evidence
    rescues them: a reference equal to another reference, a reference equal to
    the applicant's own number, and a reference equal to the payout account —
    the last because a referee who holds the wallet is not an independent
    referee, and the two checks that were meant to be separate become one
    person with an interest in the answer.
  - **Allowed but stated**: a payout account that is not the applicant's own
    number. Requiring a match would exclude the older and less formally banked
    professionals this product exists to reach.
  - **Recorded as a signal**: reference phones are match keys now, weighted low
    (`MATCH_WEIGHTS.reference`). One friend vouching for six applicants was the
    cheapest collusion available and was completely invisible, because
    references were stored on the application and compared against nothing.
    Low, not high, so a crew sharing a foreman is unremarkable and only a
    pattern stands out.
  - **STILL OPEN, and deliberately deferred to the admin surface** rather than
    forgotten: the same payout account across two *approved* professionals;
    changing a payout number after approval, which is the classic
    account-takeover move and needs re-verification rather than a form; and the
    customer side, where booking contact numbers are unconstrained. These are
    internal checks on people already in the product, so they belong with the
    tools for acting on them.
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

