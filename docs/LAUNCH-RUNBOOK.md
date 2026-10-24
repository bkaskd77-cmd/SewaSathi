# Launch runbook — the order, the proof, and the way back

Written 2026-10-23. **This is the sequence, not the list.** `LAUNCH-BLOCKERS.md`
is the register of what is unproven and `docs/PRE-LAUNCH.md` says which entries
need code; this file says what to do on the day, in what order, how each step is
*proved* rather than assumed, and what undoes it.

Three rules carry the whole document:

1. **A dashboard looking right is never the proof.** The sign-in outage lasted a
   day with Supabase's Twilio panel looking correct the whole time. Every step
   below is verified by a command or by something a URL says, never by reading
   the screen where the change was made.
2. **A new environment variable needs a NEW BUILD, never a re-run.** This cost
   three readings to learn. A `workflow_dispatch` re-deploys nothing when the
   alias already serves that commit, and `scripts/vercel-ignore-build.mjs` is
   fail-closed, so **a commit with a red check cannot deploy the fix for that
   check**. Steps that set a variable therefore end with a push, and
   `docs/RUNBOOK.md` holds `DEPLOY_GATE_OVERRIDE` for the deadlock.
3. **Say which way is back before going forward.** Some of these are not
   reversible and the section at the end names them, so nobody discovers it
   mid-step.

**Who can do what.** Steps 1, 2, 3, 5 and 7 need an account, a credential or a
dashboard and only the owner can do them. The agent can do steps 4 and 6 and
can read every verification in this file except the ones that need the live
site, because outbound HTTPS to `*.vercel.app` is blocked from the sandbox and
the proxy answers 403 — those say so where they appear.

---

## Before the day: two things that are already done

Checked rather than assumed, because a runbook that asks for work already
finished is how a handover gets ignored.

- **VAPID keys are set.** `push-keys-unset` is resolved — the owner generated
  the pair on 2026-10-16, set both halves on Production, and the live
  `/api/health` reported `notify.push: ok`. Both halves matter:
  `pushReadiness` exists because a deployment with only the public key looks
  entirely healthy and throws on every send. **Nothing to do; re-read it in
  step 9.**
- **Backups run nightly and the restore is part of the job.** `backups-unproven`
  is resolved: run `39043603246` dumped production, sealed it, uploaded it
  **and restored it** into a scratch Postgres 17 with the grants coming back
  narrowly (`profiles.full_name` writable by `authenticated`, `profiles.role`
  not). It is a nightly property, so it goes red the day it stops being true.
  **Nothing to set up; confirm the last run is green in step 9.**

---

## 1. SMS credentials in, and proven by a real handset

**Everything else in this runbook is downstream of this step.** No real phone
can sign in today: measured against production, `auth.sms` answers
`422 … auth account AC00000000000000000000000000000000 does not exist` — Twilio
20003, an Account SID of `AC` plus thirty-two zeros, so the credential was never
entered rather than rejected. Every walkthrough so far has run on Supabase test
numbers, which GoTrue answers itself without calling a provider, which is
exactly why nothing has ever looked wrong.

**Do.** Contract the gateway (it costs per message and needs a registered
Nepali sender ID — that is why it is sequenced last among the credentials), then
Supabase → Authentication → Providers → Phone: enter the real Account SID, auth
token and sender. Set `SMS_HEALTH_NUMBER` in Vercel to **a real handset you
hold**.

**Verify.**

```sh
curl -s -H "Authorization: Bearer $HEALTH_SECRET" \
  "https://<production-host>/api/health?deep=1" | jq '.checks[] | select(.name|startswith("auth.sms"))'
```

`auth.sms` must read `ok`. Two traps:

- **It must be a real handset.** A Supabase *test* number is one GoTrue answers
  itself: it accepts the fixed code and never calls the provider, so the probe
  gets its 200 and reports `ok` having touched nothing. That is the outage
  reproduced by the check written to catch it. One SMS per deep run is the price
  of the answer.
- **Read `auth.sms.probe` first.** It is free, public and sends nothing, and it
  says whether `SMS_HEALTH_NUMBER` is set, visible to this build and in a form
  the probe can send. If that line is unhappy, the deep run proves nothing about
  the gateway.

**Then.** Delete the `auth.sms` entry from `ACKNOWLEDGED_FAILURES`
(`lib/config/health.ts`) in the same commit that marks
`sms-gateway-unverified` resolved. `tests/unit/health-state.test.ts` now fails
if an acknowledgement outlives its blocker, so this cannot be forgotten — an
ack over a resolved entry silently forgives that check's *next*, unrelated
failure.

**Roll back.** Restore the previous credential in Supabase; sign-in returns to
its current state. **The messages already sent cannot be recalled**, and if the
sender ID is wrong the recipients have already seen it.

---

## 2. The real support number

**Do.** Set `NEXT_PUBLIC_SUPPORT_PHONE` in Vercel (Production), and
`NEXT_PUBLIC_SUPPORT_WHATSAPP` if there is one. **Then push a commit** — rule 2;
a variable is read at build time and a dispatch re-deploys nothing.

That push is also where `lib/content/pages/contact.ts` gets its "By phone"
paragraph, in both languages. It currently says we have no published line, which
is true and must stop being said in the same deploy that makes it false.

**Verify.** `site.supportPhone` is one constant on five screens, one of them the
login fallback somebody reaches when nothing else in the product works for them.
So check the number renders and is correct on `/legal/refunds` and on
`/help/complaint` — and that `/login?debug=auth` still offers it after a forced
failure. **Not checkable from the agent sandbox** (403 to `*.vercel.app`).

**Roll back.** Unset the variable and push. Every screen that offers a call
renders nothing rather than a dead number — which is the right failure, because
a stale escape hatch reads like contempt.

---

## 3. The test numbers out, one admin kept

**Do.** Two places, and the roster is smaller than the register used to claim.
Measured on 2026-10-10 there are **four** rows in `provisioned_accounts` and
three accounts that have ever signed in:

| Number | Role | Signed in | Second factor |
| --- | --- | --- | --- |
| `9779800000012` | admin | yes | **1 verified TOTP factor** |
| `9779841234567` | customer | yes | none, and none is required |
| `9779800000011` | provider | yes | none, and none is required |
| `9779800000001` | admin | **never** | n/a |

So the deletion is **one row** — `9779800000001`, the break-glass — and it is a
decision rather than a tidy-up: either it keeps a fixed code as the documented
break-glass (`SECURITY.md § 3`, an accepted risk written down as such, code
rotated), or it goes and admin recovery is the TOTP on `9779800000012`. **Not
both by default**: leaving it because nobody chose is precisely how this becomes
a credential nobody remembers.

Then remove every remaining number from Supabase → Authentication → Providers →
Phone → test numbers. **Which numbers are on that list cannot be read from
here** — no API this project holds exposes it — so the fixed-code question is
answerable only by opening that panel. The shape of `9779800000012` suggests it
is one, which would mean the admin being kept has the same fixed-code property
as the break-glass being deleted; deleting one and keeping the other would then
remove a duplicate rather than the class. **Check that panel before deciding.**

**The row delete goes in the Supabase SQL editor, not through the agent.** A
statement the MCP transport judges destructive hangs for sixty seconds and rolls
back — measured, including on `DELETE` — because `execute_sql` wants a
confirmation that never reaches the agent. In the editor the prompt can be
answered.

```sql
-- Supabase → SQL Editor. Not PowerShell, not the agent.
delete from public.provisioned_accounts where phone = '9779800000001';
```

**Verify.** `select phone, role from public.provisioned_accounts order by phone;`
returns three rows, and signing in with the deleted number fails. Then confirm
the kept admin still gets in **and is still challenged**: `stepUpFor` returns
`enrol` with no factor and `challenge` when the proof is older than
`STEP_UP_HOURS` (8), and `adminGate()` reads it on every admin page while
`adminActor()` reads it on every admin action file — asserted by
`tests/unit/admin-gate-coverage.test.ts`, because a server action is a public
POST and one that forgot the gate would be an open endpoint rather than a weaker
screen.

**Roll back.** `scripts/provision-accounts.sql` holds the roster, so a row can
be re-inserted. **The fixed codes are not in this repository and never will be**
— re-creating the account does not restore a way in, and that is deliberate.

---

## 4. The trades and the prices we are actually opening

**The prices are already done and the register proves it rather than asserting
it.** `category-price-bands` is resolved, and `check:blockers` re-checks that
status against `lib/data/seed/categories.json` on **every** run, not only at
launch, because a `resolved` status over an `invented` band is a lie inside the
register that exists to prevent lies. A band moves afterwards through
`/admin/bands`, with evidence, a stored rejection and an audit row — never a
migration.

**What is left is a decision, and it is which trades and wards to open.**
`/admin/launch-scope` is where it is made: tick the subset of the ten trades and
fifteen wards you are ready to serve, and widen later without a deploy. It is
**not** the same act as retiring a ward or a trade — retiring records that we
stopped, with a reason, and this records that we have not started yet — and it
takes effect on the next page load.

**Painting cannot be ticked, and the box says why.** `setLaunchScope` refuses a
trade whose *typical* product needs a span we have never measured — painting's
products are authored at 1, 2, 4 and 7 days, median 2, every one `invented` — so
opening it would reserve one day of a professional's week for a job we have told
the customer nothing about. That is `sub-band-durations` and
`multi-day-scheduling` enforced where they belong rather than holding the whole
build. **Electrical and carpentry are not closed**, although each carries one
2-day product: the median way to buy either is same-day, and holding back the
trade the safety floor points at for gas and live wires over one sub-band would
be the wrong trade-off. The rule clears itself — a span moving off `invented`,
researched by hand or promoted by the duration loop, opens the trade with no code
change.

The screen says what the ticks will do before they are saved. **Either list
empty means the product takes no bookings at all**, because a booking needs both
a ward and a trade, so `scopeStanding` calls that `closed` rather than
`narrowed` and the panel says so in those words. **Professionals are
deliberately not narrowed**: `/providers/join` keeps offering every live ward,
because you need people in a ward before you can open it.

**Verify the scope itself** in the Supabase SQL editor or through the screen:

```sql
select enabled, area_keys, category_slugs, note, updated_at
  from public.launch_scope;
```

It is seeded `enabled = false` with both lists empty, which is "no scope,
everything live is open" — the product's normal state and what it is today.
**Roll back by unticking, or by turning the switch off**; both are one tap, and
neither touches a booking already placed.

**Do.** For each trade you intend to open, confirm on `/admin/bands` that the
published band is the one you want to quote, and read `/admin/content/categories` for
what `categoryReadiness` says is missing — a trade can be open and incomplete,
but a trade whose keyword rules are absent cannot be reached by the matcher,
which is what answers whenever the model is missing, rejected or slow.

**Verify.** `npm run check:blockers` must still print `done category-price-bands`
— it compares the status against the seed, so a band quietly changed to a guess
fails here. And the quote a customer is shown comes from the table rather than
the seed: `createBooking` **refuses** on an unreadable band rather than quoting
the seed, and `/book` declines to render the flow at all, so a catalogue read
that fails cannot freeze a stale ceiling onto a booking.

**Roll back.** Narrow the soft-launch scope — one screen, no deploy, and it takes
nothing away from a booking already placed. Retiring a trade or a ward is the
*other* mechanism and is not the same act: it records a withdrawal with a reason
and is forward-only, deliberately, because `addresses.area_key` and
`bookings.category_slug` hold those keys with no foreign key behind them.

---

## 5. Durations, and the one honest option

Not on the user's list and it belongs here, because it is the step most likely to
be discovered at the wrong moment. All 36 sub-band durations are `invented`, so
**nothing in the product prints how long a job takes** and `spansDays` holds
every job to one day. Those two gates are chained in `check:blockers`, so the day
somebody deletes either one the register still says the numbers are guesses.

**Do.** Nothing, and ship. The observed route is wired and runs nightly
(`sweepDurationPromotions` off the dispatch cron), it publishes without a person,
and `/admin/duration` is where a wrong figure is overruled — the revert reads the
figure from the promotion's own observation row, so there is no box to type a
duration into. The one worth researching by hand rather than waiting for is
painting, whose span is the number a customer most needs before committing and
which needs 20 completed `painting/room-supplied` jobs to arrive on its own.

**Verify.** `npm run check:durations`, and `/admin/duration` showing the shadow
readings accumulate.

**Roll back.** n/a — this step changes nothing.

---

## 6. The LAUNCH flag

**The judgement this step used to be waiting on was made on 2026-10-24**, and it
is recorded in `LAUNCH-BLOCKERS.md § What each entry gates`. Every unresolved
entry now says what it gates, so `LAUNCH=true` is reachable without anything
being waived.

**Five entries refuse a launch build**, and four of them are steps 1, 2 and 3 of
this runbook: the SMS gateway, the support number, the test-account cleanup, the
legal review, and the Nepali native read of the money, safety and legal strings.
The sixth, `payout-notice-undeliverable`, is `launch` **because nobody has
classified it** — it is the one remaining build item, and an unclassified entry
must not fall through to "does not gate". That one is a decision still waiting.

**Four moved to narrower gates that bite somewhere real**, which is the whole
difference between this and a waiver:

| Entry | Gate | What actually refuses |
| --- | --- | --- |
| `withholding-tax-unconfirmed` | `payout-run` | `payoutRunRefusal()` — the run drafts nothing until the rate is confirmed |
| `sub-band-durations` | `launch-scope` | `setLaunchScope` refuses to open painting |
| `multi-day-scheduling` | `launch-scope` | the same refusal |
| `payouts-unbuilt` | `post-launch` | step 10 below, in the **first week** after launch |

**Four do not gate at all**: `play-store-unpublished` (deliberately sequenced
after launch — the PWA installs from the browser today), `eslint-9-flat-config`
and `tailwind-4` (dev tooling, zero findings in the production tree), and
`trust-strip-counts` (waiting on rows that launching is what produces). **All
four stay counted and printed on every run** of `check:blockers`, because
reclassifying is not the same as doing and a number that stops being said out
loud is one nobody closes.

**Do.** Set `LAUNCH=true` on Production (`NODE_ENV=production` is already
Vercel's), then push — rule 2.

**Verify.** `LAUNCH=true NODE_ENV=production npm run build` succeeding locally is
the whole test, and it is the same code Vercel runs. The failure names each
blocking entry with its claim and what replaces it, and lists what is open and
not gating underneath — so the register never looks shorter than it is at the
moment somebody is deciding what to do next.

**Roll back.** Unset `LAUNCH` and push. It gates a build, so nothing a customer
can see changes — which also means it is not an off switch for the product. If
the product itself has to stop taking bookings, that is step 4's scope narrowed
to nothing, or an announcement (step 9), and both are screens rather than
deploys.

---

## 6a. The English-only option

**A launch may go ahead with the Nepali locale hidden**, which is the one
alternative to reading 402 money, safety and legal strings first. The two costs
are not comparable: unread cash-fee copy in front of a Nepali speaker is the harm
`nepali-native-read` exists for, and serving English only is a product that is
**smaller rather than one that is wrong**.

**Do.** Set `NEXT_PUBLIC_ENGLISH_ONLY=true` on Production and push — a new
environment variable needs a new build, rule 2.

**What it changes.** `lib/config/locales.ts` is the whole switch.
`routing.locales` becomes `["en"]`, so `/ne/...` 404s at the router; the language
toggle does not render, because a toggle would advertise the thing that has been
removed; and `check:blockers` reads the **same variable**, so the gate cannot
forgive unread copy somebody is still being served.

**What it does not change, deliberately.** `Locale` stays `"en" | "ne"`,
`messages/ne.json` stays in the tree, and every `locale === "ne"` branch stays
correct — this hides the Nepali half, it does not delete it. `stripLocale` keeps
iterating **every** locale rather than the served ones, which is the dangerous
half: route guards match the unprefixed path, so a `/ne/account` that stopped
stripping to `/account` would stop matching `PROTECTED_ROUTES` and the middleware
would wave it through.

**Verify.** `LAUNCH=true NODE_ENV=production NEXT_PUBLIC_ENGLISH_ONLY=true npm run build`
passes where the same command without it refuses, and the blocker output says
"English-only: the Nepali read does not gate". On the deployment, `/ne` must 404
and no toggle appears.

**Roll back.** Unset it and push. Nepali returns on the next build — and
`nepali-native-read` gates a launch again from that moment, which is the honest
coupling rather than a flag somebody can forget.

## 7. The first professionals

**Do.** Each applies through `/providers/join`, and approval is
`/admin/applications`. **Recruit outside the open wards deliberately** — the
provider application is not narrowed by the soft-launch scope, because you need
professionals in a ward before you can open it.

**Two things the approval writes that are easy to miss.** `availability` is
written explicitly as `today` at approval rather than left to the column default
— the default is `scheduled`, which scores on the floor tied with `busy`, so
every professional approved before that fix began ranked as though they had
refused work and stayed there until they found the toggle. And `/providers/standards`
is linked from the professional's own frame on every screen, so a working
professional can re-read the ladder they are measured against rather than only
seeing it once before signing up.

**Verify.** The listing appears on `/services` with no invented numbers beside
it: an unrated professional says so rather than printing `0.0`, because
`lib/provider/measured.ts` is the one place that decides whether a stat has
evidence behind it. Then have them sign in **on a real handset** — which is what
step 1 bought — and confirm `/provider/jobs` and `/provider/payouts` render.

**Roll back.** `providers.closed_at` + `closed_reason` closes a listing and
carries **no finding against anybody**; `removed_at` is step 5 of the enforcement
ladder and is for cause. Writing one for the other puts a false accusation into
every future report, so they are not interchangeable.

---

## 8. One real booking, end to end

**Do.** Take a real booking on a real handset in an open ward, in an open trade,
and carry it the whole way: triage → `/book` → dispatch → accept → en route →
in progress → complete → settle → receipt.

**Verify, and these are the links that were each built and not joined.**

- **The triage-to-booking join.** `bookings.triage_log_id` had a column, a zod
  field, a flow-state slot, an insert that wrote it and a page reading
  `?triage=` — and `logTriage` returned `void`, so every booking ever taken
  carries a null. Check `/admin/triage-accuracy` attributes this one.
- **The money.** `settleSplit` freezes the split, the fee is charged on
  `max(final_amount, quoted_min)`, and the receipt goes to **both** sides
  carrying the recorded amount. For cash, the customer states the amount and
  does not approve ours (`blindCashEntry`), and a mismatch settles nothing — both
  figures are kept, `amount_mismatch_at` is stamped and a person decides.
- **The payout.** This is `payouts-unbuilt`, and its test is not "the screen
  exists": **one confirmed payout reaching one real professional through the
  run**, with a real `external_reference`, visible on their own money screen.
  The run only ever creates drafts — `payout_transition_allowed` refuses
  `draft -> sent` however it is called, so no cron can reach a rail — and a
  person approves, sends and records on `/admin/payouts`. It needs a human
  sending the first transfer from a bank's own screen.
- **`provider_balance` is the number**, not a sum over bookings. The figure the
  dashboard used to show was wrong four ways over, and `providerMoney` is the
  one money read now, with `tests/unit/provider-money-one-source.test.ts`
  failing on any arithmetic of its own on either screen.

**Roll back.** A booking is cancellable by the customer until a professional sets
off, by the professional until they start work, and by support until the job is
over — and cancelling is always free, because our money moves after the work.
**A settled payment is not a rollback**: a refund is a decision on
`/admin/guarantee-claims`, needs a fifteen-minute `amr` proof, and is funded
from the first professional's earnings at no more than a quarter of any one
payout.

---

## 9. The day itself: what to watch, and what says it

**One URL answers "can this serve a customer right now".**

```sh
curl -s "https://<production-host>/api/health" | jq '{ok, clean, commit}'
```

A public reader gets those three and nothing else — the six read-only checks
that each cost a round trip are behind the bearer token, and the two that cost
money need `?deep=1` on top of it. Read the detailed payload when something is
wrong:

```sh
curl -s -H "Authorization: Bearer $HEALTH_SECRET" "https://<production-host>/api/health" | jq .
```

`ok` means **nothing unattended is wrong**, which is not the same as nothing
being wrong — `clean` is the other half and is reported separately, because one
boolean carrying both meanings is how `ok:false` came to read as "the gateway
again" and masked a real schema-drift finding for weeks.

**Point the monitor at `/api/health` every five minutes.** Two reasons, and the
second is easy to optimise away: it is the question that matters, and Supabase
pauses a free project after a week of inactivity, so a monitor hitting a route
that really queries the database is what keeps the project awake. That is pinned
in `tests/unit/health-public.test.ts` because the cost of removing it is
invisible for six days.

**The checklist for the day.**

| What | Where | Good looks like |
| --- | --- | --- |
| Can anyone sign in | `/api/health?deep=1` | `auth.sms: ok` |
| Is production serving this commit | `npm run check:deployed` | "Live and current" |
| Has the schema drifted | `npm run check:drift` | clean; **exit 2 is "could not look"**, never a pass |
| Did the crons run | `cron.runs` on the detailed payload | each job with a recent run |
| Last night's backup | Actions → **Nightly backup** | green, with an artifact attached |
| Push reachable | `notify.push` | `ok` (both halves) |
| Anything red and unexplained | `clean` on the payload | `true` |

**`/admin` is the other half**, and it carries queue ages rather than only
counts: `payouts` prints the age of the oldest draft, because a count says
whether there is a backlog and only the date says whether it is this morning's
run or a month of silence.

**If something needs saying to everybody, it is a sentence and not a deploy.**
`/admin/announcements` publishes above every page in both languages with a start
and an end — "we are closed for Dashain", "payouts are a day late this week".
Both body columns are NOT NULL with a non-blank check, which is rule 5 enforced
by the schema in the one place a missing translation is invisible. A null
`ends_at` means "until somebody takes it down", and the screen says it in those
words.

---

## 10. The first week: the payout run

**`payouts-unbuilt` is gated `post-launch` and this is the step**, because it is
the one thing a build cannot check and cannot happen before launch: it needs
settled work. The test has never changed and is not "the screen exists" — **one
confirmed payout reaching one real professional through the run**, with a real
`external_reference`, visible on their own money screen.

**Before the first Tuesday, confirm the withholding rate.** The run refuses to
draft anything while `PAYOUT_RUN.withholdingTaxConfirmedAt` is null, and
`/admin/payouts` says so at the top rather than showing an empty queue that reads
as "nothing owed". **Zero is a valid answer** — the rate genuinely may be zero —
so what is needed is somebody who files returns in Nepal confirming it, and then
the date in that constant. Until then every settlement accrues correctly in
`provider_ledger`; nothing is lost and nothing is paid.

**Then, on the first Tuesday:**

1. `cron.runs` on the detailed `/api/health` payload shows
   `/api/payments/reconcile` ran. The run's summary carries `refused`, so a
   refusal is distinguishable in `cron_runs` from a quiet week — three facts that
   must not collapse: `ranFor: null` is "not the run day", `drafted: 0` is
   "nothing owed", and `refused` is "it declined".
2. `/admin/payouts` lists a draft. Check the statement: `earnings` and
   `commission` are what this run put in, `net` is the whole position, and the
   difference is printed as **carried** rather than hidden — a figure somebody
   approves has to be checkable.
3. Approve, send the transfer from the bank's own screen, and record what came
   back. Approve, mark-sent and mark-failed each need a fifteen-minute `amr`
   proof; `markConfirmed` asks for no code at all, because it records an answer
   that came from outside and moves nothing.
4. The professional's `/provider/payouts` shows the balance **going down**, which
   is what `/providers/standards` promises and what `owedRupees` got wrong four
   ways before `provider_balance` became the one money read.

**Roll back.** There is none for a transfer that has reached a rail —
`markPayoutFailed` records that it did not arrive, it does not bring money back.
See *What cannot be rolled back* below.

---

## What cannot be rolled back

Said here rather than discovered mid-step.

- **An SMS that has been sent.** Step 1. If the sender ID is wrong, the
  recipients have already seen it.
- **A fixed OTP code that has been shared.** It is a password that never
  rotates. Rotating it is the remedy; un-sharing it is not possible, and the
  codes are deliberately nowhere in this repository.
- **A payout that has reached a rail.** Step 8. `markPayoutFailed` records that
  it did not arrive; it does not bring money back. There is no card on file, no
  direct debit and no wage to garnish, which is why recovery here is always
  forward — `applyRedoRecovery` nets a debt off future earnings at no more than
  a quarter of any one payout, and `sweepWriteOffs` writes it off after twelve
  months rather than chasing it.
- **A retired ward or trade.** Forward-only by construction: `addresses.area_key`,
  `provider_leads.area_key`, `providers.service_areas` and
  `bookings.category_slug` all hold those keys with **no foreign key behind
  them**, so a delete orphans live bookings and leaves an old booking page
  unable to say where the job was. There is no delete path and there must never
  be one. `reopenArea` exists for a withdrawal made by mistake.
- **An identity document that has been read.** Every admin read is written to
  `security_events` by `recordDocumentAccess`, which is a separate function so
  it cannot be quietly skipped, and that table refuses UPDATE and DELETE for
  every caller including the service role.
- **A `security_events` row.** Same trigger. A log the application can edit
  proves nothing.

## What a deploy rolls back, and what it does not

**Vercel's instant rollback moves the alias to a previous build.** That undoes
code and it does not undo a migration, a row, a sent message or a dashboard
setting. So:

- **A bad deploy** → roll the alias back, then `npm run check:deployed` to
  confirm what is actually being served. "Pushed" and "deployed" diverged
  silently once — four commits sat on the branch while production served an
  older build, caught by a human reading the HTML — which is why every page
  carries `<meta name="x-build-commit">`.
- **A bad migration** → forward only. Write the corrective migration; never edit
  an applied one. A rolled-back alias on a migrated database is the older code
  against the newer schema, which is a worse state than the one being escaped.
- **A bad constant** (a fee, a band, a window) → forward only, and audited.
  Money values take effect forward and never rewrite an existing booking:
  `commission_bps` is frozen onto the row at settlement and `band_revision_id`
  records which decision framed the quote.
