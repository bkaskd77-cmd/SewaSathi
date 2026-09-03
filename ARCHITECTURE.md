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
| **auth** | `@/lib/auth` (isomorphic)<br>`@/lib/auth/session` (server)<br>`@/lib/auth/otp` (client) | Route rules, redirect safety, phone parsing, session reads, the SMS adapter |
| **triage** | `@/lib/ai/*` | Prompt, schema, price clamp, safety floor, keyword fallback |
| **data** | `@/lib/data/*` | Every read of Supabase, plus the seed fallback |
| **content** | `@/lib/content/*` | Legal and information prose, both languages |
| **config** | `@/lib/config/*` | Categories, areas, brand strings |

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
| Transitions | `npm run check:transitions` | The TS and SQL transition tables agree |
| Hazard corpus | `npm run test` | Realistic Devanagari, Romanized and English hazard sentences reach the safety path — and ordinary complaints do not |
| Price integrity | `npm run test` | The three verdicts and both boundaries: inside the band, over it with approval, and blocked above 2× |
| Gateway contract | `npm run test` | Every adapter satisfies one interface; a **forged callback loses to the gateway**; the gateway's amount is what gets reconciled; a gateway we cannot reach is not a failed payment |
| Callback reading | `npm run test` | Our reference is recovered from either gateway's return URL, and every customer-facing failure reason has copy in both languages |

`npm run verify` runs all of it, database suite included — `vitest run` picks up
`tests/unit` and `tests/db` together. The harness needs Postgres 16 binaries on
the machine (`/usr/lib/postgresql/16/bin`); where they are absent the db suite
fails loudly rather than skipping, because a silently skipped RLS test is worse
than no RLS test.

**Known untested:** the storage policies in
`20260901000002_booking_photos.sql`. They need Supabase's `storage` schema,
which is not part of Postgres, so the harness skips that migration. Nothing
pretends otherwise.

**What the database harness stubs:** the identity source only. `auth.uid()` is
backed by a session setting instead of a JWT, the same shape Supabase's local
tooling uses. Every policy, constraint and trigger under test is the one that
ships. A green run proves our policies are right — not that Supabase's auth is.
