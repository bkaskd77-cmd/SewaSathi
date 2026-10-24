# Pre-launch report — what is left, and who can close it

Read on 2026-10-23, against `358a315`. Measured, not remembered: every count
here comes from a command named beside it, and anything that could not be
checked from the agent sandbox says so.

`LAUNCH-BLOCKERS.md` is the list and the gate. This file answers a different
question — **which of those entries need code, and which need a person, a
credential or a transfer** — because mixing the two is how a list gets read as
"still a lot of building to do" when almost none of it is.

**And since 2026-10-24 each entry says what it gates**, which changes what this
report is for. Fourteen are open and **five refuse a launch build**: the SMS
gateway, the support number, the test-account cleanup, the legal review and the
Nepali native read (unless the locale is hidden). Five moved to gates that bite
elsewhere — two at the payout run, two at the launch scope, one as a first-week
verification — and four do not gate at all. See `LAUNCH-BLOCKERS.md § What each
entry gates`.

```
npm run check:blockers  →  14 unresolved, 11 resolved
npm run verify          →  VERIFY PASSED — 14 steps in 290.3s
unit + db suite         →  3,255 tests, 209 files
```

---

## The short answer

**Five code items remain. One is a product build, two wait on something else,
and two are dependency migrations that touch no product code.**

| | What | Size | Blocked on |
| --- | --- | --- | --- |
| 1 | A recorded history of the contact phone number, so the payout-destination notice can reach the number as it stood **before** a change | one migration, one writer, one reader | nothing — this is ours to do |
| 2 | `lib/content/pages/contact.ts` — the "By phone" section currently says we have no published line | one paragraph, both languages | `NEXT_PUBLIC_SUPPORT_PHONE` being set |
| 3 | `draft: true` removed from the three legal documents (six places, both languages) | one line each | a Nepali lawyer's review |
| 4 | **ESLint 9 flat config** — `eslint-config-next@16.4.2` peers on `eslint >=9` | a phase: `.eslintrc.json` carries `no-restricted-imports` and four `overrides`, each of which has to be re-proven to bite | nothing — ours to do, and not urgent |
| 5 | **Tailwind 4** — the fix for eight dev advisories in the watcher and PostCSS chain | a phase: `styles/globals.css` is the token source of truth, so the 4.5:1 contrast pass goes again in both themes | nothing — ours to do, and not urgent |

Items 2 and 3 are one commit each and must land **with** the thing that
unblocks them — a number in the variable, a reviewed document — never before.
Item 1 can be built today.

**Items 4 and 5 are new in this reading and they are dev-tooling only.** Both
arrived as `LAUNCH-BLOCKERS.md` entries on 2026-10-23 when
`check:advisories` stopped running `--omit=dev`: a handful of dev findings, every
one a stack-exhaustion or quadratic-time DoS in a build-time file watcher, CSS
parser or linter, several with no fix published at any version. **The count is
not quoted here on purpose** — it was eleven on 2026-10-22 and seven on the
23rd, off an unchanged lockfile, so `npm run check:advisories` is what says. None is in the
production tree, so nothing a customer requests runs through them — but they run
on a CI runner holding a token that can push here, which is why they are
recorded rather than shrugged at. They are now declared with a reason each and
**printed by name on every run of the gate**, so the count cannot quietly grow.

Everything else open is outside this repository: a gateway credential, a
dashboard deletion, an accountant, a native reader, a lawyer, a bank transfer,
a keystore, and real customers producing rows.

---

## Item 1, in full — the only remaining build

`payout-notice-undeliverable` is the entry, and it is the one that stops payouts
going live. **It does not hold a launch build.** Classified `payout-run` on
2026-10-24: it protects where money goes, money moves only at the payout run,
and a destination change already needs a person before anything is paid. What
changed with it is that the person's yes now has to say HOW they reached the
professional wherever the change notice reached no device — see
`confirmationIsSoleControl` and `payoutDestination.confirmed`. The promise is on `/provider/payouts`: *"Changed on {date}. Was that
not you? Ring {phone}"*, and `DESTINATION_COOLDOWN_HOURS` holds any new account
for 72 hours expressly so somebody has time to act on that sentence.

Web push narrowed it — `lib/notify/push.ts` delivers
`payout.destinationChanged` to every subscribed browser, and that kind is
deliberately push-only, because an SMS read at send time warns the attacker who
has just changed the phone number too. `payout_destinations.notice_devices`
records how many devices the notice reached, read **before** the row is written
so an attacker subscribing a second later cannot turn an unwitnessed change into
a witnessed one.

What is still missing is the half push cannot cover: an account with no
subscribed device. That needs the notice sent to the contact **as it stood
before the change**, and:

```
grep -rn "phone" supabase/migrations/*.sql | grep -iE "history|previous|was_|old_"
→ (nothing)
```

**This schema does not record a previous phone number anywhere.** So the work is
a small append-only table (or a column pair on an existing one) written whenever
`profiles.phone` changes, plus the reader in `lib/notify`. It depends on the SMS
gateway to actually deliver, but the recording does not — and recording it is
the part that cannot be done retroactively, so it is worth doing before the
gateway arrives rather than after.

---

## The twelve, by who can close them

### Needs a credential or a dashboard (4)

- **`sms-gateway-unverified`** — Supabase → Authentication → Providers → Phone.
  Measured against production: `422 … auth account AC000…000 does not exist`,
  Twilio 20003, so the credential was never entered rather than rejected. **No
  real phone can sign in today.** Everything else in this list is downstream of
  it, and the product's own check proves it in one request:
  `GET /api/health?deep=1` must report `auth.sms: ok`. The dashboard looked
  correct the whole time it was broken, which is why the dashboard is not the
  test.
- **`test-account-otps`** — delete four walkthrough numbers from the Supabase
  test list, and the matching `provisioned_accounts` rows. The row delete is one
  SQL statement and **cannot be run from here**: a `DELETE` hangs on the MCP
  transport for the full sixty seconds and rolls back, so it goes in the Supabase
  SQL editor, where the confirmation prompt can be answered.
- **`support-phone-number`** — one variable, `NEXT_PUBLIC_SUPPORT_PHONE`. Every
  screen that would offer a call renders it the moment it is set. Item 2 above is
  the one place still written as prose.
- **`play-store-unpublished`** — a keystore from `bubblewrap build`, then
  `ANDROID_PACKAGE_NAME` and `ANDROID_CERT_FINGERPRINT` in Vercel. Deliberately
  sequenced after launch: the PWA installs from the browser today with the same
  manifest, worker, offline shell and push. The 404 on
  `/.well-known/assetlinks.json` is correct while the pair is unset.

### Needs a person who is not a developer (3)

- **`nepali-native-read`** — 402 money, safety and legal strings plus four
  long-form documents, read **in place on the screen** rather than in a
  spreadsheet; register is invisible out of context. 424 staff strings are
  counted and do not block. `npm run ne:review` prints them English-beside-Nepali
  grouped by what getting each wrong would cost. A key leaves the backlog by
  being added to `messages/ne-reviewed.json` by hand, because no rule can know
  whether somebody actually read something.
- **`legal-documents-unreviewed`** — a Nepali lawyer on
  `/legal/terms`, `/legal/privacy`, `/legal/refunds`. Item 3 above lands with
  their revisions.
- **`withholding-tax-unconfirmed`** — somebody who files returns in Nepal
  confirming whether we withhold, at what rate and for whom.
  `PAYOUT_RUN.withholdingTaxBps` is 0, the column and the ledger kind exist, so
  the answer is a constant rather than a migration.

### Needs real customers, not code (3)

- **`trust-strip-counts`** — the invented figures are gone and the strip carries
  four statements true on day one. It stays open because the rows a count would
  draw on are not there yet. The filter, not the floor, is what matters:
  `platformStats()` counts only what is actually verified.
- **`sub-band-durations`** — all 36 durations are `invented`, no screen prints
  one, and the observed route is **wired and running nightly**
  (`sweepDurationPromotions` off the dispatch cron). Painting is the one worth
  researching by hand rather than waiting for: 20 completed
  `painting/room-supplied` jobs is a long way off and the span is the number a
  customer most needs before committing.
- **`multi-day-scheduling`** — gated on the above by `check:blockers` rather
  than by a comment. `spansDays` holds every job to one day until a span has
  real provenance.

### Needs a dependency migration, dev-only (2)

- **`eslint-9-flat-config`** and **`tailwind-4`** — items 4 and 5 above. Clearing
  every outstanding dev advisory, zero of them in the production tree. The pair of
  **criticals** that were in that tree (`vitest` and `tinypool`, a
  prototype-pollution gadget to RCE in worker options, on a runner holding a
  push token) were cleared on 2026-10-23 by `vitest@4.1.12`.

### Needs a transfer somebody makes by hand (1)

- **`payouts-unbuilt`** — the run exists: `lib/data/payouts.ts` drafts one net
  figure per professional per ISO week, `/admin/payouts` approves, sends and
  records, and `payout_transition_allowed` means no cron can ever reach a rail.
  The test is unchanged and is not "the screen exists": **one confirmed payout
  reaching one real professional through the run**, with a real
  `external_reference`, visible on their own money screen. Two things stand
  between here and there and neither is in this repository — the SMS gateway
  (for the re-auth code and for item 1) and a human sending the first transfer
  from a bank's own screen.

### And one that is item 1

- **`payout-notice-undeliverable`** — above.

---

## What was swept to produce this, and what it found

Not asserted — these are the commands, and each one found something.

**Leftover markers.** `grep -rn "TODO\|FIXME\|XXX\|HACK"` over `app`,
`components`, `lib`, `scripts`, `supabase`, `i18n`, `types`: **8 hits, all of
them `98XX`-style phone-format placeholders in copy.** No real TODOs anywhere.
`lib/mock/` does not exist.

**Unarmed config.** Every module-level `number | null = null` in `lib/`:
**three**, all deliberate, all now declared in `lib/config/unarmed-levers.ts`
and tested — `arrearsPauseRupees`, `maxPaidClaimsPerPeriod`,
`maxFailedChecksPerPeriod`. The finding was that **"pick a number" is not the
blocker for any of them**: the first contradicts a published promise on
`/providers/standards`, the second needs that page's treatment before it can
refuse anybody money, and the third would be read against a count that does not
exist and by design cannot. Nothing was armed; three guesses were avoided.

**Functions nothing calls.** Every exported function in `lib/` against every
production file, comments stripped: **16 of 698 have no production reader, each
now waived with a reason in `tests/unit/no-caller.test.ts`.** Two were real and
are fixed: `servesCustomers`, named by twelve comments in `/api/health` as the
rule deciding 200 against 503 while `healthVerdict` inlined the same rule, and
`mixByMonth`, which was on no screen although the standing notes described the
payment mix as "by category, by ward and by month". `findAreaRow` was dead with
no reader anywhere, not even a test, and is deleted.

**Dependencies.** `npm audit` over **both trees**: **zero** findings in the
production tree, every dev-tree finding declared with a reason. Four packages may run
code at install time, each declared with the command it runs, compared against
its own `package.json`. Every GitHub Action is pinned by commit SHA. Four
version floors (`next`, `sharp`, `react`, `react-dom`) hold, read from the
lockfile and needing no network — because npm's advisory feed was measured
**eight days late** on a critical RCE and is still missing another.

**Stale prose.** `EARLY_DELETION` read "PHASE 10 MUST HONOUR THIS at the point of
approval" long after `approveApplication` did exactly that. A comment calling an
obligation outstanding when the code meets it costs the same as one describing
behaviour the code lacks: the next reader goes looking for work that is done.
Three install-script descriptions in `SECURITY.md` were false in the other
direction — "npm flags a script and the package declares none", of packages that
declare one — and the command is checked against disk now rather than asserted
in prose.

---

## What this report cannot see from here

Said plainly rather than left to be discovered. Outbound HTTPS to
`*.vercel.app` is blocked by policy in the agent sandbox and the proxy answers
403, so:

- **`npm run check:deployed` was not run from here.** CI's `deploy` job and the
  `After a production deploy` workflow both ran it against `358a315` and both
  passed, which is the live evidence that production serves this commit.
- **`/api/health` was not read live.** Its last recorded reading is in
  `LAUNCH-BLOCKERS.md`: `auth.sms: down` with the Twilio placeholder named, and
  `triage.model: ok — claude-sonnet-4-6 answered in 1374ms`.
- **Lighthouse was not run.** `npm run check:paint` and the bundle budget both
  pass locally; neither is a Lighthouse score.
