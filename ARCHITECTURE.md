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
| **auth** | `@/lib/auth` (isomorphic)<br>`@/lib/auth/session` (server)<br>`@/lib/auth/otp` (client) | Route rules, redirect safety, phone parsing, session reads, the SMS adapter |
| **triage** | `@/lib/ai/*` | Prompt, schema, price clamp, safety floor, keyword fallback |
| **data** | `@/lib/data/*` | Every read of Supabase, plus the seed fallback |
| **content** | `@/lib/content/*` | Legal and information prose, both languages |
| **config** | `@/lib/config/*` | Categories, areas, brand strings |

`auth` has three entries rather than one and the split is forced, not
stylistic: `session.ts` imports `server-only` and `otp.ts` is `"use client"`.
One combined entry would drag `server-only` into the client bundle the moment a
form imported a phone formatter.

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
| `lib/ai/safety.ts` | Triage on the server, the cache, and the browser fallback | `SMELL_OR_LEAK` matched the noun `गन्ध` but not the verb `गन्हाउनु`, so a Nepali speaker describing a gas leak got the calm path |
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
| eSewa / Khalti | *not built* | Phase 7. `bookings.payment_method` records the intent; nothing charges. |
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
| Database | `npm run test:db` | RLS isolation between two customers, illegal transitions, append-only history — against a real Postgres running the real migrations |
| Flows | `npm run check:flows` | The booking funnel in a browser, including logged-out → login → resume |
| Paint | `npm run check:paint` | Every front door records a first-contentful-paint |
| Budgets | `npm run build` | Per-route JS ceilings |
| Parity | `npm run check:messages` | `en`/`ne` agree on every key and placeholder |
| Transitions | `npm run check:transitions` | The TS and SQL transition tables agree |

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
