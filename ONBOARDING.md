# Onboarding

You are joining a codebase with more rules than its size suggests. This file
exists so you can be trusted with a change without reading 65 migrations first.

Read this once, end to end. It is about forty minutes. Everything in it is here
because something went wrong, and most of what went wrong was silent — the
product kept working and kept being wrong, and a person found it weeks later.
That pattern is the single most important thing to understand about this repo:
**the failures here do not crash. They look like success.**

- `CLAUDE.md` is the standing law, in detail, and the source of truth when this
  file and it disagree.
- `ARCHITECTURE.md` is the map of what lives where.
- `SECURITY.md` is every endpoint, who may call it, and where that is enforced.
- `LAUNCH-BLOCKERS.md` is everything currently on a public URL that we cannot
  yet stand behind.

---

## 1. What the product is, in one paragraph

SajiloKaam is a home-services marketplace for Nepal. A customer describes a
problem in plain Nepali or English, an LLM triages it into a trade, an urgency
and a **price band**, and we match them to a professional. The band is a range,
not a checkout: the final figure is agreed on site and **money moves after the
work is done**. We take 15% commission, frozen onto the booking at settlement.
Every design decision downstream follows from that one fact — there is no
payment to hold, so almost every control in this codebase is about making the
*record* trustworthy rather than the transaction reversible.

Stack: Next.js 14 App Router · Tailwind · Supabase (Postgres + RLS) · Claude ·
Vercel. Two locales, English and Nepali, as equals.

---

## 2. The four invariants

These are not style preferences. Breaking one is how this product has previously
lied to a customer, and each is enforced by something that will fail your build
or your test run.

### 2.1 Provenance — a number must carry where it came from

Every price band, every duration, every statistic knows whether a human
researched it, a machine measured it, or somebody guessed. `pricingSource`,
`pricingCheckedAt`, `pricingConfidence` and `pricingNote` sit on all 36
sub-bands in `lib/data/seed/price-bands.json`, with `durationSource` and its
three siblings beside them.

Right now every price is `researched` (dated 2026-09-15, with named sources) and
**every duration is `invented`**. That is not an oversight — it is the system
working. `hasPublishableDuration` in `lib/provider/measured.ts` gates any screen
that would print a duration, and `spansDays()` in `lib/booking/duration.ts`
returns `false` for invented provenance, which is why `booking_days` has never
had a row in production. The multi-day scheduler is fully built and switched
off, because publishing a guessed four-day span would hold four days of a
professional's real capacity on the strength of nothing.

**What this means for you:** if you add a number a customer or an admin will
read, add its provenance in the same commit, and gate the surface on it. Never
widen a gate to make a screen look finished.

### 2.2 Append-only — a log the application can edit proves nothing

`security_events`, `provider_ledger`, `application_decisions`,
`application_assessments` and `cron_runs` all refuse `UPDATE` and `DELETE`
**for every caller, the service role included**. The trigger function is
`public.refuse_rewrite()`, shared across the tables; it raises using
`tg_table_name` so it names the table without knowing about it.

The service-role part is the point. That key is the most privileged caller we
have and it is what every write to those tables goes through. If it could also
rewrite them, the audit trail would only be as good as the code that writes it —
which is exactly the thing an audit trail exists to distrust.

Corollary: `lib/audit` and `lib/notify` **never throw**. The event already
happened. A logging failure must not roll back a booking.

**What this means for you:** if you find yourself wanting to `update` one of
those tables, you want a new row, not an edit. If you add a table that records
that something happened, give it the same trigger — and register the function in
`tests/db/guard-clauses.test.ts`, which will fail until you do.

### 2.3 Read the live definition, never the first one

**This is the rule that will waste your afternoon if you don't know it.**

Policies and functions are redefined by later migrations. The idiom is
`drop policy if exists` + `create policy`, and several policies are created two
or three times as the product grew. "Customers read their own bookings" is
created in `20260901000001_bookings.sql` and created *again* in
`20260911000001_unverified_session_guard.sql` to add a verified-session clause.

So if you want to prove a guard bites by breaking it on purpose, and you edit
its **first** definition, nothing happens: a later migration overwrites your
edit before the suite runs, the test passes, and the obvious conclusion — "this
test is blind" — is wrong. That happened while writing `tests/db/rls-matrix.test.ts`
and nearly got a working guard reported as a broken one.

```bash
grep -rn "Customers read their own bookings" supabase/migrations/
```

Run that before breaking anything. The **last** hit is the one that matters.
The same trap exists one object type over: `create or replace function` takes
the text you paste, so the live definition is whichever migration ran last.

Three mechanisms keep this honest: `supabase/function-fingerprints.json`
(regenerated by `npm run check:migrations -- --write`) records the live shape of
all 53 functions, `tests/db/guard-clauses.test.ts` pins the clauses that must
survive a rewrite, and `docs/rls-matrix.md` is generated by `npm run rls:matrix`
so a policy change shows up as a diff describing who can now read what.

### 2.4 An unmeasured value must never render as a measured one

This has bitten **five** times and every time a column default was being
presented to a customer as a fact:

| Column | Default | What it looked like |
|---|---|---|
| `rating_avg` | 0 | "0.0" printed beside real ratings |
| `avg_response_minutes` | 120 | exactly the scoring ceiling — an untimed professional scored zero forever |
| `availability` | stored, never decayed | "available now" outlived the day it was set |
| `completion_rate` | **100** | a listing nobody measured outranked a real professional at 96% |
| `availability` | `'scheduled'` | every approved professional started on the ranking floor, tied with `busy` — a declared refusal |

The fix is always the same shape, and `bayesianRating` had it first: **carry the
sample count, and with no evidence score like an unknown rather than like an
extreme.** `lib/provider/measured.ts` is the one place that decides whether a
stat has evidence — `hasRating`, `hasResponse`, `hasCompletion`,
`hasOverbookRecord`, `hasAnsweredRecord` — and every surface asks it rather than
re-deriving the test. That divergence has already happened once, between the
catalogue card and `scoreParts`.

Three consequences you will meet:

- **Null means "not recorded", never "no" and never zero.** `parts_failed` null
  deducts nothing from a refund ceiling. `reason_code` null is a refusal with no
  reason given, not a refusal with no reason. `text_hazard` null on an old
  `triage_logs` row means nobody looked, and reading it as "looked and found
  nothing" would manufacture a clean safety record out of an absent one.
- **A rate never prints without its denominator.** Two refunds out of two jobs
  and out of two hundred are different facts. `claimRateWorthReading` is the
  rule; `Counted<T>` exists so a failed read renders as "unreadable" rather than
  as 0%.
- **A true zero is a measurement.** `volume` at zero completed jobs is a fact,
  not an absence. Calling it unmeasured is this rule upside down.

**Before adding any column with a numeric default, say in your PR how an
unmeasured row will be told apart from a measured one.**

---

## 3. The guards, and what each one actually catches

`npm run verify` runs the set. It must be green before anything is pushed —
the branch is the Vercel production branch, so a push is a deploy.

| Command | Catches |
|---|---|
| `npm run test` | 76 unit files. Pure judgements: safety escalation, price clamping, the status machine, redirect safety, ranking evidence |
| `npm run test:db` | 25 files against **real Postgres running the real migrations**. RLS isolation, illegal transitions, append-only, the function lockdown. Needs Postgres 16 binaries; it fails loudly rather than skipping, because a silently skipped RLS test is worse than none |
| `npm run build` | Bundle budgets per route (`scripts/perf-budget.mjs` holds the ceilings — **not** this file, they drifted once) plus `check:secrets` |
| `check:secrets` | Scans the client bundle for every secret's value *and name*. **Its third pass reads the source**, requiring any module that reads `process.env.<SECRET>` to declare `server-only`. The bundle passes were correctly green for months while the service-role key was exported from a module client code imports — it sat in a getter and Next tree-shook it |
| `check:migrations` | Unannounced destructive statements; keeps `function-fingerprints.json` current |
| `check:messages` | `en`/`ne` agree on every key and ICU placeholder; a list of Nepali mistakes that have already shipped; a plural rule that refuses "1 times" |
| `check:keys` | A key missing from **both** catalogues — those agree perfectly and sail through the check above. Resolves every `t()` call through the **TypeScript AST**, never a regex (three regex versions were written first and each cried wolf) |
| `check:transitions` | The TS and SQL transition tables agree, comparing against the **last** definition across all migrations |
| `check:paint` | Every front door records a first-contentful-paint in real Chromium. Catches content hidden behind an entrance animation — has happened twice |
| `check:flows` | The booking funnel in a browser, including logged-out → login → resume |
| `check:blockers` | Refuses a `LAUNCH=true` production build while any launch blocker is unresolved |
| `check:contacts` | Placeholder phone numbers and emails in user-facing copy, judged by shape |
| `check:duration` | Duration provenance |
| `check:advisories` | `npm audit` against a reasoned accepted list |
| `check:deployed` | **Not in `verify`** — it tests what the build produces. Asks the live site which commit it serves, walks every public route, walks every guarded route unauthenticated (proving it is deployed *and* guarded *and* redirects in the right language), and walks every cron target |

Several of these **self-test on every run** — `check:contacts`, `check:secrets`,
`check:messages`, `check:deployed`. A scanner that has quietly stopped scanning
says so rather than printing a tick. Keep that property if you touch one.

**Every guard here is proven by breaking it on purpose, never by passing once.**
When you add or change one, break it deliberately, watch it go red, restore it,
and say so in the commit message. A guard nobody has seen fail is a guard nobody
knows works.

---

## 4. Migration rules

1. **If it is not in a migration file, it does not exist.** Nothing gets clicked
   into the Supabase dashboard.
2. **Write the file first, then apply that exact text**, then verify the objects
   landed (`to_regclass`, `information_schema.columns`, `pg_policies`,
   `pg_proc`). Applying by hand from a dashboard is how the file and the
   database drift apart.
3. **`types/supabase.ts` is hand-written and ships in the same commit** as the
   migration that changed it.
4. **Filename prefixes are unique and ordering is filename order.** Two files
   sharing a timestamp is ambiguous.
5. **Revoking a function grant on Supabase means three roles**:
   `revoke execute on function f() from public, anon, authenticated`. Supabase
   grants execute to `anon` and `authenticated` through a default privilege on
   `public`, so `from public` alone clears nothing.
6. **RLS is row-level, so a policy letting somebody update a row lets them
   update every column.** Postgres has no per-column RLS. `enforce_booking_immutability`
   is a `BEFORE UPDATE` trigger doing that job; `auth.uid()` is null for the
   service role, which is how server writes pass through. **Add a case to the db
   suite before widening any update policy.**
7. **An UPDATE may not make a row invisible to the person making it.** Postgres
   applies SELECT policies to the *new* row. A professional cannot write their
   own release — the instant `provider_id` is null the booking stops matching
   "Providers read their assigned bookings", and no update policy rescues it.
   The shape that works: prove ownership with an RLS **read**, then write under
   the service role.
8. **`public.is_admin()` must keep `execute` for `authenticated`.** Six policies
   call it, and a policy expression runs with the *caller's* privileges.
   Supabase's Security Advisor will keep telling you to revoke it. The answer is
   no.

There are 16 `enforce_*` security-definer triggers live in production. That is
deliberate: a rule in Postgres survives a careless API route, a new developer,
and an LLM writing code against this repo next year. **Enforce in the database
wherever a rule has no legitimate exception.**

---

## 5. Five incidents, and what each one left behind

### The sign-in outage — why there is so much observability

Supabase's Twilio credentials were placeholder zeros. Every OTP failed. Phone +
OTP is the *only* way into this product, so nobody could sign in at all — and
the product's entire response was one red sentence that by design says nothing
about the cause. It ran for a day and was found by a person trying to log in.

The lesson is not "add a try/catch". **Every dependency this product has lives
in somebody else's dashboard** — a Supabase toggle, a gateway credential, a
Vercel variable. None is in this repository and none is covered by `npm run
verify`.

Left behind: `GET /api/health`, the one URL that answers "can this serve a
customer right now", with `?deep=1` behind `CRON_SECRET` to send a real OTP.
`?debug=auth`, `?debug=triage` and `?debug=data` print the provider's own words
on the screen rather than in a DevTools panel nobody opens on a phone. And the
rule **`unknown` is never `ok`** — not looking must never read as working.

There is a corollary that cost a second incident, found only last week: a check
may be `unknown` or `down` **only when a customer is actually affected**, because
`servesCustomers` turns everything but `ok`/`skipped` into a 503.
`checkTriageFallback` returned `unknown` under a comment explicitly saying it
chose that state so "a 503 would be a lie" — and `unknown` and `down` are the
same verdict there. It fired in production: a live key, four triages served by
the keyword fallback, `/api/health` returning 503 while all four customers got
an answer. Any uptime monitor would have paged for a working product.

Also from that family: **a debug channel is only as good as the narrowest
swallow between the provider and the screen, and swallows come in pairs.** MFA
enrolment failed showing "That did not start. Try again." It took three commits
to get Supabase's actual sentence (`500 Error generating QR Code`) onto a
screen, because after the server-side `catch` was fixed the *client-side* catch
in the same flow discarded it too. Fix every catch in one go.

### The ranking defaults — why `measured.ts` exists

Covered in §2.4. Five instances, all the same shape, all invisible: the product
rendered a column default as a fact and ranked real professionals below
fixtures. The two real professionals on the platform sat on the ranking floor
because `availability` defaulted to `scheduled` and the approval insert never
named it.

Left behind: rule 6, `lib/provider/measured.ts` as the single arbiter, and the
requirement that both write paths name the value explicitly so the column only
ever holds something somebody actually said.

### The policy-redefinition trap — why you grep before breaking

Covered in §2.3. Nearly got a working guard reported as broken.

Left behind: the habit of grepping all migrations for an object's name and
editing the **last** definition; `function-fingerprints.json`;
`tests/db/guard-clauses.test.ts`; the generated `docs/rls-matrix.md`.

A related lesson from the same family, worth internalising because it is about
*claims* rather than bugs: `enforce_claim_refund` gates a deduction on
`new.parts_failed is false`, and the migration originally claimed that spelling
is what stops an unanswered question deducting anything. It is not — PL/pgSQL
takes a NULL condition as false, so `= false` behaves identically. Proven by
rewriting the SQL and watching all 52 db cases stay green. **A comment claiming
behaviour the code does not have is worse than no comment.** The guarantee is
asserted as behaviour, never as a text match.

### The function with no caller — why a column is not a feature

`applyRedoRecovery` was written, tested, and documented in three separate places
— and had **no caller anywhere for four phases**. So `provider_outstanding` only
ever went up, every refund was money gone, and `/providers/standards` was
already telling professionals their balance was one "you can watch going down".

It was not a one-off. The same shape appeared three more times:

- `bookings.triage_log_id` had a column, a zod field, a flow-state slot, an
  insert that wrote it, and a `/book` page reading `?triage=` — and `logTriage`
  returned `void`, so nothing ever produced the value. Every link existed; the
  chain did not.
- `booking_refusals.reason_code` shipped with a check constraint, a shared TS
  list and a test — and nothing in the UI offered it, so every refusal recorded
  null.
- The reconcile cron was correctly scheduled and correctly wired, and nothing
  anywhere could say whether it had ever fired.

Left behind: **test the ends, not the links** — a per-link test would have
passed throughout. And when you ship a column, ship the thing that writes to it
in the same phase, or say plainly that you have not.

### The self-promoting customer — why you check the grant, not just the policy

`profiles` had one update policy, `using ((select auth.uid()) = id)`, and it is
correct: you may update your own row and nobody else's. What it does not say —
because Postgres has no way for it to say — is **which columns**. RLS is
row-level, and Supabase grants `authenticated` table-wide UPDATE on every table
in `public` through a default privilege. So one request from any signed-in
customer's browser, with the anon key that ships in the page:

    PATCH /rest/v1/profiles?id=eq.<self>   {"role":"admin"}

`using` and `with check` both pass, because `id` never changes. `is_admin()` then
returns true and the six policies behind it open — every profile, every booking,
every payment, every triage log, and the identity documents in the private
bucket.

The product already knew this. `enforce_booking_immutability` exists for exactly
this reason on `bookings`, and both CLAUDE.md and SECURITY.md describe the class
in those words. Nobody asked the question again one table over, and it was found
while adding an opt-out toggle — the first customer-facing write `profiles` has
ever had.

Two things left behind:

- **A column grant is the narrower tool and usually the right one.**
  `20260927000005` revokes UPDATE from `anon` and `authenticated` and grants it
  back on the three columns a browser legitimately writes. A grant is refused
  before a row is considered and needs no service-role bypass; a trigger on this
  table would have needed one, because `lib/data/review.ts` writes `role` when an
  application is approved.
- **A guard that cannot see the fix is not a guard.** `tests/support/postgres.ts`
  re-granted table-wide privileges *after* applying the migrations, so a column
  grant was erased before any test looked: the fixed migration read as still
  broken, and there was no way to tell that from the fix not working. It sets
  Supabase's default privilege before the migrations now. When a change is
  invisible to the harness, fix the harness first and prove it by breaking the
  fix on purpose.

So: **before adding or widening an UPDATE policy, ask which column on that table
confers power** — and check the grant as well as the policy.

---

## 6. Things that will surprise you

- **Nepali is a first-class path, not a translation.** Match *stems*, never
  words — Nepali conjugates by suffixing. And Devanagari spells one nasal sound
  two ways (`गन्ध`/`गंध`), which `foldNepali` normalises on input and stems
  alike. Normalising a spelling is not widening a match, and that distinction is
  load-bearing: a hazard detector that cries wolf is worth nothing when it is
  real.
- **Import `Link`, `redirect`, `useRouter`, `usePathname` from
  `@/i18n/navigation`**, never from `next/*`. One stray `next/link` drops a
  Nepali reader into English and nothing fails.
- **The seed JSON is both the seed and the runtime fallback**, and every read
  records which path it took (`?debug=data` prints it) because a broken query
  otherwise renders a page that looks perfect. **`providers.json` and
  `reviews.json` are deliberately empty**, so a fresh clone with no keys shows
  an empty catalogue — they held 28 invented professionals, and because the
  fallback fires on a query *error* as well as on missing keys, those 28 would
  have returned to a public page on any database hiccup after being deleted.
  `categories.json` is untouched. A failed read and an empty list are different
  screens for the same reason.
- **The serverless region and the database region are one decision.** Functions
  defaulted to Washington DC while Supabase sits in Singapore; every query
  crossed the Pacific and a signed-in page made a dozen. `vercel.json` pins
  `sin1`. Anything that changes either is a latency change and says so.
- **Never let a motion library own the visibility of content.** `motion`
  components render `opacity: 0` into the *server* HTML — invisible until the
  bundle lands, which on a patchy Nepali connection is a blank page.
- **`@/lib/payments` is server-only**; Client Components import
  `@/lib/payments/client`.
- **Pure functions do not belong in `server-only` modules.** This has been
  fixed four times. If a judgement can be tested without a database, put it
  where a test can reach it.

---

## 7. Your first change

1. `npm install`, then `npm run verify`. It must be green before you touch
   anything — you need to know the baseline is yours, not inherited.
2. Read `ARCHITECTURE.md` for the module map and the shared-code list.
3. Make the change. If it touches anything on the shared list, say in your
   summary **what depends on it and what you checked**.
4. If you are fixing a bug, **reproduce it with a failing test first.** Never
   fix blind. The regression test stays in the suite permanently.
5. If you changed a guard, break it on purpose, watch it fail, restore it, and
   say so.
6. `npm run verify` green, then commit and push — without being asked.
7. `npm run check:deployed` from a machine with real internet. **"Pushed" is not
   "deployed"**: four commits once sat on the branch while production served an
   older build, and a human reading the HTML is what caught it.

Write the handover in `CLAUDE.md`'s six headings — Built, Decided, Fixed,
Motion, Verified, Your turn — and report local checks separately from the live
site. A green `npm run verify` says nothing about what production is serving.

---

## 8. What this file cannot give you

The reasoning behind individual product decisions — why the guarantee is a
re-do and never an automatic refund, why there is no cash surcharge, why a
refusal reason is never scored, why admin accounts have no password. Those are
in `CLAUDE.md` with their arguments attached, and several were decided *against*
an earlier proposal. Before reopening one, check whether it has already been
refused and why; the reasons are written down precisely so the question does not
get relitigated from scratch.

And one honest caveat about all of the above: **almost none of it has met real
traffic.** Fourteen bookings, three professionals with a completed job, one
rating. These mechanisms are correct in principle and largely unproven in
practice. Treat them as well-reasoned rather than battle-tested, and expect the
first month of real customers to teach us something this document does not
contain.
