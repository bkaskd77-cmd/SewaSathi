# Pre-launch report — what is left, and who can close it

Read on 2026-10-22, against `39299e1`. Measured, not remembered: every count
here comes from a command named beside it, and anything that could not be
checked from the agent sandbox says so.

`LAUNCH-BLOCKERS.md` is the list and the gate. This file answers a different
question — **which of those twelve need code, and which need a person, a
credential or a transfer** — because mixing the two is how a list gets read as
"still a lot of building to do" when almost none of it is.

```
npm run check:blockers  →  12 unresolved, 11 resolved
npm run verify          →  VERIFY PASSED — 14 steps in 289.1s
unit + db suite         →  2,279 tests, 160 files
```

---

## The short answer

**Three code items remain, and only one of them is a build.**

| | What | Size | Blocked on |
| --- | --- | --- | --- |
| 1 | A recorded history of the contact phone number, so the payout-destination notice can reach the number as it stood **before** a change | one migration, one writer, one reader | nothing — this is ours to do |
| 2 | `lib/content/pages/contact.ts` — the "By phone" section currently says we have no published line | one paragraph, both languages | `NEXT_PUBLIC_SUPPORT_PHONE` being set |
| 3 | `draft: true` removed from the three legal documents (six places, both languages) | one line each | a Nepali lawyer's review |

Items 2 and 3 are one commit each and must land **with** the thing that
unblocks them — a number in the variable, a reviewed document — never before.
Item 1 can be built today.

Everything else open is outside this repository: a gateway credential, a
dashboard deletion, an accountant, a native reader, a lawyer, a bank transfer,
a keystore, and real customers producing rows.

---

## Item 1, in full — the only remaining build

`payout-notice-undeliverable` is the entry, and it is the one that stops payouts
going live. The promise is on `/provider/payouts`: *"Changed on {date}. Was that
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

**Stale prose.** `EARLY_DELETION` read "PHASE 10 MUST HONOUR THIS at the point of
approval" long after `approveApplication` did exactly that. A comment calling an
obligation outstanding when the code meets it costs the same as one describing
behaviour the code lacks: the next reader goes looking for work that is done.

---

## What this report cannot see from here

Said plainly rather than left to be discovered. Outbound HTTPS to
`*.vercel.app` is blocked by policy in the agent sandbox and the proxy answers
403, so:

- **`npm run check:deployed` was not run.** CI's `deploy` job and the
  `After a production deploy` workflow both ran it against `729eeef` and
  `e35818a` and both passed, which is the live evidence for those two commits.
  `39299e1`'s run was still going when this was written.
- **`/api/health` was not read live.** Its last recorded reading is in
  `LAUNCH-BLOCKERS.md`: `auth.sms: down` with the Twilio placeholder named, and
  `triage.model: ok — claude-sonnet-4-6 answered in 1374ms`.
- **Lighthouse was not run.** `npm run check:paint` and the bundle budget both
  pass locally; neither is a Lighthouse score.
