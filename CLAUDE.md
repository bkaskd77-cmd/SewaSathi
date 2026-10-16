# SajiloKaam — working notes

AI-native home services platform for Nepal. Next.js 14 (App Router) · Tailwind ·
shadcn-style primitives · Supabase · Claude · Vercel.

**A person joining cold reads `ONBOARDING.md` first** — the four invariants, the
guards and what each catches, the migration rules, and the incidents that
produced them. This file is the standing law in full and wins wherever the two
disagree; that one is the forty-minute version written for somebody who has
never seen the repo.

## Working agreement

- **One phase at a time.** Every phase, and every substantial change inside
  one, ends with the handover below. It is not optional and it is not a
  paragraph.
- **Commit and push when a step is done — without being asked.** Not at the
  end of the phase, not when prompted: when the thing works and the checks are
  green. The branch is the Vercel production branch, so a push is the deploy;
  never ask the user to click Redeploy, and never leave finished work sitting
  in the working tree. `npm run verify` first — pushing red is worse than not
  pushing. The handover then reports what was pushed, so "did you push it?" is
  never a question the user has to ask.
- **"Pushed" is not "deployed".** They diverged silently once — four commits
  sat on the branch while production kept serving an older build, and it was
  caught by a human reading the HTML. So a step is not done at the push: every
  page carries `<meta name="x-build-commit">` and `npm run check:deployed`
  compares it against `git rev-parse HEAD`, then walks every route.
  **The sandbox cannot run it** — outbound HTTPS to `*.vercel.app` is blocked
  by policy and the proxy answers 403, which is why the check exits 2 (never 0,
  never 1) when it cannot reach the site. When that happens, **Verified** says
  "local only, live not checked from here" and **Your turn** carries the
  command. Never write "verified" for something only proven locally.
- **`npm run verify` says its own verdict in its last line, and that line is the
  only evidence it passed.** A run was once reported green off a completion
  notification while the suite inside it was red. The exit code had been right
  the whole time — `npm run test` exits 1 — so nothing was broken in the
  mechanism; what was broken is that **a failed run and a passing one ended the
  same way.** A `&&` chain stops at the failing step, so the tail is test output
  either way and nothing anywhere states what it meant for the run. A verdict
  somebody has to remember to ask for is a verdict that gets skipped.
  `scripts/verify.mjs` is the gate now: a summary naming every step, including
  the ones a failure stopped (`--`, never a blank — "did not run" and "passed"
  must not look alike), then one banner and nothing after it —
  `VERIFY PASSED — N steps` or `VERIFY FAILED — <step> exited <code>`. It
  carries the failing step's own code rather than flattening to 1, because
  `check:deployed`'s 2 means "could not reach the site" and that is a different
  fact. **Never report green from a notification, a summary or a tail that does
  not contain that line.**
  **It was also missing two checks CI ran** — `check:transitions` and
  `check:blockers` — so "verify green" and "CI green" were different claims while
  this file called verify the gate. `check:transitions` is the one that mattered:
  it is what stops the TypeScript and SQL booking status machines disagreeing,
  and it had never run locally. The list lives in the script alone, and a test
  reads `package.json` so a renamed script fails in a test rather than four
  minutes into a run.
- **Automate everything reachable.** Only ask the user for things that need
  their account or a credential, and then ask for one thing at a time.
- **Migrations are applied by the agent, never pasted by the user.** The
  Supabase MCP connection is live in this session: `apply_migration` runs the
  file and `execute_sql` verifies it afterwards. Handing somebody a wall of SQL
  to copy into a dashboard is manual work that was already automatable, and it
  happened four times before anybody said so. Write the file into
  `supabase/migrations/` first — it is still the source of truth and the db
  suite runs it — then apply that same text, then check the objects exist.
- **Be brief.** Short answers, copy-pasteable steps, no walls of text.

### Architecture — standing law

The risk as this grows is **shared surface, not file count**. Every bug that
has cost a rebuild lived in shared code: `cn()`, the root and locale layouts,
`template.tsx`, `lib/seo.ts`, the Devanagari font on `:root`. None was caused by
there being too many files. `ARCHITECTURE.md` is the map and is updated in the
same commit as the change, never afterwards.

1. **Tests are the memory this project does not have.** Every phase ships tests
   for what it built; a phase with no new tests is not done. `npm run verify`
   must be green before a phase is reported complete. Test behaviour and
   contracts, never implementation — a test that breaks when a button is
   restyled is worse than no test. The critical paths always have one: triage
   safety escalation, price clamping, the booking status machine, RLS isolation
   between customers, redirect safety.
   **And a fixture anchored to `now()` is a test that is red at some hour of the
   day.** Three `booking-duration` cases were, for ten hours out of every
   twenty-four, and had been since they were written: `completed_at` is stamped
   `now()` by the status machine and cannot be chosen, so "started 95 minutes
   ago" crosses the Nepal day boundary just after midnight and the trigger
   correctly records nothing — while the across-days helper, whose comment
   explicitly rejected clock-dependence, placed a same-day start at "today at
   10:00 NPT", a time that has not happened yet for most of the Nepal morning.
   Nobody had run the suite at those hours. The fixture now clamps into the
   current Nepal day and **returns the gap it actually got**, and the assertion
   is the trigger's whole rule against that gap rather than a number that is
   only true in the afternoon — which is stronger than the `>= 95` it replaced,
   not a loosening. Checked by evaluating the clamp against 144 simulated times
   of day rather than by running it once and believing it.
2. **Feature modules have one public entry and the linter enforces it.**
   `no-restricted-imports` forbids reaching into another module's internals.
   `lib/booking` and `lib/auth` are done; the rest is mechanical and must be
   done against a green suite. Prove the rule still bites after changing it.
3. **Shared code has a higher bar.** The list is in `ARCHITECTURE.md`. Before
   changing anything on it, say in the summary **what depends on it and what
   you checked**. Feature code is cheap; shared code is never a casual edit.
4. **One adapter per external dependency**, with a typed interface, listed in
   `ARCHITECTURE.md`. Swapping a provider is one file or the rule has been
   broken.
5. **Nepali is a first-class path, not a translation layer.** Every phase
   ships it working, tested, and checked the same way English is — not
   retrofitted afterwards. It has now broken silently twice, both times the
   same way: matching dictionary words when **Nepali conjugates by suffixing**.
   `गन्हाउनु` arrives as गन्हायो, गन्हाउँछ, गन्हाइरहेको, गन्हाएको. So **match
   stems, not words**, everywhere text is matched — `lib/ai/safety.ts` and the
   `KEYWORD_RULES` in `lib/ai/mockTriage.ts` are both built that way and say so.
   Devanagari has no usable word boundary for a regex, which makes stems the
   natural approach as well as the correct one.
   **And the rule is not only Nepali's, which this paragraph implied and the
   English lists did not honour.** `containsKeyword` lets the TEXT carry a
   suffix and never the keyword, so a Latin keyword authored in the PLURAL is
   invisible to everybody who types the singular: "insects in the room" was
   answered and "insect in the room" was not, reported by a customer.
   The list had half-noticed — `cockroach`/`cockroaches`, `termite`/`termites`
   and `rat`/`rats` were each written out twice, which fixed three words and
   hid the rule from the next reader, while `ants`, `insects` and `packers` had
   no singular at all. One entry each now, as the stem, with the duplicates
   deleted because two spellings of one word is how a rule gets lost.
   `tests/unit/keyword-stems.test.ts` scans every Latin keyword at RUNTIME —
   which is what catches the aliases `lib/data/synonyms.ts` folds in, and is
   where two of the three misses actually lived — and names the exceptions that
   merely end in `s` (`mess`, `smell of gas`, `udus`) with a reason each. Romanized Nepali has no
   spelling standard, so those lists stay deliberately loose.
   **And Devanagari has no single spelling either**, which is the same lesson
   one level down and cost eighteen safety stems before anybody noticed. A
   nasal before a consonant is written as an anusvara (`गंध`, `सिलिंडर`,
   `करेंट`) or as the nasal consonant plus virama (`गन्ध`, `सिलिन्डर`,
   `करेन्ट`), and both are ordinary — so a stem authored one way missed
   everybody who typed the other, on the gas and live-wire guards. `foldNepali`
   in `lib/text/nepali.ts` collapses the two, on the input and the stems alike,
   so no list has to be authored in a particular spelling. **It folds that one
   sound and nothing else**: `श`/`ष`/`स`, `व`/`ब` and `ि`/`ी` vary just as
   often and collapsing them merges words that genuinely differ, which is how a
   hazard detector starts crying wolf. Normalising a spelling is not widening a
   match, and the difference is the rule. Anything matching
   user text gets cases in `tests/unit/hazard-corpus.test.ts` phrased the way
   somebody in a hurry would actually type them — including the ordinary
   complaints that must NOT fire, because a product that cries wolf is worth
   nothing when it is real ("करेन्ट आएको छैन" means the power is out).
6. **A default is never a measurement.** Unmeasured must be distinguishable
   from measured-as-zero *everywhere* — in ranking, on cards, in filters, in
   any number a customer reads as evidence. This has now bitten three times and
   every time a column default was being presented as a fact: `rating_avg 0`
   rendered as "0.0" beside real ratings; `avg_response_minutes 120` sat exactly
   at the scoring ceiling so an untimed professional scored zero forever;
   `availability` was a stored column that never decayed so "available now"
   outlived the day it was set. A fourth was found by the audit that produced
   this rule: `completion_rate` defaults to **100**, so a listing nobody has
   ever measured scored a perfect completion rate and outranked a real
   professional at 96%. A fifth was found by reading the live `providers` rows:
   `availability` defaults to **`scheduled`** and the approval insert never
   named it, so every professional we approved began ranked at
   `AVAILABILITY_SCORE['scheduled']` — which sat on the floor tied with `busy`,
   a declared refusal — and stayed there until they found the toggle. Both real
   professionals were there; the seeded fixtures, authored at `today`,
   outranked them. **That base is written explicitly now on both paths**:
   approval writes `today`, and clearing both stamps writes `scheduled`, so the
   column only ever holds something somebody actually said.
   The shape of the fix is always the same and `bayesianRating` had it first:
   **carry the sample count, and with no evidence score like an unknown rather
   than like an extreme.** `lib/provider/measured.ts` is the one place that
   decides whether a stat has evidence behind it — `hasRating`, `hasResponse`,
   `hasCompletion` — and every surface asks it rather than re-deriving the
   test. A screen with no evidence says so; it does not print the default.
   Before adding any column with a numeric default, say in the summary how an
   unmeasured row will be told apart from a measured one.
7. **When something breaks, reproduce it with a failing test first.** Never fix
   blind. The regression test stays in the suite permanently. If the fix
   touches shared code, say so explicitly and list what else you verified.

### The handover — six headings, nothing else

Write these six, in this order, and stop. An empty heading gets deleted rather
than padded — except **Motion**, which is always written even when the answer
is "none".

- **Built** — what now exists that did not before. Bullets, not prose.
- **Decided** — the calls made and the one-line reason for each. Only decisions
  that constrain what comes next; leave out anything reversible and obvious.
- **Fixed** — bugs found on the way, including ones that were already there.
  Say which were pre-existing.
- **Motion** — what moves that did not before, and what it is for. The one
  heading that is never dropped: a phase that shipped no motion writes "none"
  and why. A missing heading reads as "forgot", which is indistinguishable from
  "considered and decided against", and Phase 5's summary left it out entirely
  so nobody could tell which had happened.
- **Verified** — what was actually run, with the numbers. "Tests pass" is not a
  verification; "median-of-3 mobile Lighthouse 97, budgets green, 8 paint
  checks" is. If something was not checked, say so here. Local checks and the
  live site are reported separately: a green `npm run verify` says nothing
  about what production is serving, so say which of the two you actually saw.
- **Your turn** — the manual steps only the user can do, one at a time, and any
  decision waiting on them. Empty means genuinely nothing is blocked.

The failure mode is length, not omission. Detail belongs in the commit message
and in this file; the handover is what someone reads in thirty seconds to know
where the product stands.

## Design tokens — the one rule

`styles/globals.css` is the single source of truth. Nothing hardcodes a colour.

Brand (fixed): Deep Emerald `#0F6B5B` · Warm Gold `#D6A84B` · Ivory `#FFF8E7` ·
Deep Slate `#24323A`.

A light hue can be a **fill** or it can be **text**, not both. Gold, warning,
info, success and destructive each have a `--*-ink` token for anything
text-sized. Never use `text-gold` — it is 2.07:1 on ivory. Use `text-gold-ink`.

Every new component gets a contrast pass in both themes before it ships;
4.5:1 minimum.

## Component library

`components/ui` — Button · Badge · Card · Input · Label · Dialog · **Accordion**
(added Phase 2 for the landing FAQ). `components/marketing` holds the
landing-page sections; `lib/config/` holds brand strings and the category list.

`lib/utils/image.ts` compresses a photo in the browser before it is uploaded
(1500px longest edge, JPEG, well under 1 MB). It is imported dynamically by the
hero — most visitors never attach a photo and should not download it.

`components/shared` — `Reveal` and `CountUp` both sit on the single `useInView`
hook in `lib/hooks/`. Add scroll-triggered behaviour there, not as a second
observer.

## Triage

`TriageResult` is the contract and it has not changed since Phase 2: category
slug, urgency, price range, explanation. Everything below can be rebuilt as
long as that shape and the ten category slugs hold.

The path: `lib/ai/triage.ts` (client) → `POST /api/triage` → Claude
(`claude-sonnet-4-6`, no thinking, `temperature: 0`, 400 max tokens) →
`lib/ai/triage-schema.ts` validates → `lib/ai/safety.ts` → the card.

- **It always answers.** Missing key, timeout (9.5s), provider 500, unparseable
  JSON, a category we don't sell — every one of those ends at
  `lib/ai/mockTriage.ts`, which is why the keyword matcher is still here. Never
  delete it, and never let a failure path return an error to the hero.
- **The prompt is generated**, not hand-maintained: `lib/ai/prompt.ts` builds it
  from the category list and `lib/ai/price-bands.ts`, whose bounds come from
  `KEYWORD_RULES`. Repricing a category in the matcher reprices it in the
  prompt. The prompt is byte-identical per request, so it prefix-caches.
- **The price is clamped** to the published band for the chosen category. The
  band is in the prompt; the clamp is for when the model ignores it.
- **The safety floor is server-side and runs on every path** — model, cache and
  fallback. Gas, burning, sparking, live wire, shock, in English, Romanized
  Nepali or Devanagari: urgency becomes `emergency` and the explanation is
  prefixed with what to do right now. The prompt asks for this too; the guard
  is what makes it true. An AC gas refill is deliberately not a gas leak.
- **The photo has its own hazard read**, because the text guard cannot see one
  and the panic case is somebody photographing a sparking board and typing
  nothing. Claude returns a fifth key, `hazard`, and it is **one-way**: it can
  raise a result to emergency and add the safety line, never lower one. The
  text guard wins when both fire — it is the deterministic half.
- **A photo nobody looked at says so.** If the call fails or times out with an
  image attached, the answer opens with "we couldn't look at your photo" plus
  what to check, on the categories where a hazard could live (electrical,
  plumbing, appliance, AC). Urgency is not raised — not seeing something is not
  evidence of a hazard — and a cleaning job gets no warning about flames.
- **`GENERIC_RULE` is a reservation, never a recommendation, and it reached a
  customer three times.** It is plumbing, "needed soon", Rs 900-4,000 — what the
  matcher returns when NOTHING matched — and the hero printed it under "here's
  what we think you need" for a photograph of a banana, then for a photograph
  nobody looked at, then for a paragraph of lorem ipsum. `hasSomethingToTriage`
  is the one gate and it now asks three things: did the model judge the words
  off-topic, did any keyword point at the trade on the card, and was there
  anything to look at. `keywordAnswer` carries the `matched` flag because the
  matcher is the only thing that knows which of its two answers it just gave.
  **The one escape is the HAZARD, and writing "emergency" there was the same
  bug one turn later.** `URGENT_MARKERS` contains "now", a visitor's lorem
  ipsum contained "now use Lorem Ipsum as their default model text", so the
  matcher raised an answer it had found nothing for to `emergency` — and the
  escape, tested before `matched`, dragged the card back onto the screen
  wearing an Emergency badge. A word boundary would not have saved it; the
  text really does contain the word. **An answer nobody found cannot be urgent
  about anything**, so the matcher no longer raises one, and the rule now tests
  the hazard `applySafetyFloor` actually read. A hazard is evidence; an urgency
  is a label, and a label can be stuck on an answer nobody found. Nothing is
  lost on safety — the floor reads the raw text on every path, so gas is an
  emergency because of the gas and never because of the "now".
- **A prompt that asks for an answer the schema refuses is one list written
  twice.** The prompt has asked for an `onTopic` verdict since the ceilings
  shipped and `category` was a required enum, so every reply that correctly
  judged a question off-topic failed validation and was discarded whole —
  `unparseable`, and the verdict, the hazard read and the photo verdict went
  with it. The off-topic ceiling could therefore never fire, because the only
  thing that produces its evidence was being thrown away before it was read.
  `category`, `urgency` and `priceRangeNPR` are nullable now and `result` can be
  null with them; the loosening stops there, so a reply naming a trade and
  omitting the rest is still refused. The test parses the exact JSON the prompt
  asks for, which is the only thing that keeps the two halves in step.
  **Two reasons, not one**: `off-topic` ends a visitor's AI day and moves a
  streak, `no-trade` costs nobody anything and is the signal that the ten
  categories miss what people ask for. Collapsing them would pause people for
  being vague.
- **A threshold people can only find by tripping it is a trap, and the off-topic
  pause was one.** The model names what it read, the card is suppressed, and
  nothing said a count was running — so a second awkwardly-worded question took
  the AI away for a day out of nowhere. `/providers/standards` settled the same
  argument for professionals and the sentence transfers verbatim: deterrence
  nobody can read is not deterrence. `offTopicConsequence` is the rule, pure and
  beside `applyTopicVerdict`, and it is handed that function's **own stored
  state** rather than recomputing a streak — a screen promising "one more"
  must not be describing a count the database does not keep. **Three outcomes,
  because the rule differs**: a visitor's AI day ends on ONE off-topic answer, a
  signed-in account gets `offTopicStreakToPause`, and the third is the pause
  having already started. Printing one number at all three would be wrong for
  the visitor, who has no account to read a history from. It is the rule stated
  with the count it is about to act on, never a score — `claimRateWorthReading`'s
  posture — and it sits **below** the way forward, because the first thing
  somebody reads has to be how to get help.
- **A limit goes above the answer it refused.** Six ceilings fired on one
  visitor and each rendered a full plumbing recommendation with the notice
  underneath it, so the report that came back was "no ceiling". One screen says
  one thing, too: `instead` picks a single replacement for the card in a stated
  order, the way `attentionFor` settled it for `/bookings`.
- **Rate limit** 12/min and 60/hour, per user id when signed in, per IP
  otherwise. **Cache** 10 minutes, text only, 500 entries. Both are in-process,
  so on Vercel they are per-instance: a soft cost ceiling, not a security
  control. Swap in Upstash behind the same signatures when it matters.
- **Not streamed.** The response is one small object that has to pass schema
  validation, the price clamp and the safety floor before anyone sees it.
  Streaming would mean showing fields we haven't finished checking.
- **Every triage is logged** to `triage_logs` (text, photo yes/no, category,
  urgency, latency, source, hazard). The photo is never stored. `hazard` is
  written as `text:gas`, `vision:burning` or `unseen-photo`.
  **That column records the winner, not the evidence, and this file claimed the
  opposite for three phases** — "so the two detectors can be compared later" was
  wrong the day it was written. `applySafetyFloor` lets the deterministic text
  guard beat the photo read whenever both fire, so `vision:*` only ever appears
  on rows where text found nothing: agreement, disagreement and "text caught
  what vision missed" were all unmeasurable from it, and only "vision caught
  what text missed" survived, because that is literally what a `vision:*` row
  means. `text_hazard` and `vision_hazard` are each detector's own reading,
  returned by `applySafetyFloor` so no caller re-runs detection and the readings
  can never disagree with the outcome beside them. **Null in either is "not
  recorded", never "no hazard"** — rule 6, and it bit on day one: every row
  written before those columns is silent, and reading that silence as "both
  looked and found nothing" manufactures a clean safety record out of an absent
  one. `lib/data/triage-accuracy.ts` derives the cutover from the data rather
  than from a date constant nobody could verify later.
- **The triage is measured against what the customer did next, and the join was
  broken at its first link for the whole life of the product.**
  `bookings.triage_log_id` had a column, a zod field, a flow-state slot, an
  insert that wrote it and a `/book` page reading `?triage=` — and `logTriage`
  returned `void`, so nothing ever produced the value and every booking ever
  taken carries a null. Every individual link was built; the chain was not. The
  id now rides the booking URL with the rest of the intent, and the test asserts
  the **ends** rather than the links, because a per-link test would have passed
  throughout. `/admin/triage-accuracy` is the screen.
  **It measures and it does not tune**: no threshold, no grade, no colour for
  bad, no proposal. Nobody knows yet what a good agreement rate looks like here
  and a constant would freeze a guess into the codebase as a standard. Every
  rate prints the sample it came out of, through one function, so no row can
  render a bare percentage — `claimRateWorthReading`'s rule minus the judgement.
  `Counted<T>` is `Readable<T>` at arity one, because a failed read rendering as
  "0% agreed" is bad news nobody measured. Tuning — the prompt, the bands, the
  keyword rules — comes as a proposal once there are rows to make one from.
- **A silent fallback is five failures, and until today only one of them could
  happen.** With no key every fallback was `no-api-key`, so "the matcher
  answered" and "nobody set the key" were the same fact. With a key live the
  expensive case is the one that looks like success: the key is present, every
  configuration check in the product reports it as fine, and every answer is
  still the matcher. `lib/ai/reason.ts` is the one `TriageReason` — it was
  declared twice and the copies had already drifted — and `fallbackCause` /
  `firedDespiteKey` in `lib/ai/accuracy.ts` group a reason into `noKey`,
  `keyRejected`, `providerFailed`, `answerRejected` or `notRecorded`. The card
  and `/admin/triage-accuracy` both read those two functions, so they cannot
  disagree about what counts as a live key.
  **`triage_logs.reason` is written now and was computed-then-discarded before**:
  it reached the browser for the badge and never the row, so nothing could count
  it. Null is "not recorded" and the fifteen pre-column rows are **not
  backfilled** — they almost certainly were `no-api-key`, and "almost certainly"
  is not a measurement. `LOGGABLE_REASONS` and the column's check constraint are
  one list written twice, so a test reads the migration and compares them: they
  would otherwise drift silently and fail on the first production request that
  produced the new value, losing the log row and the id that attributes the
  booking.
- **A provider error is classified by its prototype chain and its status code,
  never by `error.name` and never by `instanceof`.** Every Anthropic SDK error
  instance reports `name: "Error"` — the SDK sets `constructor` and leaves `name`
  alone — so the first `classifyProviderError` was dead code on every real error
  and survived only on status codes, with the timeout, which carries **no**
  status, resting entirely on a message regex. Found by constructing a genuine
  `AuthenticationError` in the test rather than a hand-rolled one; a fake sets
  `name` and would have proved a branch the real error never reaches.
  `instanceof` is refused separately: two copies of the SDK in one dependency
  tree have two class identities and it is quietly false across them. **A 401 or
  403 is `auth-rejected`** — a credential to rotate, and the one failure that
  reads as configured — where a 500 is `provider-error`. Collapsing them, which
  the old regex did, said "the model had a blip" about a key that will never work
  until somebody changes it.
- **"Present" is not "working", and `/api/health` said otherwise for months.**
  `checkTriage` was `Boolean(process.env.ANTHROPIC_API_KEY)`, so a revoked,
  mistyped or out-of-credit key reported `ok` while every triage was the
  matcher — the same shape as the sign-in outage: a dependency in somebody else's
  dashboard, a check looking at the wrong thing, and a product that kept
  answering so nobody noticed. It stays `ok` rather than `unknown`, deliberately:
  `ok` is computed across every check to decide 200 or 503, and the product
  serves customers perfectly well with no key at all, so `unknown` would 503 a
  working product. **This file credited `sms.gateway` with having solved it the
  same way — "report `ok`, and name in the detail what is unproven" — and it had
  not**: that check read `unknown` the whole time, so the sentence describing the
  resolution was itself a comment describing behaviour the code did not have.
  **`triage.model` behind `?deep=1` is the only thing that asks the model**, one
  token each way, behind `CRON_SECRET` exactly like the OTP send; it reports the
  provider's own refusal sentence, and it uses `classifyProviderError` rather
  than a second opinion so it cannot disagree with what the rows say.
  **`triage.fallback` counts the last hour**, because a key can work for a probe
  and fail under load, and no configuration check can see that.
- **The dev badge.** A silent fallback is indistinguishable from a working
  product — with no API key every triage still answers. The card carries a
  small line saying which path served it and why (`no ANTHROPIC_API_KEY`,
  `timeout`, `the reply failed validation`…). It shows in development, and
  anywhere with `?debug=triage` on the URL, because this branch deploys to
  production and a strict production check would hide it exactly where it is
  needed. Ordinary visitors never see it.

**`lib/mock/` is empty, and that is the point.** It held `activityFeed.ts` and
`categoryStats.ts`, and both were rendering on the live homepage: a feed of
invented customers in real Kathmandu wards with a hardcoded "3 minutes ago", and
"312 booked this week" against 14 real bookings. They contradicted everything
underneath them — a product that refuses to print `0.0` for an unrated
professional and gates 36 invented durations was naming invented customers on
the first screen anybody sees. The slots were **filled, not emptied**:
`components/marketing/promise-strip.tsx` and the researched price floor on each
category card, both true on day one. The Phase 8 realtime shape is recorded in
that component's comment so deleting the ticker did not lose it. If a mock file
is ever added again it states in a comment what replaces it and when — and it
does not render to a customer.

**And both numbers are real now, both with a floor.** `lib/data/activity.ts`
holds them, cached across visitors for fifteen minutes rather than per request —
`categoryBookingCounts` is the rolling seven-day count on each category card,
silent under `CATEGORY_COUNT_FLOOR` (20), and `recentActivity` is the strip,
silent under `ACTIVITY_FLOOR` (8). **A real number can still mislead**: "2 booked
this week" invites a conclusion about demand that a sample of two supports in no
direction, so below a floor the card shows only the researched price line it
already carried and the strip renders nothing at all.
The strip's select **is** the privacy boundary — first name, trade, city, and
never the ward, because "Anita in Baneshwor" narrows somebody to a few hundred
households. It is delayed an hour on the *completion* stamp, since a feed that
moves as somebody arrives tells a stranger that this household has a stranger in
it right now; the customer can opt out on `/account`; and a booking with a
guarantee claim or a disputed amount never appears, because nobody mid-complaint
should find that work advertised. **A cached read rather than a realtime
subscription, and the delay is what settles it** — with an hour's lag there is
nothing live to subscribe to, and a socket would put ~70 kB of supabase-js on the
landing page to deliver events the page must refuse to show.
**Its floor tests were blind first**: every case read `ACTIVITY_FLOOR`, so
lowering the floor to 1 left them all green — they asserted that the floor is the
floor. What the constraint actually says is that **one lonely entry is never the
feed**, and that is pinned as a behaviour now. Any test written against a
constant that the code also reads is worth this suspicion.

## Services and discovery

`categories` is the single source of truth for the ten services — the landing
grid, `/services`, the category pages and the price bands in the triage prompt
all read from it, so repricing happens once.

The authored copy is `lib/data/seed/*.json`. It seeds the tables
(`npm run seed:sql` regenerates the seed migration) **and** it is the fallback
every read falls back to when Supabase is unconfigured or unreachable. Edit the
JSON, re-run `seed:sql`, apply the migration — never edit the generated SQL.

**`providers.json` and `reviews.json` are empty now, and a fresh clone renders
an empty catalogue.** They held 28 invented professionals with invented ratings
and 94 written reviews from named customers. Deleting the rows from production
was not enough: every read falls back to this JSON when a query *errors*, so a
database hiccup would have put all 28 straight back onto a public page after we
had removed them. The cost is real and was taken deliberately — a new developer
with no keys sees a catalogue with nobody in it — and it is the right side of
the trade, because the alternative is invented people reappearing where
customers look. `categories.json` and `price-bands.json` are untouched: the ten
services and their researched bands are real.

**So an empty list and a failed read are now different screens.** They were the
same one while the fallback always had 28 rows to render. `/services` asks
`readDataSources()` and says "we can't load professionals right now — this is
us, not you" rather than offering to widen a search it could not run. Rule 6 in
the shape it takes for a screen: a failed read must never render as a measured
zero.

`lib/data/` is the boundary: `categories.ts`, `providers.ts` (list, one, counts,
reviews) and `ranking.ts`. Pages never touch Supabase directly.

**An embed names its foreign key, and an ambiguous one fails the WHOLE read.**
PostgREST refuses `profiles(full_name)` from `provider_reviews` because three
constraints join those tables — `customer_id`, `excluded_by`,
`homepage_hidden_by` — and the refusal arrives as a failed query, not as a
missing field. Three reads were written that way in one day and a fourth was
already live: the profile page's reviews list (which printed "No written reviews
yet" under a rating of 4.5 (1) on the public site), the homepage review wall and
`/admin/reviews` (both silent because a floor and an empty state render the same
nothing), and `openAmountMismatches`, where `bookings` reaches `providers` three
ways and the disputed-cash queue had been answering "we could not read it" since
the second of those columns was added. **Nothing in the suite could see it**: the
db tests speak to Postgres directly, where the ambiguity does not exist, and
`column-manifest.mjs` skips embeds by design. `tests/db/embed-ambiguity.test.ts`
derives every multi-FK pair from `pg_constraint` and fails on an unqualified
embed of one — it found the fourth on its first run. The correct form was
already in the tree, in the select directly above one that broke:
`profiles!bookings_customer_id_fkey(…)`.

**And a failed read must not render as an empty catalogue, which is what hid
it.** `getProviderReviews` collapsed an error into the empty seed and returned
`Review[]`; it returns `Review[] | null` now, and the page says "we can't load
the reviews right now — this is us, not you". The signature is worth knowing:
0 reviews beside a non-zero `rating_count` can ONLY mean the query failed,
because both count the same published rows — and that contradiction was on the
live page, in a sentence that read like ordinary copy.

**The fallback is a blind spot, so it announces itself.** The seed and the
tables hold the same rows, which means a broken query renders a page that looks
perfect. Every read records which path it took (`lib/data/source.ts`) and
`?debug=data` prints it — `categories: database · providers: seed`. Same rule
as the triage badge: dev, or the query param on any deployment. If you add a
read to `lib/data/`, call `markDataSource` on both branches.

**The catalogue never asked whether anybody could do the job.** `canServeAt`,
`hasRoom` and `providerCapacity` all existed and ran at claim time only, so the
list could rank first somebody whose window was already sold — the customer taps
and `enforce_slot_capacity` refuses. `jobFit` (`lib/provider/fit.ts`) asks it
once for every surface, composing those same functions rather than forming a
second opinion. **Three answers**: `ok`, `caution`, `blocked`, because
`blocksBooking` already knew that being on a job now says nothing about
Thursday. **The row is never dropped** — it stays carrying its reason and sorts
below the plain yeses, since a list that quietly got shorter reads as a
catalogue with nobody in it. One exclusion is silent and only one: somebody who
already refused this job, who cannot be reassigned anyway. **Being outside the
ward is deliberately not a fit reason** — proximity is already a weight and
`reach` already shows it, so gating on it would count it twice and shrink the
list for whoever has fewest professionals nearby. Fit outranks a customer's own
sort where the newcomer slot does not: "cheapest first" orders the options, it
does not ask to be shown ones the database refuses.

**Half the relevance blend separates nobody right now, and `/admin/signals` says
so.** `rating` carries 0.30 and returns the prior for all but one listing;
`completion` and `response` sit at their sentinels for nearly all of them.
**The counts this paragraph used to carry — "29 unrated of 30" — were stale by
24 listings** and had been since `providers.json` was emptied: read live on
2026-10-12 there are **6 listings, 2 of them neither removed nor closed, and 1
rated**, against 14 bookings and 6 completions. `weightEvidence` reads the
database and was never wrong; the prose beside it was, which is the class this
file keeps recording. A number written into standing notes is a number nobody
re-measures, so the shape to prefer is the one the screen uses: say which way it
leans and let the screen carry the figure. `weightEvidence`
reports each weight beside how many listings have evidence, asking
`lib/provider/measured.ts` rather than re-deriving the test — that divergence
already happened once between the catalogue card and `scoreParts`. **`volume` at
zero jobs is measured**: none completed is a fact, and calling it missing is rule
6 upside down. Nothing there recommends a retune; it is the number to retune
from.

**A published band can be moved by a person now, and the statistic that proposes
one had no caller for four phases.** `proposeBand` was written, tested and
documented while the only way to change a band was editing the seed and running a
migration — `applyRedoRecovery`'s sin one module over. `lib/data/bands.ts` is the
caller, `/admin/bands` is the screen, and **the evidence is on it**: the sample,
the quartiles, how many jobs were capped at the Tukey fence, and whether
`MAX_REVISION_MOVE` bound the result. That last one is the easiest to omit and the
most misleading to: a capped proposal is one whose data asked for **more**, so
printed alone it reads as "the data says this" and somebody approves a step
believing it is the answer. Below the minimum sample there is no proposal at all,
only the count so far — rule 6, since a proposal of the current band would be an
endorsement nobody computed.
**A rejection is a decision with an effect, which is why it is stored.** A proposal
is computed on demand, so the same number returns on every visit and a number
offered weekly is a number approved out of fatigue. `category_price_revisions` is
append-only (`refuse_rewrite()`, like `security_events`) and a rejection suppresses
**that exact proposed pair** until the data moves. The rule is written down rather
than implied: `proposalSuppressedBy` suppresses only while the pair is identical
**and** the sample has not grown by half again. It needs no tolerance constant,
because `proposeBand` already rounds outward to Rs 100 — two proposals are either
the same published numbers or a hundred rupees apart — and the sample clause is the
escape hatch for a rejection that meant *too soon* rather than *wrong shape*, since
more data saying the same thing is no answer to "this category is two different
jobs". **Suppression is never silent**: the screen names the pair, the reason and
what would bring it back, because a hidden proposal and no proposal must not look
alike.
**`bookings.band_revision_id` records which decision a quote was framed by**,
frozen beside `band_min` by `freeze_booking_band()` and pinned on update the same
way, so a dispute can show the band in force and who approved it. **Null is "no
revision on record"** — every booking taken so far, plus every survey quote, whose
floor is the surveyed figure rather than a band we published — and nothing is
backfilled: a revision invented for a decision nobody took is the manufactured
clean record `profiles_record_role_change` refuses. **Rebuilding that trigger is
the policy trap one object type over**: it is defined in `20260913000003` and
redefined in `20260921000001`, and the first draft of `20261002000005` rebuilt from
the older text, silently dropping the survey branches and the `booking_band_bounds`
read. The fingerprint check caught it, not a reading. Rebuild from the LAST
definition.

**And "when may this be tuned?" is a number now rather than a judgement.**
Three loops are deliberately unarmed — the ranking weights, rotation among
near-ties, the triage prompt — each for the stated reason that a constant chosen
today would freeze a guess into the codebase as a standard. The cost of that
correctness was that the question lived nowhere and would be answered again from
scratch on the day the pressure to move a number is highest, which is how the
guess gets frozen in anyway, later and with less thought.
`lib/config/tuning-floors.ts` holds a floor per loop and `/admin/signals` prints
the distance. **Nothing there acts**: no floor gates a write, changes an order or
suppresses anything — `MIN_DURATION_SAMPLE` is a floor that fires and this is
deliberately not that, so reaching one is permission to start the argument rather
than its conclusion.
**Every number is anchored to something that already exists**, because a floor
invented to justify not tuning is the same frozen guess with the sign reversed.
Ranking is 20 listings with evidence PER WEIGHT, which is `bayesianRating`'s
prior one level up — listings rather than ratings, a separate constant because
they count different things. Rotation is a pool of 5 and offers **derived** as
`10 × pool`, from the rule that one more offer must move the top share by less
than a tenth of an even split: a fixed offer count would be right for exactly one
pool size. Triage is 30 attributed bookings, `MIN_PROPOSAL_SAMPLE`'s upper end,
because the prompt is published copy.
**The screen reads the weakest, never the average.** A blend is retuned whole, so
ranking is ready when its thinnest tunable term is — averaging would let
`availability`, a stated fact measured for everybody, carry `rating` across a
line it is nowhere near. Rotation reports the category CLOSEST TO ITS OWN FLOOR,
since each pool size has a different one and rotation arrives one trade at a
time. And the pool gate is structural and comes first: a category with two
listings and a hundred offers is not nearly ready, it is not a rotation problem.
**A failed count prints as unreadable and never as zero** — rule 6 at its most
expensive on the one screen built to say how much is known.
**And the admin home says when one is ready**, which is why the computation
lives in `lib/data/tuning-readiness.ts` rather than inside the signals page: two
surfaces answering one question is how `countsAsEvidence` came to be written
twice, and a front page claiming ready over a screen reading "four short" is
worse than neither. **It is silent until a loop reaches its floor** — a
permanent "0 of 3 ready" is true every day for a year and stops being read,
which is `ACTIVITY_FLOOR`'s reasoning — and **a failed read is never ready**,
since a broken count putting that notice on the front page is an invitation to
move published copy on no data at all.
**It is a notice and not a queue.** There is no proposal to approve and no
button that moves a number: the proposal-and-approve screen (the `/admin/bands`
shape) gets built when the first loop gets CLOSE, not speculatively, because a
screen built against an imagined shape of evidence is a screen rebuilt the day
real evidence arrives.

**Concentration is counted before any mechanism.** `lib/data/concentration.ts`
gives the busiest professional's share of offers and of finished work per
category, with denominators — offers concentrating only matters if the work
follows. Rotation among near-ties is the likely answer later and its margin
should come from real numbers, so there is no threshold and no rotation today.

**A refusal reason is countable now, and the prose stays.** Both refusal paths
already captured free text and `provider_stats.declines` already counted
refusals; what was missing is that prose cannot be aggregated.
`booking_refusals.reason_code` is a closed set beside the text, **and the
provider decline panel offers it** — one tap, skippable, with the free text
still there for what the list did not anticipate. The column shipped one commit
before the capture did, which is `applyRedoRecovery`'s four-phase sin in
miniature: a column nothing writes to is not a feature. Skipping writes null,
because forcing a choice would push everybody onto `other` and make the count
meaningless — rule 6 in the shape it takes for a form. The chips are rendered
from `REFUSAL_REASON_CODES` and a test asserts the offered set IS the loggable
set, since a label added without the SQL would render a chip whose write the
check constraint refuses — losing the prose in the same statement. It is a **stated
preference, not a judgement** — "too far" is somebody telling us where they will
not travel, which the gate may act on later without anything being scored — and
`price` is never a signal against anybody, for the same reason
`category_pricing_signals` never is. Null is "not recorded", not backfilled.

**A booking that does not know which product it is teaches nothing, and 12 of
14 did not know.** Everything measured per sub-band reads `band_slug` — observed
durations, per-product bands, the multi-day span — and the "which of these is
it?" question existed **only on the triage card**. Anybody tapping a category on
`/services` reached a booking with no product and no prompt, and the AI ceilings
made that the common path by refusing the card to whoever was out of free
questions. The question is in the flow now (`step-problem.tsx`), asked once,
**skippable** — "not sure" writes null on purpose, because forcing a choice is
`booking_refusals.reason_code`'s mistake: everybody lands on whichever option is
least wrong and the column stops meaning anything. `/admin/signals` reports the
coverage with **the cutover derived from the first booking that recorded a
product**, never a date constant — `triage-accuracy`'s rule, since a rate
measured from an unverifiable date is one nobody can argue with — and survey
trades are excluded because they sell no products to choose between.
**A product now always records who named it**, refused by
`bookings_band_needs_source`. It is `NOT VALID`, which is the Postgres idiom for
"no backfill, and new rows must comply": one live row (`SK-RDKW7`) carries a band
with a null source, written two days AFTER the column existed because
`lib/data/claims.ts` copied a guarantee visit's band and not its provenance.
**`inherited` is a fourth value rather than the parent's own**: the model,
matcher or customer who named the original said nothing about the callback, and
a guarantee visit is the same fault revisited rather than fresh evidence about
that product — which is precisely the filter the duration loop needs.
**And the column's domain is not the list a browser may claim.** Those were one
array, so widening `BAND_SOURCES` for `inherited` silently widened
`createBooking`'s zod enum too — letting any browser assert its own fresh booking
was inherited. `REQUESTABLE_BAND_SOURCES` is the subset a request may carry, and
the split was forced by a test that pinned the other list's exact contents. It is
the same shape as the bug that test already records, reversed: there a schema
nobody widened refused a real value; here a schema widened for free would have
accepted a false one.
**`professional` is the fifth, and it exists because the other four can all come
out empty.** "I'm not sure" writes null on purpose and the category picker asked
nothing at all, so a job can be booked, worked and finished with no product —
teaching the duration loop, the per-product bands and the span nothing, and
holding a flat two hours whatever it turned out to be. The person who just did
the work knows. One tap on their job card (`NameBandPanel`), recorded as its own
source rather than as `customer`, because who said so is what a provenance column
is for: somebody standing in the room after the work is better evidence than a
guess from somebody describing it beforehand, and folding the two together loses
that for ever. **No "not sure" option here**, which is the opposite of the
customer's version of the same question and for the stated reason — the customer
genuinely may not know, so forcing them would land everybody on whichever option
is least wrong; the professional does know, and somebody who does not want to
answer simply does not tap. Nothing is stored for the absence.
**It is NOT the price correction**, and the two windows provably do not overlap:
`canProposeCorrection` needs a stated band and runs before work starts,
`canNameBand` needs a null one and runs from `in_progress`. A correction moves
the band and the customer must agree, because it is about money; this moves
nothing — `freeze_booking_band` pins `band_min` and `band_revision_id` on every
UPDATE and `booking_band_bounds` treats only `customer` as a stated band, both
read out of `pg_proc` before the panel was built rather than assumed.
**An estimate is what we said BEFOREHAND, so a late product gets none.**
`sync_booking_duration` copies the sub-band's researched figures whenever the
product is set, which is right at booking time and wrong at completion: writing
them with the answer in hand would mint an estimate that informed no scheduling
decision, and every estimate-against-actual reading would then be flattered by
rows that are really hindsight. The guard is `started_at`, not the status — up to
the moment work begins the estimate still has a job to do, because it is what the
scheduler holds.
**And the comment claiming the db suite compared the two lists was false.**
`BAND_SOURCES` said "one list written twice with `bookings_band_source_check`;
the db suite compares them" and nothing did — the class this file keeps
recording. `tests/db/price-correction.test.ts` compares them now, out of
`pg_constraint` rather than out of a migration file, because that constraint is
dropped and re-added by four different migrations as the list grew.

**The duration loop is armed, and it acts without a person.** All 36 sub-band
durations were authored `invented`, which is why no screen prints a length and
why `spansDays` holds every job to one day — and the way out, "observe them",
had no mechanism at all until now: `actual_working_minutes` was recording
elapsed time, `actual_elapsed_days` did not exist, and nothing read either.
`proposeDuration` (`lib/booking/duration-promotion.ts`) is the rule,
`sweepDurationPromotions` (`lib/data/duration-loop.ts`) is its only caller and
was written in the same phase, and `/admin/duration` is the screen.
**Acting unattended is a departure from `proposeBand` and the reason is
stated**: a band proposal may not apply itself because the band sets the quote,
the quote anchors what gets agreed, and the agreed figures are the rows it reads
— it would be measuring its own shadow — and because it moves commission through
`max(final_amount, quoted_min)`. Neither holds for a duration: what we publish
changes what the scheduler RESERVES and not how long somebody is on the tools,
so the measurement is independent of the published figure, and no duration
touches a rupee. **The span is the one place that argument is weaker** —
`estimated_elapsed_days` generates `booking_days`, which is how much of a
professional's week is held — which is one of three reasons its floor is higher.
**Two floors, stated, and tested by the number rather than against the
constant**: 12 same-day completions for the minutes, 20 for the span. The median
only moves when a third of the sample is unusual, so 12 is lower than
`MIN_PROPOSAL_SAMPLE`'s 15-30 on purpose — a wrong minutes figure reserves 90
where 120 was right, and being slow to improve a reservation has a cost too.
20 for the span because a wrong one takes real bookable capacity invisibly, it
is the number a customer plans around, and its observation could be shaped by
what we scheduled. `ACTIVITY_FLOOR`'s blind tests are the reason the cases are
written as eleven-then-twelve rather than as `floor - 1`.
**A span rounds DOWN and minutes round to the nearest five**, and that asymmetry
is the span's whole safety: an under-reserved span shows up as a job running
over, which somebody notices, where an over-reserved one silently removes
capacity nobody can see. A product genuinely split between one day and two
resolves to one.
**No movement cap, where `MAX_REVISION_MOVE` holds a band inside a fifth.** That
cap exists because a person approves and a capped number is still judgeable;
nothing approves a duration, so capping would publish a figure the data did not
say with no screen showing the difference. The history is the guard instead.
**`duration_observations` is append-only (`refuse_rewrite`) and is the shadow
half as much as the record**: a sub-band below its floor logs what it WOULD
publish every night, so a figure can be watched converging for months. A row is
written only where there is evidence — 36 sub-bands times two kinds nightly with
nothing measured is 72 rows a day asserting nothing happened, and `cron_runs`
already records that the sweep ran. **The floor is frozen onto each row**, like
`commission_bps` onto a booking, so changing `MIN_DURATION_SAMPLE` later leaves
old readings readable rather than retrospectively wrong.
**`countsAsEvidence` is one filter with two callers**, and it had been written
twice for the length of one commit — the divergence `lib/provider/measured.ts`
exists to prevent. It excludes `inherited` (a guarantee visit is the same fault
revisited, which is what that value is for) **and a null source with it**: rule
6, since the one such row in production is itself a guarantee visit whose
provenance was never recorded, and reading null as "fresh" feeds the loop a
measurement nothing can vouch for.
**It rides on `/api/bookings/dispatch`** rather than taking a third schedule
Hobby does not have, on the booking cron rather than the payments one because
nothing it does touches money and `/api/payments/reconcile` is the route holding
the service-role key on a money path. **No time window**, where
`PROPOSAL_WINDOW_DAYS` is 180 for a band: a price is a fact about a market and
goes stale, how long it takes to clear a blockage is a fact about the work. What
would invalidate old observations is redefining a product, and that is a new
`slug`.
**And a person can overrule it in one action now, which is what acting
unattended was missing.** The argument for the loop publishing without approval
holds; what it did not give anybody was a way to disagree, so a wrong figure
could be changed only by editing the seed and running a migration —
`proposeBand`'s four-phase sin wearing a schedule. `/admin/duration` has a
button per published figure, `revertDuration` is the writer, and
`duration_reverts` is the append-only record. **What it reverts TO is read,
never chosen**: the promotion's own `duration_observations` row carries the
figure, the provenance and the sample in force the night the loop replaced them,
so there is no field for an admin to type a duration into — a box there would be
a second way to publish a number nobody measured, which is what `invented`
already means. **The revert row is written BEFORE the figure moves**, the
`trip_compensation` ordering: a record with no move is visible and harmless,
where a move with no record is undone by that night's sweep.
**Suppression is the part that does work rather than recording it.** The loop
acts unattended, so a revert with no suppression lasts until midnight — same
sample, same median, figure straight back up. `revertSuppressedBy` holds that
exact figure until the sample grows by half again, `proposalSuppressedBy`'s rule
one decision over, and `REVERT_SAMPLE_GROWTH` is a **separate constant** from
the band's rather than a copy: a price and a duration have different costs and
no reason to move together. It is **threaded into `proposeDuration`** rather
than checked beside it, so the sweep and the screen cannot disagree about
whether a figure is held — and the screen names the figure, the reason and the
sample that would release it, because a hidden proposal and no proposal must not
look alike. `suppressed` is a fifth `DURATION_OUTCOMES` value and counted
separately from `settled`: those are opposite facts about one figure, and
folding them would make a disputed number read as an agreed one in `cron_runs`.
**A failed read of the reverts stops the sweep** (`revertsUnreadable`) rather
than reading as "nothing reverted" — rule 6 in the shape where the absence does
real damage, since it would re-publish every figure a person has taken down.
**`to_source` admits `observed`, and a first draft refused it**: the reasoning
written down ("an observed target would read as settled and the loop would stop
looking") is simply not what `proposeDuration` does — `settled` needs the median
to EQUAL the published figure — and the rule would have made the second
promotion of any sub-band unrevertable.
**The forgotten-open job is two problems and only one is the median's.** A job
left open across nights contributes NO minutes at all — `record_booking_duration`
writes `actual_working_minutes` only on a same-day completion, because the nights
are inside the elapsed figure and we hold one start stamp rather than one per day
— but it does contribute a span, which is exactly the measurement the span loop
wants. There the median is the whole defence: three thirty-day readings in twenty
publish 1 day, where a mean publishes 5. Both halves are pinned, with the mean's
answer stated in the test so the difference is not taken on trust.
**And the professional naming the product at completion moves no figure, which
was argued from `pg_proc` and never asserted.** Every money column is now
compared across that write — `band_min`, `band_revision_id`, the quote, the
split, `payment_status`, `materials_rupees` — and the case that bites is the
relabel UPWARDS. **The intuitive version is blind**: every category's own floor
equals its cheapest sub-band across all ten, and that is what
`booking_band_bounds` returns for a booking with no product, so a re-derived
floor would produce the identical number — written that way first, it stayed
green through a break test that made `freeze_booking_band` re-derive on every
product change. `ACTIVITY_FLOOR`'s class, found the same way.
**The window is the application's rule and not the database's, and a test name
claimed otherwise.** "Refused outright once a band has been stated" passed while
the update it ran had plainly succeeded — the label moves, `canNameBand` is what
forbids it, and the only thing the assertion established was that the money had
not. Which is the fact worth having: even on the relabel the product forbids,
nothing a dispute is argued from changes.

**A rating remembers when it was earned now, and the two halves are compared on
one fixture.** `rating_avg` is `avg(rating)` over every published review ever
written, so somebody excellent two years ago and mediocre since reads the same
as somebody who improved — the customer is shown the average of two different
people. `rating_recent_avg` and `rating_recent_weight` on `provider_stats` are
the same rows weighted by age, halving every `RATING_HALF_LIFE_DAYS` (365).
**It composes with `bayesianRating` rather than replacing it**, because the two
answer different complaints: the prior handles a THIN sample, this handles a
STALE one, and a 5.0 from three reviews two years ago is both. The composition
is the part that is easy to get wrong — `rating_recent_weight` is an EFFECTIVE
count, not a row count, and it is what goes into the prior. Feeding the prior the
row count would leave twenty ancient reviews at full confidence while their
average drifted: the figure moves and the certainty behind it does not, which is
the worse half.
**A year, and the anchor is the other two windows in this product.** A band is
re-proposed over `PROPOSAL_WINDOW_DAYS` (180) because a price goes stale; a
duration has no window at all because how long a blockage takes does not. Quality
sits between them. **Halving faster is the real risk**, not slower: on a
catalogue this thin a six-month half-life lets one recent job swing somebody's
standing, which is the 5.0-from-three-friends problem through the other door,
and the professional can only answer it by waiting.
**Decay is continuous, never a cutoff.** A twelve-month cliff makes a review
worth everything on day 364 and nothing on day 366, so a standing lurches on a
date nobody can see — the unpublished threshold `/providers/standards` refuses to
have. And **a future timestamp is clamped to today on both sides**
(`Math.max(0, …)` and `greatest(0, …)`), because otherwise a wrong stamp buys a
rating.
**Both columns are nullable and null is "not computed"** — rule 6, and it bites
on day one: every row written before the migration is silent, and 0 would render
as the worst score a professional can have off rows that say the opposite.
**One rule written twice, deliberately, with the guard this product learned to
want.** Ranking needs it as an aggregate over a catalogue and the card needs it
as a rule over one listing, so `refresh_provider_stats` holds the SQL and
`recencyWeightedRating` the TypeScript. `tests/db/rating-recency.test.ts` runs
both over one awkward fixture — four years of ages, ratings that disagree — and
compares them, which is `materialsRead` and `enforce_claim_refund`'s arrangement
and the one that was missing when those two diverged. **A set of fresh fives
would agree under any curve including none**, which is why the fixture is not
one; proven by moving the SQL half-life to 180 and watching two cases go red.

**The ranking weights are a product decision and they live in one place** —
`RELEVANCE_WEIGHTS` and `EMERGENCY_WEIGHTS` in `lib/data/ranking.ts`, with the
reasoning next to each number. Rating goes through a Bayesian average
(`bayesianRating`, prior 20 ratings at 4.5) before it is weighted, which is what
stops a 5.0 from three jobs outranking a 4.8 from two hundred. Emergency gives
availability and response 0.65 between them. Change the numbers there, nowhere
else.

Filters live in the URL. The list is a Server Component inside `Suspense`, so a
filtered view is a shareable link, the only client JavaScript on the page is the
filter bar, and changing a filter shows skeletons rather than freezing the old
list. Nothing outside `Suspense` may await the provider query — that was the
first version and the skeletons could never appear.

`/book` is a Phase 6 placeholder, and it is in `PROTECTED_ROUTES` on purpose:
that is what makes a signed-out customer come back to _their booking_ after
logging in rather than to the homepage.

## Language

next-intl, `[locale]` segments, English and Nepali as equals. Every screen
shipped so far exists in both.

`i18n/routing.ts` is the contract: locales, default, `localePrefix:
"as-needed"` so English stays on `/services` and Nepali lives at `/ne/services`
— every link, test path and budget key from before the migration still
resolves. `localeDetection` is on, so a phone set to Nepali lands in Nepali;
an explicit choice writes the `sajilokaam-locale` cookie and wins after that.

- **Import `Link`, `redirect`, `useRouter`, `usePathname` from
  `@/i18n/navigation`, never from `next/link` or `next/navigation`.** One stray
  `next/link` drops a Nepali reader back into English and nothing fails.
  In-page fragments (`#services`) are plain `<a>` — they have no locale to
  carry. `redirect` is re-exported with an explicit `never` return type,
  because next-intl's is inferred through a factory and TypeScript will not
  narrow past it.
- **Route guards match the unprefixed path.** `stripLocale` runs inside
  `lib/auth/routes.ts`, so `/ne/account` is the same protected route as
  `/account`. `safeRedirect` returns an unprefixed path and the caller adds the
  prefix back. Missing that would leave the Nepali half of the product
  unguarded.
- **`middleware.ts` runs next-intl first, then the Supabase refresh**, and
  copies the auth cookies onto whichever response is returned. Dropping them on
  an intl redirect is how you lose a session on a language switch.
- **The catalogues are `messages/en.json` and `messages/ne.json`**, namespaced.
  `npm run check:messages` fails if they disagree on a key or an ICU
  placeholder — a missing key is not a build error in next-intl, it renders the
  key path into the page, in the language you are least likely to be reading.
- **Numbers are interpolated as strings.** `ne` formats `1234` as `१,२३४`, and
  a page mixing Devanagari prices with a Latin phone number, a 4.8 rating and
  an OTP is harder to read than one that picks a side. Messages take `{n}` (a
  pre-formatted string) for display and a separate numeric `count` only where a
  plural branch needs selecting. `formatNpr(amount, { locale })` swaps `Rs` for
  `रु` and leaves the digits alone. Devanagari numerals are used in prose
  counts (`६ अङ्कको कोड`, `४८ घण्टा`) but never for a value the reader has to
  match against something on screen.
- **Category and place names are data, not interface copy.** `categories`
  carries `descriptor_ne`, `description_ne`, `cta_label_ne` alongside the
  English; `categoryCopy(category, locale)` is the only thing that picks a
  side. Areas live in `lib/data/seed/areas.json` with `cityNe` / `nameNe`; only
  the word "Ward" comes from the catalogue.
- **Sentences that wrap a link use `t.rich`, not three fragments.** Nepali puts
  the verb last, so prefix/link/suffix has no shape that works in both.
- **Provider bios and reviews stay as authored.** They are user-generated
  content; translating them would mean inventing words a professional did not
  say. `/design-system` is English in both locales on purpose — a developer
  surface, `noindex`, and no customer reads it.

**Nepali is written, not translated.** Every Nepali string has to read as
something a Nepali speaker would have said unprompted. The test is not "does
this mean the English" — it is "would anyone say this". Concretely:

- **Rewrite the sentence, do not map it.** English coordinates with "and"
  where Nepali splits, and puts the verb early where Nepali puts it last. A
  line that preserves the English clause order is a translation even when every
  word is right. `home.lead` and `services.sortedForSpeedBody` were both fixed
  for exactly this.
- **A dictionary match is not a word choice.** "breadcrumb" → मार्गचिन्ह,
  "loosen a filter" → फिल्टर खुकुलो बनाउनु, "rate limit" → दर सीमा are all
  correct and all wrong. Ask what a Nepali interface would call the thing, or
  use the loanword people actually use.
- **Watch the register.** प्रत्यक्ष belongs to live broadcasts, आपत् to a
  calamity, फोन घुमाउनु to a rotary dial. Right meaning, wrong room.
- **Get the grammar right.** को takes the oblique कस- before a postposition
  (कसकहाँ). "Throughout" is भरि, never भर. लिङ्क, not लिंक. Postpositions bind
  to the Devanagari word before them ({area}मा) but take a space after Latin
  text.
- `npm run check:messages` carries a list of the specific mistakes that have
  already shipped, so none of them can come back. Add to `NEPALI_TRAPS` when a
  native reader flags something new.

Where a line genuinely needs a native ear rather than care — trade terms, the
safety copy, anything a frightened person reads — **the tooling counts it, the
handover does not carry the list.** The pass happens once before launch, not
per phase, and a backlog living in handovers is a backlog that is complete
until somebody forgets. `scripts/ne-review-scope.mjs` derives the scope from
namespace rules, so a string added under `booking.payment` tomorrow is in scope
the moment it exists; `npm run check:messages` prints the outstanding count on
every run, `npm run ne:review` prints the strings English-beside-Nepali grouped
by what getting them wrong would cost, and `LAUNCH-BLOCKERS.md §
nepali-native-read` refuses a launch build while any remain. A key leaves the
backlog by being added to `messages/ne-reviewed.json` — by hand, because no
rule can know whether somebody actually read something.

**Not all of it blocks a launch, and the split is a predicate over the tier each
rule already carries.** One entry over all 446 in-scope strings could not be
satisfied without reviewing admin copy no customer or professional will ever
read, which held the money and safety lines behind the staff ones — and the two
are not the same risk: an admin misreading a queue label costs a slower queue in
a room with somebody who can ask, where a professional misreading the cash-fee
line on `provider.money` loses money and trusts us less with nobody there to
correct it. `BLOCKING_TIERS` is `money`, `safety` and `legal` — 273 keys and the
four documents — and `staff` (173) is deliberately outside it. **It stays
counted and printed on every run, by `check:messages` and `check:blockers`
both**, because reclassifying is not the same as doing and a number that stops
being said out loud is one nobody closes. `check:blockers` reads the backlog
rather than the status line, so marking the entry resolved while a blocking
string is unread fails on every run and not only at launch — the same shape as a
`resolved` band over an `invented` seed. **A document is signed off by its path,
which was impossible until the split**: that file held `keys`, a document has no
key, and all four were listed as waiting for ever, so the half of the gate
covering the enforcement ladder and the legal pages could never have been
satisfied by anybody.

**Not everything in Nepali is a message key**, and assuming it was is how the
first version of that scope reported the enforcement ladder as reviewed when
nobody had opened it. `lib/content/pages/standards.ts` and the three files
under `lib/content/legal/` are long-form `{ en, ne }` documents; they are
listed as documents in the same module, because a section of prose is reviewed
or it is not and pretending it is forty strings makes the number meaningless in
both directions.

**The interface word and the search word are different words.** The interface
says प्राविधिक and सिकर्मी काम; people type मिस्त्री, कालिगड, plumber, धारा,
फर्निचर मर्मत. `lib/data/synonyms.ts` is the one table that maps what they type
to what we sell, and both surfaces read it — the catalogue search on
`/services` and the keyword matcher in `lib/ai/mockTriage.ts`, which folds each
alias in as a rule of its own so longest-match-wins already handles
"फर्निचर मर्मत" beating the bare "मर्मत" inside it. A generalist word is
genuinely ambiguous, so an alias lists several categories most-likely-first:
search shows all of them, triage takes the head. An alias only ever borrows a
category's _ordinary_ rule, never its emergency one — "plumber" is not a report
that anything is on fire. Add a word people turn out to use in that file and
both surfaces learn it.

`/services` search is a plain `<form method="get">` with no client component at
all, so a filtered catalogue is a shareable URL and the page still works on a
phone that never finishes loading a bundle.

Triage answers in the reader's language: the client sends `locale` with the
request, the prompt's one language instruction comes from `ANSWER_LANGUAGE` in
`lib/ai/copy.ts`, and the response cache is keyed by locale as well as text.
The deterministic half — the safety lines and the keyword matcher's
explanations — is passed in as `TriageCopy` rather than held in `lib/ai`, so
the browser has both languages before the request that fails is ever made.
`KEYWORD_RULES` matches Devanagari as well as Romanized input, because that
matcher is what answers when the key is missing and a Nepali reader would
otherwise have had a fallback in name only.

## Auth

Phone + OTP only. There is no email/password path anywhere in this product and
adding one would be a product decision, not a convenience.

**It was proposed once, for the admin panel, and refused — with the reason, so
the question does not get reopened from scratch.** The ask was a username and
password plus a sign-up page at `/admin`, because "needing an OTP every time is
inconvenient". Two things were wrong with it. The friction was misdiagnosed:
`stepUpFor` returns `enrol` for an admin with no authenticator, so `/admin`
bounces to `/account/security` on *every* visit until one is set up — no phone
code is involved, and once enrolled it is one offline code per eight hours.
And a public admin sign-up is not a convenience, it is a door anybody can walk
through to every customer phone number and identity document we hold. Admin
accounts are provisioned, never self-registered; a password would trade
something you hold for a secret that leaks from somebody else's breach. If the
real problem is signing in too often, the lever is session lifetime, not the
factor.

- `lib/auth/otp.ts` is the **only** file that talks to an SMS provider. Swapping
  Supabase's default sender for Sparrow SMS or Aakash SMS means reimplementing
  `sendOtp`/`verifyOtp` behind the same signatures — nothing else should know
  which gateway is in play.
- `lib/auth/routes.ts` is the single source of truth for public / protected /
  provider routes. `middleware.ts` reads it; so should anything else that
  guards.
- Redirect intent travels as `?next=`. Always run it through `safeRedirect()` —
  it comes off the query string and an unchecked value is an open redirect.
- Never import `@/lib/supabase/client` into anything the header renders. It
  pulls ~70 KB of supabase-js into the landing bundle. Sign-out is a server
  action for exactly this reason.

## Live tracking and the provider surface

Phase 8. A booking now moves with a real person on each end.

- **The socket is assumed to die.** `lib/hooks/use-booking-channel.ts` is built
  around that, not around the happy path: it re-reads the booking row on
  subscribe, on every re-subscribe, on `visibilitychange` back to visible, and
  on `online`/`focus`. A phone in a pocket loses its socket with no event at
  all, and a *missed* transition is the failure that matters — somebody who
  never sees "on the way" phones support, or assumes nobody is coming.
- **supabase-js is imported inside the effect.** It is ~70 kB and would have
  put `/bookings/[id]` over its budget. Dynamically imported it stays out of
  first load entirely, so the page paints and is correct on a connection that
  never finishes fetching it. Live updates are an enhancement, never the source
  of truth.
- **A status change refreshes the page, not just a badge.** The provider card
  appears at `accepted` and the payment panel changes at `completed`, and both
  are server-rendered — so the channel's `onChange` calls `router.refresh()`.
- **Motion is progression, not replacement.** One rail with a fill that travels
  over 600ms, plus a single `.animate-advance` pulse on the step being reached.
  A label swapping in place reads as a glitch; the eye cannot tell forward from
  re-render.
- **Nothing says "live" when it is.** A permanent badge is noise, and the
  Nepali for it (प्रत्यक्ष) belongs to television. The connection is mentioned
  only when it is *down*, because then the page may be stale.
- **The professional's phone is on `provider_contacts`, never `providers`.**
  `providers` is readable by `anon` — it is the public directory — so a number
  on it is a number on the open internet. The policy releases it only while a
  job of theirs is `accepted`, `en_route` or `in_progress`, and takes it away
  again at `completed`. Both ends of that window are in the db suite.
- **A professional withdrawing is not a cancellation.** Declining an accepted
  job returns it to `pending` and opens it immediately; only the customer may
  end a booking. It used to write `cancelled`, and the customer was shown
  "nothing is owed" on a job they still needed doing — nothing owed, and
  nothing happening. `accepted -> pending` and `en_route -> pending` are the
  only backwards moves in the machine and `isRelease` names them, because they
  read as a bug otherwise. `in_progress` is excluded: somebody is in the
  customer's house with the floor up, and walking out of that is a support
  call. The trigger clears `accepted_at`, `en_route_at` and `provider_id` on
  the way back — a stamp for an assignment that lapsed is a lie a report
  repeats.
- **`lib/booking/cancellation.ts` is the one cancellation rule.** The window
  *is* the policy: a customer may cancel until a professional sets off, a
  professional until they start work, support until the job is over. So
  cancelling is always free, and `fee` is always 0 — a fee on screen that
  nothing can collect is worse than no fee, and our money moves *after* the
  work. The columns exist so a fee is later a constant, not a migration.
- **Notifications carry a key, not a sentence** — `lib/notify`. A sentence
  written in English at event time cannot be read back in Nepali. Adding SMS or
  push in Phase 13 is one file implementing `NotificationChannel` plus a line
  in the registry; `notify()` never throws, because the event already happened
  and a dead gateway must not roll a booking back.
- **Availability is three facts and the verified one wins.** `providerState`
  (`lib/provider`) ranks `on_job_since` over `busy_until` over
  `available_until`, then falls through to the base on `providers.availability`,
  which is **written, never defaulted** — see rule 6. `setByArrangement` is the one write that states it — one call, because the
  screen used to fire two that raced. `scheduled` scores 0.35 against
  `busy`'s 0.15, because not having claimed today is not the same as having
  refused, and only one of those two is a statement about willingness to work. The first is ours, written by a trigger from booking
  status, and it is `en_route`/`in_progress` only — an `accepted` job on
  Thursday does not make somebody busy today. Being busy costs a professional
  nothing beyond not being shown as free: `/providers/standards` publishes
  "Turning work down. You are allowed to be busy" under *What is never a
  signal*, so no counter reads a busy window and none should be added. What IS
  measured is the opposite claim — saying you are available and not answering —
  and that stays in ranking, never in rating, because a busy plumber is not a
  worse plumber.
- **Silence is answered, not waited out.** A routine job holds with the chosen
  professional for 20 minutes, not an hour, and the customer can open it to
  everybody before that. `widenBooking` stamps `widened_by_customer_at` so the
  release trigger records no decline and writes no refusal row — the
  professional was slow, not unwilling, and can still take the job.
- **`/provider/jobs` is minimal and says so.** Phase 10 is the real dashboard.
  This is the smallest surface on which a booking can travel from pending to
  paid. An account not yet linked to a listing gets the exact SQL to link it,
  with its own id already filled in, rather than a dead end.

## Health, and the dependencies we do not own

Sign-in broke in production for a day. Supabase's Twilio credentials were
placeholder zeros, every OTP failed, and the product's whole response was one
red sentence that by design says nothing about the cause. It was found by a
person trying to log in.

The lesson is not "add a try/catch". **Every dependency this product has lives
in somebody else's dashboard** — a Supabase toggle, a gateway credential, a
Vercel variable. None is in this repository, none is covered by `npm run
verify`, and any can be changed by somebody not looking at this code.

- **`GET /api/health`** is the one URL that answers "can this serve a customer
  right now". Public, cheap, sends nothing: auth config, database reachability,
  triage key. **`?deep=1`**, behind `CRON_SECRET`, additionally asks Supabase to
  send a real OTP to `SMS_HEALTH_NUMBER` — the only way to know a gateway's
  credentials are real. **It must be a real handset, and this file said the
  opposite** ("point it at a Supabase test number and it is free") for the whole
  life of the check. A test number is one GoTrue answers itself: it accepts the
  fixed code and never calls the SMS provider, so the probe gets its 200 and
  reports `ok` having touched nothing. That is the sign-in outage reproduced by
  the check written to catch it — the free version of this check proves nothing.
  One SMS per deep run is the price of the answer.
- **`unknown` is never `ok` — and the corollary was missed for months, which
  503'd a working product.** Not looking must never read as working; that is
  precisely the confusion that let this run for a day. The other half is that a
  check may only be `unknown` or `down` when a customer is actually affected,
  because `servesCustomers` (`lib/config/health.ts`) turns everything but `ok`
  and `skipped` into a 503. `checkTriageFallback` returned `unknown` under a
  comment reading "`unknown` rather than `down` when it fires… nothing is broken
  for a customer and a 503 would be a lie" — every word of the reasoning right,
  and the state delivering none of it, since unknown and down are the same
  verdict there. **It fired in production**: a live key, 4 of 4 triages answered
  by the keyword matcher, `/api/health` returning 503 while all four customers
  got an answer, which is what the fallback is FOR. Any monitor on that URL would
  have paged for a working product. `checkTriage` twenty lines away had already
  written the correct resolution down. The rule and both fallback states are
  tested constants now — **`/api/health` had no test of any kind before this**,
  which is how a comment describing behaviour the code did not have survived.
  **And the rule was still broken twice over when somebody finally read the live
  payload**: `/api/health` answered `"ok":false` on `f29583f` with every
  customer-facing dependency green. `session.config` was `unknown` "on purpose"
  and never varies, so **the endpoint returned 503 on every request ever made to
  it** — the monitor built to catch the sign-in outage could only ever have cried
  wolf — and `sms.gateway` was `unknown` for an unset `SMS_GATEWAY`, which is the
  configuration every code is sent under today. Both are `skipped` now, as
  `SESSION_CONFIG_STATE` and `SMS_GATEWAY_UNSET_STATE`, and the test that catches
  the class is the **whole live payload pinned as a fixture asserting 200** —
  thirteen per-check cases had all passed, because the sentence worth asserting
  ("a working product answers 200") is one no per-check case states.
  **`sms.gateway`'s comment also contradicted its own detail four lines down** —
  "every sign-in silently goes nowhere" against "Supabase's own provider carries
  the code". The detail was right: `lib/auth/otp.ts` calls `signInWithOtp`, and
  `lib/sms` is reached by `/api/sms/send` alone, which nothing is pointed at yet.
  It is `skipped` rather than `ok` because the comment describes a real world we
  cannot see from here — the day the Send SMS Hook points at us with
  `SMS_GATEWAY` unset, codes do go nowhere — and reading that hook needs the same
  management token `session.config` lacks. **`session.config` stays on the page,
  which was always its whole value** — JWT expiry and refresh-token rotation
  are dashboard settings and reading them needs a management token this
  product deliberately does not hold, so the line names the dimension and says
  where to look rather than reporting a number nobody verified. The observable
  half is `/account/security?debug=auth`, which prints `exp - iat` off a real
  token: per session, but the same number the dashboard holds. Before that line
  existed, nothing in the product mentioned session lifetime was a setting, so
  nobody could notice it had never been chosen.
- **The login screen never dead-ends.** `strandsCustomer()` decides when the
  failure is ours and unfixable by retrying, and then the screen offers a phone
  number instead. A mistyped digit gets the ordinary error — telling somebody to
  ring support when they need to retype a character is how a working product
  comes to feel broken.
- **`?debug=auth`** prints the provider's own status and message on the login
  form. Same rule as the triage and data badges: dev, or the query param
  anywhere. Finding this the first time meant reading a network response in
  DevTools, which nobody does on a phone.
- **A debug channel is only as good as the narrowest swallow between the
  provider and the screen, and swallows come in pairs.** MFA enrolment failed
  in production showing "That did not start. Try again." and nothing else. It
  took three commits to get Supabase's actual sentence onto a screen: the
  server-side `catch` discarded it, and after that was fixed the CLIENT-side
  `catch` in the same flow discarded it too — missed while writing the comment
  about the server one. The sentence was `500 Error generating QR Code`, and it
  had been available from the provider the entire time. So when a failure is
  opaque, fix **every** catch between the provider and the pixel in one go and
  check the reason actually renders before shipping; a half-opened channel
  reads exactly like a closed one and costs another round trip through a
  deploy.
- **Phone-only means fields other products rely on are empty here, forever —
  and one of them had to be filled in, which is a footnote to that rule and
  not an exception to it.** That same bug was GoTrue building
  `otpauth://totp/{issuer}:{label}` for the authenticator QR, where the label
  is normally the user's **email** — and every account in this product has
  `email = null`, because phone + OTP is the only way in.
  `lib/auth/mfa.ts` passes `issuer: site.name` explicitly, and that was only
  half of it: the **label** was the empty half, and enrolment answered
  `500 Error generating QR Code` for every account through four deploys.
  `authenticatorLabel` writes `{phone}@phone.invalid` onto the row the first
  time somebody enrols, and leaves a real address alone.
  **`.invalid` is reserved by RFC 2606 and can never resolve**, which is the
  whole reason for that domain: the address is a label inside a QR code, never
  a way in. No password exists on any account, and a magic link sent there
  could not arrive even with the Email provider switched on — so phone + OTP
  stays the only authentication path in fact and not only in intent. The write
  is service-role, because `auth.updateUser({ email })` starts an email-CHANGE
  flow that confirms to an address which by construction cannot receive
  anything. Before using any provider feature that takes an identity for
  granted, ask which column it reads: `email` is null on every row until
  somebody enrols a second factor.
- **`site.supportPhone` is one constant.** It appears on five screens and one
  of them is that fallback — the screen somebody reaches when nothing else in
  the product is working for them.
- **A scheduled job records that it ran, because nothing else could say so.**
  `/api/payments/reconcile` runs `sweepRedoRecovery`; with no debt outstanding a
  correct run writes nothing, so "ran and had nothing to do" and "was never
  invoked in the life of the product" left byte-identical traces. Three oracles
  were tried and each failed differently: **the Cron Jobs dashboard has no
  last-run column** (it proves the jobs are registered and enabled, and nothing
  else); **Hobby's runtime log is a short retention window**, so the 03:00–04:00
  UTC run is long gone by the time anybody looks and an empty thirty-minute view
  reads exactly like a job that never fired; and **the database shows nothing**,
  because that is the premise. `cron_runs` is the record — append-only for every
  caller including the service role, like `security_events`, since the whole
  value is that "it ran" cannot later be tidied into "it did not". Both routes
  record on success **and in a catch**, because a job failing every night would
  otherwise look exactly like a job nobody scheduled. `CRON_JOBS` in
  `lib/config/cron.ts` is one list written three times — here, `vercel.json`, and
  the check constraint — so a test compares all three: a cron added without a
  recorder records nothing, and a recorder the constraint does not know loses the
  row in the same statement that writes it. **Null in `ok` is "nobody said", not
  "it failed"**, and **no recorded run is not "it never ran"** — the table ships
  after the product, so every earlier run is silent. `cron.runs` on `/api/health`
  reports `ok` even when a job is stale, deliberately and consistently with the
  fix above: a dispatch sweep that has not run is a real problem and is not the
  question "can this serve a customer right now". Which jobs are urgent enough to
  503 is a threshold nobody has runs to choose yet, so it measures and does not
  grade.
- **Whether the probe could run at all is readable for free.** `SMS_HEALTH_NUMBER`
  was set in Vercel and nothing in the product could say so — set or unset,
  Production or Preview-only, visible to the running build or not, in a form the
  probe can send or not. All four sat behind one line reading
  `sms.gateway: credentials present`, so the first signal telling them apart cost
  one SMS and a shell with a credential in it; answering it took the Vercel API,
  which the person who set the variable does not have. `auth.sms.probe` is the
  cheap half: public, sends nothing, and says which of those four it found.
  It is **always `skipped`** — `servesCustomers` would 503 on anything else and
  nobody signing in is affected by an unset health variable, which is the
  `checkTriageFallback` mistake; and it may never be `ok`, because a parseable
  variable is not a delivered message. `SMS_PROBE_STATE` is a constant for the
  same reason `FALLBACK_FIRING_STATE` is: the first version of its test built
  `state: "skipped"` itself and would have stayed green with the route reporting
  `down`. **It never prints the number** — a real handset on a public endpoint —
  and `smsProbeReadiness` is one sentence with two callers so the free line and
  the one that costs an SMS cannot drift.
  **And the `deep=1` 401 says which refusal it is**: an unset `CRON_SECRET`
  means no token will ever work, which used to read exactly like a mistyped one.
- **`payout.sealing` applies the `SMS_HEALTH_NUMBER` lesson before it costs
  anything.** A `PAYOUT_ENCRYPTION_KEY` that is set but truncated is
  indistinguishable from a working one everywhere a person can look: Vercel
  cannot read a sensitive variable back, the build succeeds, every page
  renders. The first signal would be a professional failing to save where they
  are paid, with an error that reads like a bug in the form. So the check is
  **three-way** — unset, wrong length, ready — because "nobody set it" and
  "somebody set it wrongly" are different jobs, and a boolean collapses them.
  It reports the **length** and never the key, since a length is what tells
  somebody they pasted 24 characters of a 44-character value. It is `ok` only
  on a key of the right size — a present key reported as working is
  `checkTriage`'s months-long mistake — and its detail says that even then,
  whether a *stored* value opens again is only proved by reading one back.
  Never `down`: a missing sealing key stops nobody booking a plumber, so
  `SEALING_NOT_READY_STATE` is `skipped` and cannot 503 a working product.
- The SMS gateway is a **launch blocker** until `?deep=1` reports
  `auth.sms: ok` against production. The dashboard looked correct the whole
  time it was broken.
  **It has now been run, and it caught exactly what it was built to catch.** On
  `36a11f2`: `auth.sms: down — 422: Error sending confirmation OTP to provider:
  auth account AC00000000000000000000000000000000 does not exist`. Twilio 20003,
  and the Account SID is `AC` plus thirty-two zeros — so the credential was never
  entered rather than rejected, and the August incident's placeholder is still
  sitting there untouched. **No real phone can sign in to this product today**;
  every walkthrough runs on the Supabase test numbers, which GoTrue answers
  itself without calling a provider, which is why nothing has ever looked wrong.
  `ok: false` is honest now — `auth.sms` is a genuine customer-facing fault,
  where the two states this endpoint used to fail on were not.
  **The gateway is contracted last, deliberately**, after the design and
  development still ahead: it costs per message and needs a registered Nepali
  sender ID. The cost of that ordering is written into `LAUNCH-BLOCKERS.md` so it
  cannot later read as an oversight — and so that no amount of using the product
  on test numbers is mistaken for evidence the gateway works.
  The same run proved the other half: `triage.model: ok — claude-sonnet-4-6
  answered in 1374ms. The key works.`

## Dispatch — a job nobody accepts

The booking page says "we are alerting professionals now". `lib/booking/dispatch.ts`
is what makes that true; before it, a booking sat assigned to the one person
the customer picked and waited for ever if they never opened the app.

- **Three stages, driven by the booking's age alone** — first refusal, open,
  give up — so the sweep is idempotent and can run late, twice, or overlapping
  without changing anything.
- **Urgency sets the clock.** Emergency opens in 5 minutes and gives up at 45;
  routine holds an hour and gives up at a day. These are product promises about
  how fast the product moves, which is why they are named constants and not
  inline in a cron job.
- **The customer's choice survives the widening.** `first_choice_provider_id`
  is kept when `provider_id` is cleared, so "I asked for Krishna and Sita came"
  is answerable, and Phase 10's reliability score has something to read.
- **The claim is a race settled by the policy, not by a read.** Its `using`
  clause matches only rows still unassigned, so the second claimant updates
  zero rows. Checking "is it taken?" and then writing is the gap that sends two
  professionals to one house.
- **"Check now" and the cron run the same code** — `applyDispatch` in
  `lib/data/dispatch.ts`. Two implementations of an escalation rule escalate
  differently depending on who asked, and the difference stays invisible until
  somebody's emergency sits unwidened. The button needs no `CRON_SECRET`
  because it is scoped to one booking the caller owns and can only apply what
  was already due: tapping it early reports "still with your professional" and
  moves nothing.
- **A refusal is a fact about the professional, not just about the booking.**
  Declining is allowed — forbidding it produces people who simply never turn
  up — but it is counted. `booking_refusals` holds one professional saying no
  to one job and is written by a trigger, so every release path records it and
  not just today's button. It is what stops a refused job being offered
  straight back to the person who refused it (the open-job policy reads it),
  what keeps them out of the customer's replacement list, and what
  `enforce_booking_immutability` checks before letting any caller assign them
  again. `provider_stats.withdrawals` and `.declines` are the same fact counted
  for ranking, and `withdrawalRankingPenalty` in `lib/data/ranking.ts` is where it
  costs list position — a rate with a prior, subtracted rather than blended in,
  because the six weights describe how well somebody works and this describes
  whether they show up.
- **A withdrawal is answered with names, never with "we are looking".** The
  customer's booking page reads its refusals; if there are any, it shows three
  ranked alternatives with one tap to book each, and a phone number when there
  are none. `lib/data/recommendations.ts` is the rule — ward first, then the
  rest of the city, then anywhere, each suggestion carrying how far it reached
  — and re-picking sets `reassigned_at`, which the dispatch clock is measured
  from. Without that anchor the next sweep would widen the job away from
  somebody the customer chose seconds earlier.
- **`provider_can_serve` is `security definer`** because a policy on `bookings`
  that reads `addresses` re-enters `bookings` through *its* policy — the same
  recursion `is_admin()` exists to break, found the same way.


Our model is not a checkout. The quote is a **band**, the final figure is
agreed on site, and money moves **after** the work is done. Everything below
follows from that.

- **The dangerous surface is the final amount, not the gateways.** It is typed
  by a professional standing in somebody's kitchen with the customer watching.
  `lib/payments/pricing.ts` is the rule and it has three outcomes: inside the
  quoted band it is confirmed (asking a customer to re-approve what they
  already agreed teaches them to tap through approvals); above the band up to
  **2× the quoted max** the customer must approve and the professional must
  give a reason, which is stored; above 2× nothing can be approved in-app at
  all. 2× is chosen so an honest overrun fits and a mistyped extra zero — 1,500
  becoming 15,000 — cannot. It is a customer protection, not a tuning knob.
- **The fee is charged on `max(final_amount, quoted_min)`, and that is the
  whole answer to under-reporting.** A professional who takes Rs 2,000 in cash
  and records 1,000 satisfies every validation this product has — the figure is
  in band, the customer is standing there, no server saw the notes. Policing
  the number is chasing the symptom, so the payoff is removed instead: the band
  is ours and frozen onto the booking, so reporting less earns nothing.
  `settleSplit` is the one implementation; the fee is capped at what was
  collected so an earning is never negative. An honest small job appeals
  (`commission_appeals`, one per booking, decided by a person), and a whole
  category bunching under its floor is **our** mispricing —
  `category_pricing_signals` counts it per category and never per person,
  because read the other way it becomes a list of people to punish for our own
  wrong price.
- **For cash the customer states the amount, they do not approve ours.**
  `blindCashEntry` hides the professional's figure whenever it is inside the
  band; over-band figures were already explicitly approved, so hiding them
  would be theatre. A mismatch settles nothing — both numbers are kept,
  `amount_mismatch_at` is stamped, both sides are told, and a person decides.
  The screen carries the sentence that makes blind entry honest: *your
  guarantee covers up to the amount you enter*. That belongs on the screen, not
  in the terms.
- **The guarantee is a re-do, never an automatic refund, and the visit is what
  verifies it.** `lib/config/guarantee.ts` is the rule. The window is per trade
  — 30 days for a repair, 90 for painting, 48 hours for a clean or to report
  transit damage — because one number across ten trades is meaningless for
  cleaning and arbitrary for painting. Every claim sends somebody, and the
  attending professional's verdict decides who pays: *same fault* is unpaid and
  falls on the professional whose job it was; *different problem*, *nothing
  wrong* and *customer-caused* are ordinary bookings at the ordinary price. The
  customer agrees to that sentence before we dispatch anyone, so nobody is
  surprised by a bill. **This is the anti-farming design and it is the whole
  reason the policy is shaped this way**: the version that pays out
  automatically after two failed visits is a repeatable route to free work for
  anyone willing to report a *different* problem each time in the same trade —
  the same class of mistake as under-reporting on the provider side, a rule
  whose payoff is worth gaming. A re-do costs us almost nothing because the
  labour is the professional's; a refund costs real money, so **no verdict, and
  no combination of verdicts, produces a refund without a person** — capped at
  the recorded amount, funded from the first professional's earnings.
- **The guarantee outlives the payout hold, so we net forward and never chase
  backward.** The window is 30–90 days; the hold is 24 hours to 7 days
  (`PAYOUT_RULES`). For most of the window there is no payout left to withhold,
  and the first draft of the policy claimed there was. Three cases and only one
  moves money: the original professional goes back themselves and nothing is
  paid to anybody; **or** somebody else attends, is paid in full for real work,
  and that amount becomes a debt netted off the first professional's *future*
  earnings by `applyRedoRecovery` at **at most a quarter of any one payout**
  (`redoRecoveryCapBps` 2500), so no week goes to zero. **That netting is
  wired now and was not for four phases** — `applyRedoRecovery` was written,
  tested and documented in three places with no caller anywhere, so
  `provider_outstanding` only ever went up and every refund was money gone,
  while `/providers/standards` already told professionals the balance was one
  "you can watch going down". `sweepRedoRecovery` in `lib/data/recovery.ts`
  runs from the reconcile cron. **A payout is a settled booking whose
  `payout_due_at` has passed**, because there is no payout table and no payout
  run — that is the unit the published quarter is measured against, and
  recovering against one booking twice would take half a payout from somebody
  promised a quarter. `provider_ledger_recovery_once_idx` is what makes that
  impossible: a partial unique index, the same idiom as `our_reference`, so a
  concurrent sweep is refused by the database rather than remembered against by
  the application. **The balance is read once per professional and carried
  across their several due payouts** — reading it per booking takes a quarter
  twice out of a debt that had a quarter left, and the ledger still balances
  afterwards, which is why that case is pinned in `tests/db/redo-recovery.test.ts`.
  **`write_off` is written now too**: `sweepWriteOffs` clears a balance after
  `writeOffAfterMonths` (12) with no completed job and closes the listing. The
  clock is the last completed job, never the last login — a balance only ever
  arises from a claim on a finished job, so that anchor always exists.
  **Closing is a third state and not removal**: `providers.closed_at` +
  `closed_reason` carry no finding against anybody and coming back means
  re-applying, whereas `removed_at` is step 5 of the ladder and is for cause.
  The schema already warned about exactly this conflation — "taking a break"
  and "removed for cause" are not the same state — and writing one for the
  other would put a false accusation into every future report. Only listings
  **carrying a balance** close this way; a quiet professional who owes nothing
  keeps their listing, because a general dormancy policy is a different
  decision needing its own copy. **Carrying a balance is published under *what
  is never a signal***, not as a sixth step: it is money owed, not misconduct,
  so it never moves anybody down the list; **or** they never work
  for us again and it is **written off**. The write-off is the real cost of
  offering a guarantee and it is bounded, but **the bound is 5.7 jobs' worth of
  commission, not the three or four this line used to claim** — and the ratio
  is a constant rather than an estimate. A full refund returns our whole fee,
  so what is left as debt is exactly the professional's share: at 15% that is
  0.85/0.15 = **5.67× the fee we earned on that job**, and on digital's 13% it
  is 0.87/0.13 = **6.7×**. It does not vary with the size of the job, which is
  why it is worth stating as an identity: every full refund costs the
  commission from between five and seven jobs of the same kind. **We never ring a paid-out professional for cash.**
  There is no card on file, no direct debit and no wage to garnish, so backward
  recovery selects against the wrong people: the honest ones feel robbed and
  leave, the rest stop taking our jobs and keep the money. Half a payout was
  considered as the cap and rejected for the same reason. Extending the hold to
  cover the window is also refused — nobody works for a platform that pays in a
  month, and it would punish the many who never generate a claim. **Consequential damage is excluded in plain words on
  a page anybody can read** (the leak's water, the outage's spoiled food); that
  single line is what keeps liability bounded on a 15% commission. Claims are
  limited to two per booking, one open at a time, on a finished and settled
  job. A customer claim-rate signal is Phase 11 and triggers **review, not
  punishment** — never a ban and never a ranking, for the same reason
  `category_pricing_signals` is never grouped by person.
- **A payout is a tranche now, and it was a booking.** The guarantee outlives
  the payout: `GUARANTEE_WINDOWS` gives painting 90 days, `PAYOUT_RULES` holds a
  payout for 24 hours to 7 days, so on the trades where a defect surfaces late
  every rupee is gone before anybody can claim. `payoutPlan` holds
  `guaranteeHoldbackBps` (2500) back for `holdbackDays` (30) wherever the window
  is `holdbackWhenGuaranteeDays` (90) or more. **It is a narrow version of
  something this file records as refused** — extending the hold to cover the
  window, because nobody works for a platform that pays in a month — and it
  differs on all three counts that refusal turned on: a quarter not everything,
  30 days not 90, one group of trades not every job.
  **The trigger is the window, not the trade**, so a future long-window trade is
  covered the day it is added; `holdbackTrades()` enumerates the derived rule and
  `/admin/signals` prints it, because a rule nobody can read back is one we guess
  about later. `/providers/standards` publishes it in those terms too.
  **It defers, it never deducts**: the two tranches sum to the whole earning and
  the customer's price is untouched. Null means "no hold here" and 0 would mean
  "held, and it rounded to nothing" — rule 6 — so `payoutPlan` returns null
  rather than creating a second date for zero rupees, and
  `bookings_holdback_shape` keeps the pair together.
  **The published quarter is a quarter of each tranche**, measured on the money
  arriving that day; taking a quarter of the whole earning out of the smaller
  first tranche would be a third of what lands beside a page promising a quarter.
  **Changing the unit broke an index silently.**
  `provider_ledger_recovery_once_idx` was unique on `booking_id` alone and
  `sweepRedoRecovery` filters bookings out *before* attempting an insert — so a
  released holdback would have been paid whole with no row, no unique violation
  and nothing logged. It is `(booking_id, tranche)` now, the filter keys on the
  pair, and the test proves it by restoring the old index.
- **And the chain is closed now: there IS a payout table and a payout run.**
  `settleSplit` froze a split, `payoutDueAt` dated it, `payoutPlan` tranched it,
  `applyRedoRecovery` netted a debt forward and `provider_ledger` recorded all of
  it — and nothing grouped those earnings into a payment, nothing sent money and
  nothing recorded that it had. Every link was built and the chain was open, which
  is `applyRedoRecovery`-with-no-caller at the scale of a product.
  `lib/data/payouts.ts` is the only writer of `payouts` and holds the service-role
  key on a money path, so treat an edit there the way you would treat
  `lib/data/payments.ts`.
  **A payout is a period, not a booking**: one professional, one week, one net
  figure — the two-way sum of what we owe them on digital jobs and what they owe us
  in commission on cash ones. Paying per booking would mean a transfer fee per job
  and a statement nobody can reconcile against a week's work.
  **The run only ever creates drafts and that is structural, not a habit.**
  `payout_transition_allowed` refuses `draft -> sent` however it is called, so no
  cron, no retry and no bug in the sweep can reach a rail. A person approves, sends
  and records what came back, on `/admin/payouts`.
  **Weekly lives in `isPayoutRunDay`, not in `vercel.json`** — Hobby has one
  schedule, and a day-of-week check in code is testable where a cron expression is
  not. So the sweep is safe to invoke on any day, twice or late, and returns
  `ranFor: null` on the other six days. It runs **last** in
  `/api/payments/reconcile`: a settlement reconciled a moment ago stamps
  `payout_due_at`, and a recovery takes its quarter off a tranche before that
  tranche is counted into a week.
  **The period names the payout; it does not filter the work.** Every tranche
  payable by the end of the period that has no ledger row yet is written, so a
  missed Tuesday catches up instead of losing a week for ever — nothing else ever
  looks at those tranches again. And the Tuesday run settles the week ending at the
  previous Monday 00:00 UTC, which is ISO weeks and not an off-by-one.
  **Digital and cash are not mirror images.** A digital job writes one `earning`
  per tranche, the money actually landing that date; a cash job writes one
  `commission_due` for the fee and no earning at all, because they already hold the
  notes — and its holdback columns are ignored, since there is nothing of ours to
  hold back. At `withholdingTaxBps` 0 **no `tax_withheld` row is written**: a row
  for zero rupees asserts a withholding was calculated.
  **The statement's lines need not subtract to its total, and the screen says so.**
  `earnings_rupees` and `commission_rupees` are what this run put into the account;
  `net_rupees` is the whole position, so a recovery, a week they owed us and
  anything held last Tuesday sit in the difference. `/admin/payouts` prints that
  difference as *carried* rather than hiding it — a figure somebody approves has to
  be checkable, and arithmetic that silently does not add up is worse than a third
  line.
  **At most one unresolved payout per professional**, refused by
  `payouts_one_in_flight_idx` rather than remembered by the application — found by
  re-reading the run's own diff rather than by a failure. `net_rupees` is the whole
  position, so a week drafted at 2,500 that nobody approves gets drafted again the
  next Tuesday with an unchanged `ledger_rows_at_draft`: two approvable rows for one
  sum, and each send writing its own `payout` row around a ledger that still
  reconciles. It costs something and the cost is deliberate: an unresolved payout
  stops the next week being drafted, loudly — the run counts it as `blocked` so a
  stuck week cannot look like a quiet one — and the way out is a person approving it
  or failing it with a reason.
  **A negative week drafts nothing at all**, for the same reason one level on: a
  payout row is an instruction to pay and a week they owe us is not one. The first
  version wrote a held `negative` row, which read tidily and would have blocked every
  later week until somebody failed it by hand — weekly busywork for a professional
  whose work is all cash, over a row nobody could act on. The ledger carries the
  balance forward because that is what a ledger does.
  **A held payout carries its reason and offers no button.** `heldReasonFor` is
  pure, in `lib/payments/destination.ts` beside `destinationReadiness` so a test can
  reach it — the judgement was first written inside the `server-only` module, which
  is the mistake this file records four times. Negative outranks every destination
  reason, because where they owe us their bank account is irrelevant; a **failed**
  destination read drafts nothing at all and is counted as `unreadable`, since
  writing it as `no_destination` would put a measurement into a column that had
  none.
  **The destination is re-checked at the approval and again at the send**, and this
  is the one hole the cooldown could not close by itself: a draft agreed against a
  confirmed account, then the address changed — which starts a fresh 72-hour window
  on the NEW row while nothing in the draft mentions an account. Without the
  re-check, an approval and a send would release digits for an address no window has
  elapsed on and no person has confirmed.
  **A stale draft is recomputed, never approved.** `payouts.ledger_rows_at_draft` is
  a row count, and it is a sound cursor only because `provider_ledger_append_only`
  refuses UPDATE and DELETE for every caller — the ledger can change in exactly one
  way, by growing. If that trigger ever goes, a row edited in place leaves the count
  identical and an approval pays a figure the ledger no longer supports, so the db
  test asserts the trigger rather than assuming it. The recompute writes to the same
  still-`draft` row rather than failing it, because
  `payouts_provider_period_idx` would otherwise block that week for ever.
  **Approve, mark-sent and mark-failed need a fifteen-minute `amr` proof**
  (`REAUTH_WINDOW_MINUTES`), deliberately not the eight-hour `STEP_UP_HOURS`:
  batched admin work and releasing somebody's week of earnings are different
  shapes. `markConfirmed` asks for no code at all — it records an answer that came
  from outside and moves no money, and a code demanded for a write that cannot cost
  anybody anything is how people learn to tap through the ones that can.
  **`sessionAuthenticatedAt` is re-exported from `lib/auth/session`**, which is the
  front door: the provider action had been reaching `lib/auth/mfa` through a dynamic
  `await import`, which the linter cannot see — a boundary evaded rather than
  respected.
  **The ledger total has to equal what was paid plus what is still owed, at every
  state.** `tests/db/payout-run.test.ts` checks both halves after the run, after an
  approval, after a send and after a `sent -> failed` reversal, summing the kinds
  independently rather than asking `provider_balance` twice — which would assert
  that a function equals itself. `provider_ledger_payout_once_idx` and its reversal
  twin are what make a double payment a database refusal rather than something the
  application remembers not to do; proven by dropping the index and watching the
  case go red.
- **The professional can see their own money now, and the figure they used to see
  was wrong four ways over.** `getProviderDashboard.owedRupees` summed
  `provider_earning` across every booking with `payment_status = 'paid'`, under a
  comment claiming it was "what is due but not yet released" — a comment describing
  behaviour the query did not have, which is the class this file keeps recording.
  There was no `payout_due_at` filter at all; **cash jobs counted as money WE
  owed**, when on cash the professional holds the notes and owes us the fee, so
  every cash job inflated it by a whole earning; the holdback split was ignored, so
  a quarter deferred for 30 days read as due now; and **it could never go down**,
  because bookings do not know about payouts — somebody paid in full on Tuesday saw
  the whole sum on Wednesday, while `/providers/standards` promises a balance "you
  can watch going down".
  `provider_balance` was already the right number and no screen was reading it.
  **`providerMoney` in `lib/data/payouts.ts` is the one money read**, and
  `/provider/payouts` owns the view: balance, the next Tuesday, each held quarter
  with its release date, the debt beside what has come off it, our fee on their cash
  jobs named as the other direction, and the payout history with its references.
  **The dashboard renders a summary of the same object and computes nothing**, which
  is what makes the two unable to disagree — `tests/unit/provider-money-one-source.test.ts`
  reads both page sources and fails on any arithmetic of their own, stripping
  comments first because naming `provider_earning` in order to warn about it is
  documentation and not a read. A failed read is its own sentence and a professional
  with nothing settled is told there is nothing to measure, never shown Rs 0.
- **A blocked payout is visible on both sides, because a guard whose cost only
  shows in a log is how a week becomes a month.** `payouts_one_in_flight_idx` stops
  a second unresolved payout — which is what keeps two drafts from describing the
  same money — and the cost is that an unapproved draft stops the next week being
  drafted for that professional. `/admin` has a `payouts` card **carrying the age of
  the oldest draft**, the only queue there that reports one, because a count says
  whether there is a backlog and only the date says whether it is this morning's run
  or a month of silence. `AdminQueueCount.oldest` and `.total` are **two different
  nulls that must not collapse**: `total` null is a failed count, `oldest` null is
  nothing waiting or no age reported, so a screen reads `total` first — the
  `/api/health` ordering between "not looking" and "nothing wrong". And `whyWaiting`
  (pure, in `lib/payments/destination.ts` beside `heldReasonFor`) gives the
  professional the sentence: held for a cooling or unconfirmed account, held because
  we were never told where to send it, or **waiting on us** — which is said as ours
  rather than coloured as their problem, because blaming somebody's paperwork for
  our queue is how a working process comes to feel arbitrary.
- **The guarantee is on the workmanship, so the parts come off the refund
  ceiling — but only on a recorded answer, and never by more than half.**
  `bookings.materials_rupees` is stated by the professional at settlement;
  `guarantee_claims.parts_failed` is recorded by the **attending** professional
  with the verdict, because a compressor that died and one fitted badly are
  different claims and only somebody in the room can tell them apart. Both are
  null by default and **null is "nobody said", never zero** — an unanswered
  parts question deducts nothing, because the answer reduces what a customer
  can be paid and a column nobody filled in must not act like one somebody did.
  `materialsRead` in `lib/payments/refund.ts` is the rule and
  `enforce_claim_refund` is the same rule in SQL; one fixture in
  `tests/db/guarantee-claims.test.ts` runs both and compares them, which is
  what was missing when those two last diverged.
  **The half cap is an anti-inflation gate and it was needed the moment
  materials touched the ceiling, not when the commission question is settled.**
  Nothing evidences that figure — there are no receipts here — and it now
  reduces what somebody can be asked to pay back, so it is worth inflating.
  What weakens that is only that the line is entered before any claim exists;
  that is a mitigation, not a control, and it disappears the day materials
  affect anything seen more often than a guarantee claim. The cap is never
  silent: the adjudicator sees what was entered beside what came off, because
  hiding the clamped figure would hide the one signal worth weighing.
- **The professional is paid for a wasted trip now, and the claim had asserted that
  payment since Phase 10 with no money behind it.** `settleNoShowClaim` wrote
  `no_show_claims.trip_rupees_paid = 350` under a column comment reading "What we paid
  the professional"; the terms say we pay it, `/providers/standards` says we pay it,
  the audit row said we paid it, and **there was no ledger row** — so nothing for the
  payout run to find, nothing in `provider_balance`, nothing on their own money
  screen. `owedRupees` and `applyRedoRecovery` were the first two of this exact shape;
  this is the third, and the pattern worth naming is that **a column whose name is a
  past-tense verb is a claim, not a payment** — `trip_rupees_paid`, like
  `trip_debt_added_rupees` will be, has to be read as "what we decided" and the money
  looked for separately.
  `trip_compensation` is the ledger kind, in `MONEY_KINDS` and deliberately **not** in
  `GUARANTEE_KINDS`: it is ours to them, and the matching debt is the *customer's* on
  `customer_risk.trip_debt_rupees`. If it ever reached `provider_outstanding`, paying
  somebody for a wasted trip would read as them owing us money and the redo sweep
  would recover it out of their next payout — the exact opposite of the promise, which
  is why that is pinned as its own db case.
  **The ledger row is written BEFORE the claim is marked upheld.** A failed ledger
  write leaves the claim open for a person to see again; the other order marks a
  payment nobody made, which is the state being fixed.
  `provider_ledger_trip_once_idx` makes a re-decided claim a database refusal rather
  than something the application remembers not to do, and a unique violation is read
  as "already paid" and allowed through so the claim row can catch up.
- **No no-show claim pays itself any more, and funding them is what changed.**
  `judgeNoShowClaim` had an `upheld` outcome that `claimNoShow` settled immediately
  with `decidedBy: null` — a decision with no decider, which was survivable while
  `trip_rupees_paid` was a column nothing paid. The moment `trip_compensation` made
  it real money, that branch became a standing offer of Rs 350 to anybody willing to
  tap "arrived" at the end of the road, on evidence that is **a tap, two numbers the
  professional types, and a location from their own phone**. The outcome is gone from
  the type, so nothing can route around it; `evidenceComplete` survives as a *reason*
  that tells the reviewer there is no contradiction to resolve, only a judgement.
  `settleNoShowClaim` is now reachable from `/admin/claims` and nowhere else.
  **The screen says what the evidence is worth**: the wait and the call count are
  labelled as the professional's own figures, and the location reads
  *phone-reported, unverified* — we hold no coordinates for an address to compare it
  against, so it is never shown as proof. That changes when addresses get a map pin
  and not before. **Their claim rate is on the screen too**, with its denominator
  (`claimRateWorthReading`'s rule), because we fund this now — and it is review, not
  punishment: nothing scores it and nothing acts on it. `maxPaidClaimsPerPeriod` is
  **null and unarmed**, the `arrearsPauseRupees` shape: two claims in the product's
  history is no basis for a number, and guessing low means a professional who had a
  bad month goes unpaid for real trips.
- **"A past-tense money column is a claim, not a payment" is a mechanical check
  now.** It had happened three times — `owedRupees`, `applyRedoRecovery`,
  `trip_rupees_paid` — always the same shape: a column records a decision and
  everybody reads it as money that moved. `lib/config/money-assertions.ts` declares
  every `*_paid`/`*_refunded` column with the row that backs it and whether the
  backing may lag (`guarantee_claims.refund_rupees` legitimately does: approving a
  refund and sending it are two events, because two of three rails cannot move money
  from inside this product). `tests/unit/money-assertions.test.ts` scans the
  migrations and **fails on any such column nobody has declared**, so the question
  "and what pays this?" is asked when the column is invented rather than five phases
  later; the db half asserts the backing rows are really there, in both directions —
  no claim without a payment, and no payment without a claim.
  **The guard can still be dodged by naming**: `refund_rupees` ends in a noun and the
  pattern does not catch it. That is written down rather than fixed by widening the
  regex, because sweeping in every `_rupees` and `_amount` column makes the list long
  enough that nobody reads it — which is exactly how `trip_rupees_paid` survived in
  plain sight.
- **A receipt goes to both sides on every settlement**, carrying the recorded
  amount. Somebody who paid 2,000 and receives a receipt for 1,000 notices —
  afterwards, when the professional has left and saying so costs nothing. It is
  a notification key, so Phase 13 sends it over SMS by adding a channel.
- **Digital is paid out sooner because it is verified sooner** —
  `lib/payments/payout.ts` holds every lever in one place. Live: digital
  settles at **13%** (`digitalCommissionReductionBps` 200) against cash's 15%,
  digital pays out in 24 hours and cash in 7 days. **Every number in
  `payout.ts` moves money between us and the professional — none of it touches
  what the customer pays.** The first name for that constant was
  `digitalDiscountBps` and it was misread as a customer discount by the person
  choosing the number, so the rule is now: a money constant is named for who
  pays it.
- **There is no cash surcharge, and that is not the discount with the sign
  flipped.** The two produce nearly the same gap and are morally nothing alike:
  cash in Nepal is not a preference, it is the only instrument a lot of people
  have, and those people skew older and poorer. A surcharge would tax them for
  our fraud problem and land hardest on the professionals who serve them. **A
  discount rewards a choice; a surcharge punishes a circumstance.**
  `cashCommissionSurchargeBps` stays 0.
- **The customer-side incentive is non-monetary and it is already built.**
  `components/booking/digital-benefits.tsx` says what digital actually gets a
  customer, at both places they choose a method: a refund comes straight back
  to them, nothing to confirm afterwards, a receipt they can show a landlord or
  an office, no cash in the house. All four are true, none costs a rupee, and
  every line is written as a benefit — "refunds come straight back to you" and
  "cash refunds are slow" carry the same information and the second reads as
  telling somebody off for being poor. Shown beside the buttons, not after the
  choice, because a reason revealed afterwards cannot inform the choice.
  **If money is ever added it is credit toward a next booking, never money off
  this one** — cheaper, it earns the second booking, and it does not make cash
  customers feel taxed. Before spending anything, ask eSewa and Khalti at
  merchant onboarding which cashback campaigns we can join: a gateway-funded
  incentive costs us nothing and reaches the same customer.
- **A money constant is named for who pays it.** `digitalDiscountBps` was
  misread as a customer discount by the person setting the number; it is
  `digitalCommissionReductionBps` now, and every constant in `payout.ts` says
  in its own comment that it moves money between us and the professional and
  never touches the customer's price. `WITHDRAWAL_RANKING_PENALTY_MAX` says
  "ranking" for the same reason — a penalty beside a number reads as a fine.
- **The cash-share baseline comes before any money is spent.**
  `payment_mix_signals` and `lib/data/payment-mix.ts` are that baseline — cash
  share by category, by ward and by month, reported **by value as well as by
  count**, because cash tends to be the big jobs and a platform reading only
  the job count would think its exposure half what it is. Never grouped by
  professional: the customer picks the method, and a per-person cash share read
  as a suspicion list would punish somebody for the neighbourhood they serve.
  It is not a ranking input and not a signal in the enforcement ladder.
- Ranking is deliberately **not** a payout lever — list position must not
  depend on how the customer chose to pay.
- **The owner can see what the platform earned, and it is a grouping rather than a
  calculation.** `lib/data/revenue.ts` sums things other code froze: nothing on
  `/admin/revenue` recomputes a fee, and the test reads the module's source to keep
  it that way — a screen that derived 15% of an amount would agree with the frozen
  column on every fixture ever written and disagree the first time a rate changed,
  leaving the owner's figure and the professional's statement both arguable.
  **"From the ledger only" was asked for and is not possible**, which is worth
  recording as a fact about the schema rather than a decision: `provider_ledger` has
  no kind for our fee on a digital job — `commission_due` is cash only, what the
  professional owes us because they hold the notes — so a ledger-only reading would
  have reported cash fees and silently omitted every digital one. Commission earned
  is `bookings.platform_fee`, frozen at settlement, settled payments only; the ledger
  supplies cash billed, redo cost, write-offs and payouts sent.
  **Commission returned on a refund is its own line and is never netted**, computed
  by `refundFunding` — the same pure function `agreeRefund` runs, over the same two
  frozen columns — so a week with a large refund shows the refund rather than a
  quietly smaller total. `/admin/payouts`'s `carried` rule, one screen over.
  **Two figures exist to be zero and are printed rather than filtered**: a settled
  payment with no frozen fee, and a refund agreed with no date. Dropping either would
  leave weekly columns that look complete and are not — the `/services` rule, where a
  failed read must never render as a measured zero. The week is Monday 00:00 UTC, the
  same ISO week the payout run uses, because two week definitions in one product make
  the two screens unreconcilable.
  **Cash commission outstanding is a position, not a flow**: there is no "we were
  paid" ledger kind, since a cash fee is settled by a later payout simply being
  smaller. It is the sum of the negative balances, and netting the positives in would
  answer a different question.
- **The refund screen shows signals and a consequence, and neither decides
  anything.** `/admin/guarantee-claims` used to print one number — the ceiling
  — while the button behind it did three things: pay the customer, return our
  commission in proportion, and write the rest as a debt against a
  professional's future earnings. Two of those were invisible at the moment
  somebody decided. `refundFunding` is now run on the screen over the split
  frozen on the booking, which is the same pure function `agreeRefund` runs
  server-side on the same columns — a preview, never a second opinion that can
  drift. Beside it sit three signals: refunds already agreed on this
  professional's own work (never on visits they attended for somebody else,
  which would punish the person who turned up to help), their outstanding
  `redo_debt`, and this customer's claim rate. **Every count carries its
  denominator** — two refunds out of two jobs and out of two hundred are
  different facts — and an unreadable denominator prints as unreadable rather
  than as zero. `claimRateWorthReading` is the rule, in `lib/config/guarantee.ts`
  with the other pure guarantee judgements, and it is **review, not
  punishment**: the sentence is on the screen, below three finished jobs there
  is no rate at all, and nothing here is an input to the ceiling, the verdict
  or the ladder.
- **The enforcement ladder is public** — `/providers/standards`, both
  languages, linked from `/providers/join` before anybody signs up. Five steps,
  each naming what triggered it and how it lifts, with what is *never* a signal
  named too (charging under the band, taking cash, turning work down). Steps 3
  to 5 need a person. Deterrence nobody can read is not deterrence, it is a
  trap — the honest leave and the rest learn the thresholds by experiment.
- **Commission is 15% (`COMMISSION_BPS = 1500`)**, frozen onto the booking at
  the moment it settles so a later rate change never rewrites history. The fee
  is rounded and the professional gets the remainder, so the split always
  reconciles to the amount charged.
- **A callback is a claim, never evidence.** eSewa and Khalti both return the
  customer to us with a status in the URL, through a browser we do not control.
  `verify()` ignores it and asks the gateway's own servers. `verifyAndSettle`
  then reconciles their figure against ours and refuses on a mismatch.
  `tests/unit/payment-gateways.test.ts` forges exactly that callback.
- **RLS grants no insert or update on `payments` to anyone.** Every write goes
  through `lib/data/payments.ts` under the service role, which re-reads the
  booking rather than believing anything it was handed. That file is the one
  place in the product holding that key on a customer path; treat an edit to it
  the way you would treat shared code.
- **Idempotent by construction.** `our_reference` is unique and every settle is
  a guarded update (`.in("status", ["pending","initiated"])`), so a duplicate
  callback, a refresh and the reconciliation sweep can race and only one wins.
  A retry gets a **new** reference — reusing it would make attempt two
  indistinguishable from a duplicate callback for attempt one.
- **A gateway we cannot reach is not a failed payment.** `ok: false` means "no
  answer": the money may well have left the customer's account, so the row
  stays in flight and the sweep picks it up. `/api/payments/reconcile` runs it
  (guarded by `CRON_SECRET`, refusing everything if it is unset), and the
  panel's "Check again" re-verifies on the spot rather than re-rendering what
  we already believed.
- **Cash is the primary path, not a fallback.** `isConfigured()` is always
  true, so a missing key can never leave a customer with no way to pay, and
  `verify()` never self-settles — the customer confirming receipt is the only
  oracle there is, which is why that check lives in the data layer where the
  caller's identity is known.
- **Two machines, deliberately separate.** A booking can be completed and
  unpaid; for cash that is the normal case. `npm run check:transitions` now
  parses both TS/SQL pairs.
- `@/lib/payments` is **server-only** (the registry reaches `node:crypto` via
  eSewa). Client Components import `@/lib/payments/client`. The linter enforces
  both, and the bundle build is what caught it the first time.

## Security

`SECURITY.md` is the map: every server action and route handler with who may
call it, what it may act on and where that is enforced; the data inventory;
and the admin model. It is updated in the same commit as anything that adds an
endpoint or stores a new kind of personal data.

- **RLS is a floor, not a filter.** A read for a screen that belongs to one
  person names that person in the query. A Postgres policy is permissive, so
  adding an `Admins read every X` policy silently widens every unscoped read of
  X and nothing fails. `listBookings()` named nobody and showed an admin every
  customer's bookings on the customer dashboard — found by a person looking at
  it, months after the policy landed; nine reads had the same shape. Where the
  filter is a function rather than a column, write it once in SQL and have the
  policy and the application call it (`open_job_ids()`). Before leaving a read
  to RLS, ask which admin policy is on that table — `docs/rls-matrix.md` lists
  them.
- **RLS is a floor under the rows, and a `security definer` function stands on
  top of it answering to nothing but its own grant.** `provider_ledger`'s
  policies are exactly right — a professional reads their own rows, an admin
  reads all — and `provider_outstanding` and `provider_balance` had `execute`
  for `authenticated` while being `security definer`, so any signed-in customer
  could name any professional's id and read their guarantee debt and money
  position. **Proven against production before the fix**: as `authenticated`
  with a customer's own JWT claim and somebody else's provider id, the call
  returned a row. Nothing was disclosed — `provider_ledger` is empty — but the
  door was open, which is the finding.
  This is `listBookings()` one layer down: there the unscoped thing was a query,
  here it is an aggregate, and in both cases the policy was faultless and
  irrelevant. **So the question to ask of every definer function is not "is the
  policy right" but "who may call it, and with whose id".**
  The fix cost nothing, which is the part worth keeping: **no production caller
  needed the grant.** `lib/data/provider-profile.ts` and
  `lib/data/claim-signals.ts` both reach these through `createAdminClient()`,
  so the grant served nobody but an id-enumerator. Revoked from `authenticated`
  in `20260930000001`, and `tests/db/ledger-kinds.test.ts` asserts the refusal
  as the caller experiences it.
  **`provider_balance` inherited the hole one day old**, copied from
  `provider_outstanding`'s shape without asking what the definer bypassed — and
  the reason recorded for granting it ("a professional reads their own balance
  on their dashboard") was wrong on its face, since that view is server-rendered
  and reads through the service role like every other money surface. A pattern
  copied is not a pattern examined.
- **The actor comes from the session, never from the caller.** Every action
  re-reads `getSessionProfile()` and passes the id down as `actorId`; the data
  layer re-reads the subject and decides. Three holes have been found this way
  and all three were the same shape — an id arrived from the browser and
  nothing asked whose it was.
- **Enforce it in the database where a rule has no legitimate exception.**
  `enforce_booking_address_ownership` has no service-role bypass, because no
  path books a job at an address its customer does not own.
- **The uploaded file is whatever its first bytes say it is.** `lib/security/image.ts`
  checks size before decoding, magic bytes rather than the content type,
  dimensions from the file's own header, and strips EXIF — a photograph taken
  in somebody's kitchen carries that kitchen's coordinates.
- **A write policy is not a column policy, and `profiles` proved it twice over.**
  RLS is row-level and Supabase grants `authenticated` table-wide UPDATE through
  a default privilege, so `"Profiles are updatable by their owner"` let the owner
  write **every** column on their own row — `role` included — with no trigger on
  the table. One `PATCH /rest/v1/profiles?id=eq.<self> {"role":"admin"}` from any
  signed-in customer's browser passed both `using` and `with check`, because `id`
  never changed, and `is_admin()` then opened the six policies behind it: every
  profile, booking, payment, triage log, and the identity documents in the
  private bucket. It is the same class as `enforce_booking_immutability`, which
  this file already recorded for `bookings`; nobody asked the question again one
  table over, and it was found while adding the activity opt-out — the first
  customer-facing write this table has ever had.
  **The fix is a column grant, not a second trigger.** `20260927000005` revokes
  UPDATE from `anon` and `authenticated` and grants it back on `full_name`,
  `preferred_language` and `hide_from_activity`: the three a browser legitimately
  writes, in onboarding and on `/account`. A grant is refused before a row is
  considered and needs no `auth.uid() is null` bypass — `bookings` needs one
  because the service role writes the columns it guards, and a bypass is a thing
  that can be reached the wrong way. `service_role` is untouched, which is what
  leaves `lib/data/review.ts` able to promote an approved applicant.
  **It is proven against production, as `authenticated`**: a `role` write answers
  `42501 permission denied for table profiles` — from the planner, before any row
  is considered, which is the property a grant has and a trigger does not — while
  `hide_from_activity` still returns its row. **And that error carries the
  instruction that reopens the hole**: Postgres's own HINT, which the Supabase
  editor shows, is `GRANT UPDATE ON public.profiles TO authenticated;` — the exact
  break-test from the fix's commit, offered as advice. On `profiles` that hint is
  wrong: grant the column, never the table.
  **And the harness could not have seen it.** `tests/support/postgres.ts`
  re-granted table-wide privileges in a loop *after* applying the migrations, so
  any column grant a migration made was erased before a test looked — the fixed
  migration would have read as still broken with no way to tell the two apart. It
  sets Supabase's default privilege before the migrations now, which is what the
  real database does. **So before adding an UPDATE policy, ask which column on
  that table confers power**, and check the grant as well as the policy —
  `tests/db/write-grants.test.ts` is what fails if you do not. Five tables let a
  browser write, each entry names the guards that make it safe, and the test goes
  red when a sixth appears or when a named guard disappears.
- **The reason that stopped the question being asked on the other four tables was
  an observation with the wrong conclusion drawn from it**, and it sat in this
  file and in `SECURITY.md` for two weeks: *the grant is not the discriminator,
  because Supabase's default puts a table-wide grant on everything, so listing
  tables that have it lists all of them — the POLICY is what decides.* Every
  clause true. A privilege every table carries is not a reason to look at the
  policy instead; it is **36 locks left open**. Read live: `anon` and
  `authenticated` each held INSERT and UPDATE on 31 tables and DELETE on 36 —
  all 85 columns of `bookings`, every column of `payments`, `refunds`,
  `provider_ledger`, `security_events`, `customer_risk`. All of it inert, and
  **inert is a property of the policies rather than of the privilege**: `anon`
  has one write policy in the product, there is no DELETE policy anywhere at
  all, and every public table has RLS enabled (checked, not assumed). So every
  one of those tables was one policy away from being writable with no column
  guard on it, which is `payouts`' own precondition rather than a hypothetical.
  `20261011000004` revokes all three verbs schema-wide from both browser roles
  and grants back 51 columns across the five tables, taken out of `lib/data/`
  rather than guessed; SELECT and `service_role` are untouched. **The trigger
  stays as the second layer** — that is the user's ask and the right shape: a
  grant cannot be rebuilt wrongly and a trigger can, which is the whole lesson of
  the live drift, so the grant refuses first and the trigger refuses anyway.
  Four findings came out of it: `enforce_booking_immutability` is BEFORE UPDATE
  **only**, so no INSERT column had ever been guarded and a hand-crafted POST
  could insert a booking already `paid` with a `platform_fee`; `addresses` was
  on its policy alone while `lat`/`lng` (a ranking input), `upheld_no_shows` and
  `first_confirmed_at` had quietly become the server's; `provider_applications`'
  write policies are a door nobody uses, every write being `createAdminClient()`,
  so it grants nothing now; and `provider_leads` granted `status`, which
  `startApplication` reads as `new` to move a lead on — a forged one means a real
  applicant never enters the queue.
  **And the grant nearly retired the trigger's own coverage.** Twenty-odd cases
  asserting `enforce_booking_immutability`'s sentences began passing on
  `permission denied`; relaxing them to "it throws" would have left the guard
  that has already been broken once as the guard nothing tests. `pg.pastTheGrant`
  is the harness answer — the owner role carrying an `auth.uid()`, past the grants
  and the policies but still reaching a trigger that keys on somebody rather than
  the server asking — so each rule is asserted at both layers, and that
  primitive's own two properties are pinned because one that stopped carrying the
  claim would look exactly like a broken guard. `tests/support/refusals.ts` is the
  one `BROWSER_WRITE_REFUSED`, because three spellings of that regex were already
  in the suite and had begun to drift: a behavioural test asserts the refusal, and
  **which lock answers is Postgres's ordering rather than the guarantee**.
- **There are two admin gates and which one an action uses is a money
  decision.** `adminActor()` carries `STEP_UP_HOURS` — eight hours, because
  admin work is batched and a code every half hour teaches somebody to tap
  through approvals, which is the failure `lib/payments/pricing.ts` names. That
  is the right window for reading a queue. `/admin/payouts` has needed
  `REAUTH_WINDOW_MINUTES` since it shipped, threaded into `lib/data/payouts.ts`
  as `reauthenticatedAt`. **Eight other actions moved real money behind the
  batched-work window** — the three refund actions (one of which initiates a
  transfer), the no-show payment, the trip-debt write-off, the commission
  waiver, the survey fee and the disputed cash amount — plus `revealDestination`,
  which returns a bank account number, and `confirmFirstPayout`, the human
  witness in the account-takeover control. There was no reason for the split
  beyond their having been written on different days, and nothing in the
  repository could see it, because "this one moves money" lived only in
  somebody's head.
  `freshAdminActor()` is the one gate; `lib/config/admin-money.ts` declares each
  writer with how its proof arrives (`fresh-actor`, `threaded`, or `none` with
  the reason — `markPayoutConfirmed` records an answer that came from outside
  and moves nothing). `tests/unit/admin-money-reauth.test.ts` reads every admin
  action through the TypeScript AST and fails **both** on a declared writer
  called without the gate **and** on any money-module function nobody has
  declared — the coverage half is the point, because a list alone goes stale on
  the first new action. `isFresh` moved to `lib/config/payout-policy.ts` beside
  the window it reads: it was in a `server-only` data module, which is the
  mistake this file records four times, and it had already produced a second
  copy of the arithmetic in the AI-ceilings action.
  **The refusal says what to do.** `components/admin/reauth-notice.tsx` is one
  sentence with the link, for nine screens, because the two that existed were
  already drifting — `/admin/payouts` said "prove who you are again" and
  `/admin/ai-limits` said "enter a code from your authenticator" about the same
  window and the same remedy. It opens in a new tab, since these forms carry a
  typed reason and navigating away for a code would throw it away.
- **The schema-wide revoke was three verbs of eight, and `information_schema`
  cannot see the eighth.** `20261011000004` took INSERT, UPDATE and DELETE back
  from `anon` and `authenticated` — the verbs anybody had thought about.
  Supabase's default grants `all`, so both roles still held TRUNCATE and TRIGGER
  on 36 tables, REFERENCES on 36 and 37, and MAINTAIN on 36 and 37.
  **TRUNCATE is the one worth the migration and not because it was reachable**:
  PostgREST has no truncate verb, but TRUNCATE **is not subject to RLS at all**,
  so unlike every other write in this schema it never meets a policy — the
  privilege was the only thing in front of it, on `security_events` and
  `provider_ledger`, which exist to be append-only. That is the DELETE
  argument on the stronger case.
  **MAINTAIN nearly got away**: PostgreSQL 17 added it and
  `information_schema.role_table_grants` does not list it, because that view is
  the SQL standard's and the privilege is newer than the standard. The first
  draft of the test read that view and would have printed a tick over a
  privilege both roles held on 36 tables. It reads `aclexplode` now and asserts
  **what is left** rather than that three named verbs are gone. The revoke is
  guarded on `server_version_num`, because the harness cluster is 16 and
  `revoke maintain` is a syntax error there — so that one clause is verified
  against production with `has_table_privilege` and the limit is written down.
- **The harness modelled a database stricter than the real one, which is how
  the break-test came back green.** `tests/support/postgres.ts` granted
  `select, insert, update` as Supabase's table default; the live
  `pg_default_acl` says `arwdDxtm`. Every verb it left out was a verb no test
  here could see — `20261011000004`'s `revoke delete` had never been proven
  locally either. It grants `all` now. **A fix whose break-test stays green is
  not a fix that was unnecessary; it is a harness that cannot see the thing.**
- **A new FUNCTION granted a browser everything too, and that is where
  `provider_balance` came from.** Nobody granted `execute` on those definer
  functions: the same Supabase default that hands out tables hands out
  functions, and `20261002000001` closed the table half only — so the fix
  revoked two grants while the mechanism went on minting them, and every
  `security definer` function written since started life callable by any
  browser. `20261016000003` closes the source. Nothing breaks, because a
  default privilege applies only at CREATE time and the seven helpers a POLICY
  needs each already carry an explicit `grant execute … to authenticated` —
  a policy expression runs with the caller's privileges, which is why
  `is_admin` must keep it. **The trap is the table one again**: after this, a
  new function a policy calls answers `42501` until its migration grants
  EXECUTE. The test asserts the callable set **is** those seven, each with the
  policy that needs it beside it, which is the only version that catches the
  eighth.
- **A role change writes its own audit row, in the same transaction.** Promoting
  an approved applicant was a bare `update({ role })` that logged only on
  failure, so the live log's only two `role.changed` rows both say `customer` —
  they are `handle_new_user` at provisioning — and the elevations that produced
  the real provider and admin accounts left nothing at all. An absent record read
  as a clean one, one level up from rule 6.
  `profiles_record_role_change` is a **trigger**, because an application-side
  call would miss the paths that actually went unrecorded — a dashboard query, an
  MCP call, a future admin tool — and would not be atomic with the change. No
  record now means no change, which is deliberately the opposite of `lib/audit`'s
  never-throw: that logs something that already happened, this gates something
  that has not. **`via` is what the database can prove** —
  `current_setting('role')` separates `service-role`, `direct-sql` and `session`,
  since `current_user` inside a `security definer` function is always the owner —
  and `public.set_profile_role` is how a path says more, through two
  transaction-local settings the trigger reads. It is **`security invoker`** so it
  can never become a way to obtain a role, and revoked from all three browser
  roles anyway. **Nothing is backfilled**: rows invented for changes nobody
  witnessed would manufacture the clean record this exists to prevent.
- **`security_events` is append-only and the trigger refuses UPDATE and DELETE
  for every caller, service role included.** A log the application can edit
  proves nothing. `lib/audit` never throws: the event already happened.
- **Identity documents are the owner's and admins', nobody else's**, in a
  private bucket, and every admin read is written to the log by
  `recordDocumentAccess`. It is a separate function so it cannot be quietly
  skipped.
- **The db suite reads the catalog, not a list somebody maintained.** A table
  added later without policies fails `tests/db/booking-rls.test.ts` the moment
  it exists. Nothing in `supabase/migrations/` is skipped by the harness any
  more — the storage schema is modelled.
- **`npm run build` runs `check:secrets`**, which scans the client bundle for
  the value and the name of every secret. Next decides what is client code by
  tracing imports, so a server module can become client code without being
  edited.
  **Its third pass reads the source, and that is the one that catches the
  class.** Any module reading `process.env.<SECRET>` must declare
  `server-only`; naming a key in a comment is documentation and is not a read.
  The bundle passes can only see a leak that already happened — they were
  correctly green for months while `lib/env.ts` exported the service role key
  from the module `lib/supabase/client.ts` imports, because the key sat in a
  getter and Next tree-shook it. The source pass sees the arrangement, before a
  build exists. It self-tests on every run, like `check:contacts`: a scanner
  that has quietly stopped scanning says so rather than printing a tick.

## Schema

`supabase/migrations/`, applied in filename order. If it is not in a migration
file it does not exist — nothing gets clicked into the dashboard.

**Applying one is the agent's job, not the user's.** The Supabase MCP is
connected: write the file, apply that exact text with `apply_migration`, then
verify with `execute_sql` that the objects, columns, functions and policies
actually landed — `to_regclass`, `information_schema.columns`, `pg_policies`,
`pg_proc`. The file is still what the db suite runs and what a fresh project
gets; applying it by hand from a dashboard is how the two drift apart.

**A statement whose first keyword is `DROP` — or `DELETE` — hangs on the MCP
transport.** The "nothing else does" this line used to carry was measured over
DDL only and was wrong the first time a row had to be removed: deleting the
break-glass grant from `provisioned_accounts` sat for the full sixty seconds and
rolled back, with the row verifiably still there afterwards. The cause is the
same one the paragraph already names — `execute_sql` says a destructive
statement may need the user to confirm, and that prompt never reaches the agent —
so the rule is about what the transport judges DESTRUCTIVE, not about DDL.
`ALTER TABLE … DROP CONSTRAINT` remains instant, which is the measured exception
and the one that matters most. A `DELETE` therefore goes in **Your turn** with
its destination named, exactly like a migration whose point is a drop. This paragraph has now been wrong twice and over-general once, so it is
written as the measurements rather than as a theory. Every row was run against the
live project:

```
drop table public.customer_match_keys                        hangs 60s  (x2)
drop table if exists public.zz_nonexistent_probe             hangs 60s
drop trigger if exists zz_probe on public.provider_ledger    hangs 60s
drop policy if exists "zz probe" on public.provider_ledger   hangs 60s
alter table ... drop constraint if exists zz_probe           INSTANT
revoke truncate, trigger, references on all tables ...       INSTANT
alter default privileges ... revoke all on functions         INSTANT
create table / index / trigger / policy, alter table add,
  grant, revoke, comment on, create or replace function      INSTANT
one LARGE `DO` block of creates, alters and revokes          INSTANT
a SMALL `DO` block containing one `drop trigger if exists`   hangs 60s  (x3)
drop function if exists ... (four, one statement)            hangs 60s
create fn whose BODY contains `delete from`                  INSTANT
create fn whose BODY contains `delete` and `insert into`      INSTANT
create fn whose BODY returns the string 'UPDATE'             INSTANT
create fn whose BODY has 'UPDATE' AND `delete from`          hangs 60s  (x2)
apply_migration, 21 KB, no destructive statement             hangs 60s
the same statements through execute_sql in four parts        INSTANT
```

**The probes are what make this a fact rather than a guess.** Three of them name
objects that have never existed — a table, a trigger and a policy — so they touch
nothing, lock nothing and are parse-level no-ops, and they still hang for the full
minute. Size, statement count, locks, the pooler and the `DO` block are all ruled out
by the rows above: the small block hung because of the `drop trigger` inside it, and
the large one succeeded because it contained no drop. `execute_sql`'s own description
says destructive statements may require the user to confirm, and that confirmation
never reaches the agent, so the call sits until the timeout and rolls back whole.

**And the judgement is made on the whole text, including inside a function body,
on a PAIR of keywords rather than on the leading one.** The last four rows above
are the measurement: `delete from` alone in a body is instant, `delete` with
`insert into` is instant, the bare string `'UPDATE'` is instant, and `'UPDATE'`
together with a `delete` hangs — twice. So `sync_booking_days`, whose body holds
`tg_op = 'UPDATE'` and one `delete from public.booking_days`, could not be
applied at all, and a string literal was enough to do it. The way through is to
put one keyword in each of two functions: `clear_booking_days()` holds the
delete, `sync_booking_days()` calls it. Writing `tg_op <> 'INSERT'` instead
would also pass and is refused — it is only equivalent while that trigger stays
`insert or update`, which is a coupling the next reader has to go and verify.
**`apply_migration` also timed out on a 21 KB file with nothing destructive in
it**, where the same statements split across four `execute_sql` calls were each
instant; when that happens, insert the `supabase_migrations.schema_migrations`
row by hand so history still records the migration.

**What follows, practically:**

- **`ALTER TABLE … DROP CONSTRAINT` is fine**, which is what matters most, because
  that is how every check constraint in this schema is changed — drop it and add it
  back, both as `alter table`. Changing the ledger's kind list is applicable from
  here.
- **The `drop X` + `create X` idiom this repo uses everywhere is not.** Send the
  `create` half alone: on a fresh apply the object does not exist, and
  `create or replace` covers a rebuild. The file keeps both halves, because the db
  suite and a fresh project need the drop.
- **A migration whose POINT is a drop cannot be applied from here at all.** Write the
  file, leave it unapplied, and put the statement in the handover's **Your turn** with
  the state said plainly rather than left to be discovered.
  `20261002000006_drop_customer_match_keys.sql` was that case, and is **done**: the
  file was written and left unapplied, the db suite ran the drop (which is what
  proved the SQL), the handover carried the one statement, and a person ran it in the
  Supabase SQL editor — where the confirmation prompt can actually be answered —
  on 2026-10-03. Verified from here afterwards: `to_regclass` null, no orphan policy,
  `schema_migrations` recorded. **Say WHERE, not just what**: the first handover said
  "one statement, by hand" and it was pasted into PowerShell, which is a fair reading
  of a sentence that named no destination.

Everything the paragraph below establishes about a `DO` block's atomicity remains
true and useful when a block does go through — one statement to the transport, one
implicit transaction. It was simply never the fix for a hang.

**Multi-statement DDL over that connection also hangs, which is what the `DO`
block was for.** Reproduced with two trivial statements — a `create
table` and its `drop` in one call sat for 60 seconds, where either alone returns
instantly — and the batch rolled back cleanly, so it is not the SQL, not the
table and not the size. Locks were ruled out (`pg_stat_activity` idle, nothing
waiting); the mechanism inside Supabase's MCP server or its pooler is not
visible from here and is not written down as a cause. What is established is the
behaviour. A `DO $$ … END $$;` block is **one statement to the transport and one
implicit transaction**, which is both the way through and the property worth
having: it was proven atomic by putting a deliberate failure in its last
statement and finding neither the table nor the index afterwards. Insert the
`supabase_migrations.schema_migrations` row **inside** the block, so history
records the migration only if its DDL committed.
**`CREATE INDEX CONCURRENTLY` cannot go through it** — `25001: cannot be
executed from a function`, proven rather than assumed. That one statement goes
in a call of its own, outside any block.

**Every migration is ordered so that stopping anywhere leaves something closed,
never something open.** Create, then `enable row level security` and the
revokes, then triggers and constraints, then policies and grants.
`20261001000003_payouts.sql` timed out after its `create table` and before its
guards, and production briefly held a money-instruction table with RLS off and
`anon` carrying full SELECT, INSERT, UPDATE and DELETE on it. Nothing was
disclosed — the table was empty and unwritten — and the window was real.
`npm run check:migrations` enforces the ordering per file and self-tests the
rule on every run; it was proven by reordering that same migration so its
policies preceded the RLS enable, and watching it go red.

**A new table grants nothing, so its migration says what it grants.** Supabase's
default privilege on `public` handed `anon` and `authenticated` everything on
every table at creation, which is what made that window exploitable and what let
a signed-in browser write its own `profiles.role` a month earlier. It is revoked
in `20261002000001`, and the scope is stated narrowly because it has to be:
`pg_default_acl` holds **two** entries for `public` tables, one granted by
`postgres` and one by `supabase_admin`, and which applies depends on who runs the
CREATE. The connection is `postgres` and `pg_has_role` says it is not a member of
`supabase_admin`, so what is actually true is **every table this product
creates**. `tests/db/write-grants.test.ts` is the backstop for the other case.
**It changed nothing for a table that already existed**, because a default
privilege applies only at CREATE time — the grants for both browser roles across
all 75 rows fingerprinted identically before and after. That was recorded here as
reassurance and it was the other half of the job going undone: those tables kept
their table-wide INSERT, UPDATE and DELETE for another two weeks, until
`20261011000004` revoked all three schema-wide. The two halves meet now — an old
table has had its privilege taken away, a new one is never given one.
**The trap this creates is louder than the one it closes**, so it is written
here: a new table with a perfectly correct RLS policy still answers `permission
denied`, because the policy decides *which rows* and the grant decides whether
you may ask at all. Every new table ends its migration with an explicit
`grant select on <table> to authenticated` or a comment saying it deliberately
grants nothing. Postgres's own HINT on that error recommends granting the whole
table; on `profiles` that hint is how the escalation comes back, and it is wrong
here for the same reason — grant the column, or the table to the role that needs
it, never the default to everybody.

`types/supabase.ts` is hand-written to match. Regenerate it with
`supabase gen types` when you have network to the project, and keep it in the
same commit as the migration that changed it.

RLS gotcha: a policy on `profiles` that queries `profiles` to check the
caller's role recurses into itself and Postgres raises "infinite recursion
detected in policy". `public.is_admin()` is `security definer` to break that
cycle.

**RLS is row-level, so a policy that lets somebody update a row lets them
update every column on it.** "Customers cancel their own open bookings"
validates `customer_id` and `status` — which made `quoted_max`, `final_amount`
and `provider_id` editable from a browser, and `openPayment` judges an amount
against exactly those columns. A customer could have paid Rs 100 for a Rs 4,000
job with every server-side check agreeing. Postgres has no per-column RLS
clause, so `enforce_booking_immutability` (a BEFORE UPDATE trigger) is the rule;
`auth.uid()` is null for the service role, which is how the server's own writes
pass through. Found by the db suite, not by reading the code — add a case there
before widening any update policy.

**Production had drifted from the migration files, and the check built to catch
that had been reporting it into a 503 nobody was reading.**
`enforce_booking_immutability` in the live database fingerprinted
`6213c2c190f1f168` against the tree's `9e16a1e8854153c8` — found by
`check:migrations` refusing a rebuild that read `pg_proc` back, because the
rebuild "removed" fourteen lines the tree's copy had. It is the accident this
very function already carries a warning about, one layer further out: somebody
rebuilt it from a stale copy and applied that to the DATABASE ONLY, where no
test in this repository can see it. The live copy had gained guards for
`confirmation_required` and `confirmation_hold_until` that appear in no
migration file at all, which dates the stale copy to around 20260910000002 —
and `enforce_confirmation_integrity` already guards both, so they were
redundant as well as unfiled.

What production had lost, for an unknown number of weeks, with `authenticated`
holding UPDATE on **every** column of `bookings` and this trigger the only thing
in front of it: `billable` and `guarantee_claim_id` (a guarantee re-visit made
free, or an ordinary job relabelled as somebody's defect), `provider_id` with
both the reassignment ban and the `provider_serves` coverage check gone (any
professional put on any job of theirs, an accepted job taken off the one holding
it), and `provider_band_reason` / `band_change_declined_at` (a correction refusal
fabricated after the fact). Nothing was exploited — there was not one pending or
accepted booking in the database and the only accounts are ours — and the hole
was open.

**So: rebuild a function from the TREE, and use `pg_proc` to CHECK rather than to
copy.** The schema notes said to read the live definition back, which is right
for the ordinary case and silently wrong the moment the two disagree; the file is
the source of truth and `function_fingerprints()` is how you find out it is not
being honoured. **And the monitor was working the whole time**: `db.functions` on
`/api/health` compares the live fingerprints against the build's and would have
said `down` every day this lasted. It changed nothing, because `auth.sms` is
already `down` over the ungotten SMS gateway, so `ok:false` was already explained
and a new failing check could not move the verdict. **One unresolved `down`
masked every later one.**

**Both halves of that are closed now, and neither was a severity dimension.**

**A failure is acknowledged per CHECK, with a reason and an expiry.**
`ACKNOWLEDGED_FAILURES` in `lib/config/health.ts` holds one entry — `auth.sms`,
with the Twilio placeholder named and a date — and `healthVerdict` is what the
route reads. `ok` now means "nothing unattended is wrong", so an unacknowledged
check turns it red whatever else is already broken; `clean` is the other half and
is reported separately, because one boolean carrying both meanings is exactly how
`ok:false` came to read as "the gateway again". **There is no global mute and no
wildcard** — a blanket "ignore red" is the state this was already in by accident,
and the test asserts that an entry for `auth.sms` does not forgive
`auth.sms.probe`. **The expiry is the mechanism**: past its date an
acknowledgement forgives nothing and the check goes red on its own, so the choice
is to fix the fault or to look again and write a new date down. **An
acknowledgement on a check that is PASSING is reported as stale** — not red,
because nothing is wrong, but loud, since an ack outliving its fault silently
forgives that check's next failure, which is the same bug through the other door.
**And an unusable clock forgives nothing**: the first version compared against
`now.getTime()` and every comparison with NaN is false, so a bad clock read as
"well within the window" on every acknowledgement at once. Found by the test that
passes an unparseable date.

**And the first thing that gate caught was itself.** `npm run check:drift` run
against production reported `enforce_claim_refund` drifted — and the database
was right. `supabase/function-fingerprints.json` is produced by one regex in
`check-migrations.mjs` that matched `as $$ … $$;` **and nothing else**, so two
functions dollar-quoted `$fn$` were invisible to it. That quoting is correct and
has to stay: both migrations are applied inside a `DO $mig$ … $mig$` block over
the agent's transport, where a nested `$$` closes the wrong quote. So the
scanner widens and the migrations do not narrow.
**Two faults, and the quiet one is worse.** `enforce_claim_refund` kept the body
of `20260925000003` while `20261008000003` had redefined it, so the live check
reported production as drifted for four days — the inverse of the fault the gate
exists for, and identical from outside, which is exactly how a monitor comes to
be ignored. `add_ai_spend` was first defined in `20261009000001` and so **never
entered the file at all**: the gate has never compared it, and nothing was red.
A false positive is loud; a silent gap is not. Both live bodies were hashed in
SQL with the script's own normalisation and match the regenerated tree exactly
(`2bed71d48abae0fc`, `1cbe515fe227346b`), so nothing had been applied outside the
migrations.
**The scanner self-tests now**, like `check:secrets` and `check:messages`, on
both spellings and on a mismatched pair — a scanner that finds nothing and a
scanner that is broken printed the same tick. And
`tests/unit/function-fingerprints.test.ts` counts the same thing a SECOND way,
with a pattern that stops at the opening parenthesis and knows nothing about
quoting: every function the tree defines is fingerprinted, nothing orphaned is,
and each entry names the LAST file to define it. One regex checking itself is
the arrangement that failed, so the guard is a different regex that can only
agree by both being right.

**And drift is a gate rather than a line.** The comparison moved out of the route
handler into `lib/data/schema-drift.ts` — it had exactly one reader, which is how
a real finding sat unread — and has three callers now: the health check,
`/api/bookings/dispatch`, and `scripts/check-drift.mjs`. The nightly sweep
**fails its own run** on a mismatch: `cron_runs` records `ok: false` with the
drifted names and the route answers 503, so Vercel's cron log shows a failed
invocation. The script runs in **CI's `deploy` job, straight after the hook that asks for
the deploy**, and needs no secret, because it reads the public `/api/health`
payload rather than the database. **It was on `deployment_status` and that event
never fires here** — see below.
**Exit 2 is "could not look"**, the `check:deployed` contract, and a deployment
that does not report `db.functions` at all **fails** — the check is
unconditional, so its absence means an older build is serving or somebody removed
the gate. A workflow of its own rather than a step in `verify`, for the reason
that file already records: a check that cannot pass must not silence the checks
that can.
**`check:deployed` runs there too now, as a SIBLING JOB rather than a second
step** — the same rule turned on the workflow itself: as steps in one job a
drift failure would stop the deploy check ever running, so "production is
serving last week's build" would go unnoticed for exactly as long as the drift
took to fix. Both were manual until this, which is how four commits once sat on
the branch while production served an older build.
**Three things differ between the two jobs and each is load-bearing.** The
checkout is pinned to `github.event.deployment.sha`, not the branch tip: this
check asks "is the commit I have the commit that is serving", so a push landing
mid-deploy would make a default checkout report a false "the deploy has not
landed". The origin is the **production alias and never `target_url`** — Vercel
reports the per-deployment URL there, which is right for drift (any URL serving
that build answers `/api/health` the same) and wrong here, because `og:url`
comes from `NEXT_PUBLIC_SITE_URL` and walking the deployment URL would fail that
assertion on every run; the alias is also the honest target, since "pushed is not
deployed" is a statement about what the alias serves. And **exit 2 is retried
once, exit 1 never**: 2 means the walk did not run, which on a real network is
the alias not yet flipped, where 1 is a finding — a check that retries its way to
green is not a check.

**And both ran on an event that arrives late and is attributed to nobody, which
is why they are steps in CI now.** `after-deploy.yml` fired on
`deployment_status`, which Vercel's git integration emits — and a push does not
deploy this project, because `scripts/vercel-ignore-build.mjs` correctly skips a
commit GitHub has not reported a check for yet, so the deploy that serves is the
one CI asks for through a deploy hook.

**CORRECTION, 2026-10-14, AND THE FIRST CLAIM WAS WRONG.** This said a hook
deployment "emits no `deployment_status` at all", and it does emit one — about
five or six minutes after the push, once Vercel has built and reported. I read
the deployments list inside that window, found nothing for `90b7ca8` or
`a34478a`, and generalised from a gap that was a delay. `a34478a`'s record
appeared at 14:51:55 against a 14:46:03 commit and its run passed, as
`ba949cd`'s had. **`after-deploy.yml` was working.** The exact shape this file
keeps recording — a conclusion drawn from one reading, stated as a mechanism —
and it is recorded rather than quietly edited because the workflow was deleted
on the strength of it.

**What is true, and why the CI placement is still the right one.** The event is
late and its timing is Vercel's, so a push-and-walk-away leaves minutes in which
nothing has checked; and it fires per deployment rather than per commit, so a
superseded build (like `90b7ca8`, CANCELED) correctly gets nothing while a
commit CI deployed gets a walk attributed to a run nobody was watching. In CI's
`deploy` job the walk runs at a known moment, against the commit that job asked
Vercel for, and fails *that* run. `scripts/await-deploy.mjs` is what makes it
deterministic.

**The gap that argument left is closed, by the user's call, and the duplicate is
the accepted cost.** A production deployment CI did not trigger — a redeploy
from the Vercel dashboard, a rollback, a hook fired by hand — would have been
walked by nothing, where drift at least keeps its nightly channel.
`after-deploy.yml` is restored as the **backstop** and says so in its header:
CI's `deploy` job is the primary path because it runs at a known moment against
a known commit, and this catches what that cannot see. The price is a duplicate
walk on an ordinary hook deploy — two green ticks for one fact, two red on a
real failure — and that is the right side of the trade, because a duplicate is
noise and a gap is a production nobody looked at.

**And the three red runs before `ba949cd` are still unexplained.** `de0ca15`,
`21cb41b` and `07fe2f5` each failed twice; the logs are served from a host this
sandbox cannot reach, so the reason was never read. It is not "the event does
not fire", which is what this entry wrongly concluded.

They are steps in CI's `deploy` job now, after the hook, gated on the production
branch. `scripts/await-deploy.mjs` is the new piece and it is the only reason
this can work from there: it polls the alias's `x-build-commit` until it matches
the commit CI is deploying, so the checks run against the build they were asked
about rather than whatever happens to be serving. Its exit codes are
`check:deployed`'s — **1 is "serving a different commit after eight minutes" and
2 is "could not look"** — because "production is stale" and "the network is
blocked" must never be the same red tick. `after-deploy.yml` is deleted rather than kept as a
backstop, which is a choice between a duplicate and a gap: keeping it would mean
two walks and two red ticks per hook deploy. Drift keeps its second channel —
the nightly sweep fails its own run on a mismatch.
**`check-drift.mjs` took an empty origin as an origin**, found while wiring it:
GitHub substitutes an unset `vars.*` as the empty string and the script used
`??`, which only falls through on null, so it fetched `/api/health` against
nothing. `||` on all three scripts now.

**A policy is redefined by later migrations, so breaking one to test it means
editing its LAST definition.** `drop policy if exists` + `create policy` is the
idiom here, and several policies are redefined once or twice as the product
grew — "Customers read their own bookings" is created in
`20260901000001_bookings.sql` and created again in
`20260911000001_unverified_session_guard.sql` to add the verified-session
clause. Editing the first one to prove a test bites changes nothing: the later
migration overwrites it before the suite runs, the test passes, and the obvious
conclusion — "the test is blind" — is wrong. That happened while writing
`tests/db/rls-matrix.test.ts` and nearly got a working guard reported as a
broken one. `grep -rn "policy name" supabase/migrations/` before breaking
anything; it is the same trap as `create or replace` taking the text you paste,
one object type over.

**An UPDATE may not make a row invisible to the person making it.** Postgres
applies the table's SELECT policies to the *new* row on UPDATE, on top of the
update policy's own `with check`. A professional therefore cannot write their
own release — the instant `provider_id` is null the booking stops matching
"Providers read their assigned bookings" — and no update policy can rescue it;
one with `with check (true)` fails identically. The shape that works is the one
`declineJob` uses: prove ownership with an RLS **read**, then write under the
service role. Expect this again for any "hand it back" or "give it up" path.

**`is_admin()` must keep `execute` for `authenticated`, and Supabase's Security
Advisor will keep telling you to take it away.** Six policies call it —
profiles, triage_logs, bookings, payments, refunds, booking_status_history —
and a policy expression is evaluated with the *caller's* privileges, so
revoking it breaks every read in the product for every signed-in user. The
advisor cannot see that; the answer is no. Everything else it flags on
functions was taken: `20260903000001_harden_functions.sql` pins `search_path`
to empty on all six and revokes `execute` from `public` on the trigger
functions. Firing a trigger does not re-check `execute` against the caller —
Postgres checks that when the trigger is created — and
`tests/db/booking-rls.test.ts` asserts both halves rather than trusting either.

**`= false` and `is false` are the same thing inside a PL/pgSQL `IF`, and a
comment claiming otherwise is worse than no comment.** `enforce_claim_refund`
gates its parts deduction on `new.parts_failed is false`, and the migration
first claimed that spelling is what stops an unanswered question deducting
anything. It is not: PL/pgSQL takes a NULL condition as false, so both forms
branch identically — proven by rewriting the SQL to `= false` and watching all
52 db cases stay green, which is exactly the "break it on purpose" step
catching a claim rather than a bug. `is false` is kept because it says what is
meant and because it keeps behaving that way if the condition is ever lifted
into a WHERE clause, where a NULL from `= false` propagates instead of
collapsing. The guarantee that an unanswered question costs nothing is asserted
as **behaviour**, never as a text match.

**Revoking a function grant on Supabase means three roles, not one.** Supabase
grants `execute` directly to `anon` and `authenticated` through a default
privilege on `public`; `revoke ... from public` leaves both in place and clears
nothing. The harness models that default privilege now, so a revoke that misses
them fails locally instead of only showing up as warnings that would not go
away.

## The installable app

It installs from the browser, and `docs/TWA.md` is how it becomes a Play Store
listing. The whole thing is `lib/pwa/`, and one rule carries the weight.

- **The service worker stores no document for any real route, and that is
  structural rather than careful.** Every number a customer reads here — a
  quoted band, a final amount, what a professional is owed — lives in an HTML
  document or a JSON response, so the usual shape, network-first, is a promise
  about ORDERING that still writes the stale copy into a cache one failed
  request away from being served. `lib/pwa/cache-rule.ts` keeps
  `/_next/static/**`, which is content-hashed so a changed file is a changed
  URL, plus a shell of the offline page in both languages, the manifest and
  three icons. **`never` is the DEFAULT and not a deny-list**, so a screen
  shipped next phase is uncached without anybody remembering — a deny-list of
  money pages is exactly the artefact that is one phase out of date. The proof
  runs the rule over every route in `scripts/deployed-routes.mjs`, as
  navigations AND as plain fetches, because a soft navigation pulls the RSC
  payload with `mode: "cors"` and the prices are in it exactly as they are in
  the document.
- **The offline page is the only HTML stored, so it contains nothing.** No
  session, no price, no count, and deliberately not `site.supportPhone` —
  exactly what somebody with no signal would want, read from an environment
  variable, frozen onto a phone at install. A stale number there is the dead
  escape hatch `site.ts` already records as reading like contempt.
- **The rule's own source text is pasted into the worker, and the paste is
  bound to a name WE choose.** `next build` minified `cachePolicy` to
  `function f(a,b){…}`, so the generated script defined `f` and called
  `cachePolicy`: a ReferenceError on the first fetch, the browser discards the
  worker, every page keeps working, no offline shell, and nothing in any log
  this product reads. **A PWA failure presents as a working website**, which is
  the class — found by reading the bytes `next start` served, not by a check.
  Three tests cover it now, one of them handing the generator a deliberately
  renamed function. `CacheRule` is passed in rather than closed over for the
  same reason one level down.
- **`cache.addAll` is all-or-nothing, so one 404 in the shell means nobody ever
  gets an offline page** — silently, with the site working. `check:deployed`
  walks every shell URL against the deployment. The list is one JSON file with
  three readers (the rule, the generator, the walk) because a `.mjs` copy for
  the script would be the sin in the one place that decides whether the app
  installs at all.
- **A photograph taken with no signal is held as the camera wrote it.**
  `lib/pwa/photo-queue.ts`, IndexedDB, because the arrival panel's
  `localStorage` queue correctly refused to carry two megabytes and said so in
  writing. **Never a re-encode**: a canvas destroys EXIF and
  `lib/photos/evidence.ts` REFUSES a file with no camera clock, so a helpful
  compression would queue something our own gate rejects while the professional
  believed they had sent evidence. `queuedAt` is housekeeping and never
  evidence — the capture time is inside the file. Held seven days, anchored to
  `CLAIM_FRESHNESS_WINDOW_DAYS`, because past that the server declines it anyway.
- **Push first, SMS only on a miss that costs somebody something.** `notify()`
  is three tiers now: the in-app row always, for every kind, because it is the
  record; push where a kind is worth interrupting somebody for; SMS only where
  push could not reach them AND the kind is worth paying for. `WORTH_AN_SMS` is
  strictly smaller than `WAKES_A_PHONE` — "fall back for everything push
  covers" is how a free channel's generosity becomes a bill that scales with
  every booking. **"Not delivered" means what a sender can know**: a push
  service answers 201 when it has TAKEN a message, never when a phone has shown
  it, so the fallback fires on "nobody to send to" and "every endpoint refused"
  and not on a read receipt that does not exist. `notConfigured` does not
  escalate — that is OUR missing key, and billing somebody's phone for it would
  send an SMS for every notification in a fresh deployment.
- **`payout.destinationChanged` is push-only**, honouring the trap
  `lib/notify/channel.ts` wrote down before any channel existed: an account
  takeover changes the phone number too, so an SMS read at send time warns the
  attacker. Nothing in this schema records the previous number, so there is no
  honest SMS — and a push subscription cannot be redirected from inside the
  product. Refused by the list and again in the data layer.
- **No browser writes `push_subscriptions`.** The obvious design is an insert
  policy for `authenticated`, and that is a row whose `profile_id` the browser
  chooses — somebody else's notifications delivered to your phone. Writes go
  through a server action that re-reads the session.
- **`/sw.js` is served `no-store`**, which is the classic way to get stuck:
  an intermediary holding it for a day is a day in which no update can reach
  anybody, and versioning the cache by commit exists precisely so one always
  can. `middleware.ts` excludes it, the manifest and `.well-known` by name — a
  browser refuses to register a worker from a redirect, the catch swallows it,
  and the product works with no offline support.
- **`/.well-known/assetlinks.json` answers 404 until a keystore exists.** A
  committed placeholder fingerprint would publish a statement matching no app,
  fail verification silently, and show up as an address bar on somebody else's
  phone weeks later. `twa.assetlinks` and `notify.push` on `/api/health` are
  both the `SMS_HEALTH_NUMBER` lesson applied before it costs anything, and
  both are **always `skipped`** — a product with no push keys and no Android app
  serves customers perfectly well, and `servesCustomers` turns anything else
  into a 503.

## Motion — the standing rule

Every screen ships with considered motion. Not decoration: motion whose job is
to make state changes legible.

Baseline for every phase:

- **Route transitions** — brief fade or slide, never a hard cut. Implemented
  with `template.tsx` (it remounts on navigation, so a CSS entrance runs) not a
  motion library. **Client navigations only.** On a cold load every page in the
  group is inside that wrapper, so a fade from `opacity: 0` leaves the browser
  nothing contentful to paint: /login had no first-contentful-paint at all and
  Lighthouse scored it 0. The module-level flag in `app/(auth)/template.tsx` is
  what keeps the first paint unanimated — same rule as the hero.
- **Every state change animates in** — loading, success, error, empty→filled.
  Nothing appears.
- **Every interactive element** has hover, active/press, focus and disabled
  states with real transitions. The press state lives on the `Button` base so
  it is never forgotten.
- **Lists and grids stagger** their entrance 40–60ms apart, capped so a long
  list does not crawl (`Math.min(i * 0.05, 0.25)`).
- **Skeletons for anything async** — never a blank gap, never a bare spinner.

Restraint:

- 150–300ms. Ease-out for entrances.
- No bounce or spring unless it earns it.
- `prefers-reduced-motion` always honoured — end state, instantly.
- CSS first. Framer Motion only where CSS genuinely cannot do it.
- Never delay interactivity for an animation.

## Above-the-fold and entrance animations

Never let a motion library own the visibility of content. `motion`/`m`
components render `opacity: 0` into the **server HTML**, so anything wrapped in
one is invisible until the JS bundle lands — on a patchy Nepali connection that
is a blank page.

- Hero / above the fold: `.animate-rise`, pure CSS, runs off first paint.
- Below the fold: `<Reveal>` — CSS plus one IntersectionObserver. Default state
  is visible; the pre-reveal style is gated on `.js`, which an inline script in
  `app/layout.tsx` sets before first paint.
- Framer Motion is still available via `MotionProvider` (dynamically imported,
  so pages that don't use it pay nothing). Use `m.*`, never `motion.*`.

Every animation needs a `prefers-reduced-motion` fallback that shows the end
state instantly — no exceptions. They live in one block at the end of the
utilities layer in `styles/globals.css`.

Never mount `MotionProvider` globally. `LazyMotion` fetches its features when
the _provider_ mounts, not when an `m` component renders, so a root-layout
mount shipped 51 KB of motion code to a landing page that uses none of it.

**Type is the biggest thing on the page, not JavaScript.** Fonts were 207 kB
against ~90 kB of script, and the Devanagari face alone was 119 kB — the single
largest asset, downloaded on _English_ pages to render two glyphs in the
language toggle. The rule that applies it is scoped to `:root[lang="ne"]`
(styles/globals.css), so English pages never fetch it: mobile Lighthouse on `/`
went 90 → 97. Before reaching for a JavaScript optimisation, check what the
fonts are doing — TBT on the landing page is 40 ms, so script execution is not
what is costing points.

`/ne` still carries all 119 kB and sits at 90. Dropping Noto Sans Devanagari to
a single weight halves the file and measures 95, at the cost of synthesised
bold on every Nepali heading — a type decision, not a performance one, so it
has not been taken. The option that gets both is a self-hosted glyph subset
built from `messages/ne.json`; that is a build step, and a later phase.

**`buttonVariants` for a button that is only a button.** `components/ui/button`
is `"use client"` — it needs Radix's Slot for `asChild`. A Server Component that
just wants the look (a submit button in a GET form, a link styled as a button)
imports `components/ui/button-variants` instead, which has no React in it.
Importing the component put 12 kB of Slot and cva runtime on `/services` for
one search box, and the bundle budget is what caught it.

Lighthouse on the landing page must stay ≥ 90 for performance and 100 for
accessibility. `/design-system` scores SEO 60 on purpose — it is `noindex`.
Take the median of 3 runs: this machine swings ±6 points on identical code, so
a single run will send you chasing noise.

## Latency — the rule that mattered more than every optimisation before it

The app was slow everywhere and the cause was not the code. **Vercel functions
default to `iad1` (Washington DC); the Supabase project is `ap-southeast-1`
(Singapore).** Every query crossed the Pacific — about 250ms — and a signed-in
page makes eight to twelve of them, several of them sequential. That is two to
three seconds of waiting before a byte is sent, on a product where nothing had
gone wrong. `vercel.json` now pins `"regions": ["sin1"]`, which is also far
closer to Nepal than Virginia is.

**Speed is a standing task, not a phase.** The region move was the big step and
it is done — `sin1`, confirmed by `server.region` on `/api/health`, which
measures the round trip rather than trusting the region name. **The "28ms"
this line used to carry was stale**: a live reading on 2026-10-15 was 81ms, and
the figure here had not been re-measured since the move. That is this file's own
recorded shape — a number written into standing notes is a number nobody
re-measures — so it is not replaced with 81, which would be stale by next week
too. The screen carries the figure; this line says only which way it leans.
**81ms also 503'd production**, because the bar is 80 and `servesCustomers`
turns `down` into a 503: see `REGION_SLOW_STATE`. The bar did not move; what
it costs did. What remains is smaller
and gets taken a step at a time as the product grows, because each one costs
something in complexity and none is worth paying for before it is needed. In
the order they are likely to matter: caching the catalogue reads so a filtered
`/services` does not re-query per visitor; splitting the site header's session
read out of the shared layout so public pages can be statically served;
image handling once there are photographs and galleries; and pagination on
`/bookings` and the provider job list once anybody has more rows than fits a
screen. Revisit after any phase that adds data volume — the app currently has
almost none, and that is exactly why it must not be assumed to be fast later.

**So the standing rule: the serverless region and the database region are one
decision, not two.** Anything that changes either is a latency change and says
so in the summary. Everything below follows from the same arithmetic — a round
trip is the unit of cost, and the job is to make fewer of them.

- **Reads that do not depend on each other go in one `Promise.all`.**
  `/bookings/[id]` was a Promise.all followed by four more awaits in a row,
  purely in the order they were written: five waves where one would do.
- **A server action that calls `revalidatePath` already returns the re-rendered
  page.** `router.refresh()` after one is a second full round trip for the same
  screen, and it is why every button "spun for a long time". Removed
  everywhere; the one that remains re-verifies with a gateway and says so.
- **`getSessionProfile` is `cache()`d per request.** It is two network calls —
  verify the token, then read `profiles` — and the header, the page and
  sometimes a component inside it each asked separately.
- **Public data is read without cookies.** `lib/supabase/public.ts` is the
  cookie-free anon client for the catalogue; touching `cookies()` opts a route
  out of static rendering for ever, and nothing about a category list varies by
  visitor. Anything that depends on who is asking keeps `createClient()` —
  with the public one there is no who.
- **`/api/health` reports the region and the measured distance to the
  database** — `server.region`, three samples, median. A region setting that
  silently failed to apply is exactly this endpoint's kind of fault: it lives
  in somebody else's dashboard and no local check can see it. It is a URL, so
  it needs no checkout to read.
  **Three verdicts, not two, and the split cost a 503 to learn.** A wrong
  region stays `down` — `iad1` against a Singapore database is ~250ms on every
  one of a dozen queries per page, it is binary so it cannot flap, and it is
  worth waking somebody for. The RIGHT region measuring slow is `ok` with the
  number printed, because nobody is kept out of the product by it. Those were
  one branch, so a reading of 81 against a bar of 80 answered "this cannot
  serve a customer right now" with every dependency green — the third time this
  endpoint has done that, after `session.config` and `checkTriageFallback`.
  **And the message named the wrong remedy**: "check `regions` in vercel.json
  and redeploy" printed on a deployment where `vercel.json` already said `sin1`,
  so anybody following it opens the file, finds it correct and has nowhere to
  go. The bar is still 80; only what exceeding it costs has changed.
- **`npm run check:timing`** measures time to first byte per route, median and
  worst of N. It refuses to report a blocked request as fast: Vercel stamps
  `x-vercel-id`, and without that header the request never arrived. Same
  sandbox limit as `check:deployed` — it exits 2 rather than lying.

## Performance guard

Numbers in a summary are not a guard. Two things run automatically:

- **Bundle budget** — `npm run build` is `scripts/check-bundle-budget.mjs`,
  which runs `next build` and then fails on the printed route table. Ceilings
  live in `scripts/perf-budget.mjs` **and are not repeated here** — the two
  copies had already drifted, this file still saying `/[locale]` 155 kB and
  `/[locale]/login` 205 kB when the script had moved to 158 and 140. Nothing
  failed, because the script is what runs; the cost is that a number in the
  standing notes read as authoritative and was wrong by 65 kB in one direction
  and 3 in the other. One place, and `npm run build` prints every ceiling beside
  what was measured. Vercel runs `npm run build`, so a
  regression cannot deploy. Raising a ceiling is a decision — move it in the
  commit that needs it and say why. They moved once, for next-intl: its client
  runtime is ~18 kB on the landing page and 5-6 kB elsewhere, and it is not
  optional while the hero renders a triage result in the browser.
- **Paint check** — `npm run check:paint` loads the four front doors in each
  language in a real Chromium and fails if any never records a
  first-contentful-paint. That is the signature of content hidden behind an
  entrance animation, and it has now happened twice. It is not in `next build`
  because Vercel's builder has no browser; `.github/workflows/ci.yml` runs it
  on every push, and `npm run verify` runs the whole set locally.
- **Message check** — `npm run check:messages` fails if `en.json` and `ne.json`
  disagree on a key or an ICU placeholder. next-intl renders a missing key as
  its own dotted path, so without this the failure mode is a button labelled
  `services.card.book` on a page nobody on the team reads.
- **Plural rule** — `check:messages` refuses `{n}` sitting in front of a
  plural noun with no `plural` branch, because `/admin/guarantee-claims`
  shipped reading "this customer has claimed **1 times** on 6 finished jobs",
  on the screen where somebody decides how much of a customer's money goes
  back. It was a class rather than an instance: nine strings had the shape and
  **six predated the bug that prompted the search** — "1 jobs done" on the
  bookings summary, "1 years' experience" on a provider card, both live and
  customer-facing. The idiom was already in the catalogue and simply not
  reached for: `{count, plural, one {{n} job} other {{n} jobs}}` in English,
  a single `other` branch in Nepali, both carrying `count` and `n` so the
  placeholder sets still match. **Nepali gets no plural branch** — वर्ष, काम
  and पटक do not inflect, and branching would invent a distinction the
  language does not make. The rule is allowed to be a regex where
  `check:keys` is not, because it reads a JSON string for a fixed two-token
  shape and flagged exactly nine with no false positives; it **self-tests on
  every run**, asserting it still flags a known-bad string and still passes
  correct copy, so a rule that has stopped biting says so. `ALLOWED_INVARIANT`
  is the escape hatch and is empty on purpose.
  `tests/unit/plural-counts.test.ts` renders the strings through next-intl as
  well, because a branch that exists but selects wrongly passes the lint.
- **The plural rule needed the noun IMMEDIATELY after `{n}`, and one adjective
  defeated it.** "Their rating comes from {n} completed jobs" shipped to the live
  profile page reading "1 completed jobs" — the exact defect the rule exists for,
  one word out of reach. It asks three widths now, **each separately**: a single
  greedy pattern took "settled jobs" as filler and landed on "is", so the widened
  version silently missed a string the narrow one would have caught. `NOT_A_COUNTED_NOUN`
  is a short closed list of words that end in `s`, follow a number and are not
  nouns being counted — without it the wider rule flagged "{n} booked this week",
  and a checker that flags correct copy is one whose real entries get skimmed.
  It caught two more live strings; `ALLOWED_INVARIANT` carries its first entry,
  `rotationPool`, where `{n}` counts the pool and `offers` is the object of
  "receiving" rather than the thing counted.
- **That same fix exposed a false positive in the placeholder check itself.**
  It read `{X}` or `{X,` as an argument, so `=0 {None, on {jobs} finished
  jobs}` was reported as English "using {None}" and Nepali failing to — wrong
  in both directions, and it would have hidden a genuine mismatch behind the
  noise. A name is an argument only when the brace closes straight after it or
  a real ICU type follows (`plural`, `select`, `number`, `date`…); everything
  else is branch text. The tempting fix was to reword copy until the regex
  stopped complaining, which would have left the trap armed for the next
  person to write a branch beginning with a word and a comma.
- **Key check** — `npm run check:keys` is the other half, and it exists because
  a key missing from **both** catalogues agrees perfectly and sails through the
  one above. `admin.detail.payoutIsSomebodyElses` rendered as its own name on
  the live application-review screen, where it was meant to tell the reviewer
  the payout number is one we never sent a code to; two more were found the
  same day. It resolves every `t("…")` call to its namespace **through the
  TypeScript AST**, never a regex — three regex versions were written first and
  each reported dozens of keys that were fine, defeated in turn by a name
  rebound later in a file, by `generateMetadata` and its page binding the same
  name, and by a binding destructured out of a `Promise.all`. A checker that
  cries wolf gets skimmed, and the one real entry goes with the noise. Dynamic
  keys (`t(\`errors.${x}\`)`) are **reported, never guessed at** — the shape
  that makes those safe is the allow-list `listNoteKey` uses in `lib/notify`.

- **Deploy check** — `npm run check:deployed` (optionally with a URL) asks the
  live site which commit it is serving, via the `x-build-commit` meta that
  `next.config.mjs` stamps and `app/[locale]/layout.tsx` renders, then walks
  every route and checks `og:url` matches the host. The lists live in
  `scripts/deployed-routes.mjs`. It is not in `next build` — it tests the thing
  the build produces, which does not exist yet at build time — and it cannot
  run from the agent sandbox at all.
  **It walked public pages only for four phases, and "we cannot sign in" had
  quietly become "we check nothing".** There is no way for a script to
  authenticate here — the one door is a phone OTP and that gateway is a launch
  blocker — so twelve admin screens, `/provider/jobs`, `/bookings` and
  `/account` shipped with no live check of any kind and could have 404ed in
  production without anything noticing. **A signed-out request proves three
  things and they are worth having**: the page deployed (a 404 is a 404 with or
  without a session), the guard is on (a 200 to nobody is an admin panel on the
  open internet, and nothing else in the repository can see that), and the
  redirect keeps the reader's language — the `/ne` half of every guard, which
  `lib/auth/routes.ts` exists for and which nothing had ever checked against a
  deployment. What it cannot see is the body, so a guarded route gets no
  `og:url` and no commit stamp; that costs nothing, because one deployment
  serves one build and the stamp read off `/` is every route's stamp.
  **`/verify` is judged as guarded although it is a public route**: it redirects
  from inside the page when it arrives without a number, and from outside that
  is the same fact. The classification is the observable contract, never the
  layer that answered.
  **`coverageGaps` is what stops the list going stale**: it reads the page files
  and fails on any static route on neither list, because a route nobody listed
  gets no request made to it and that looks exactly like success. The other
  direction needs no rule — a deleted route 404s on the walk.
  **It checks the cron targets too, because a cron nobody calls looks identical
  to a cron with nothing to do.** `/api/payments/reconcile` runs
  `sweepRedoRecovery`, and with no debt outstanding a correct run writes nothing
  — so "ran and had nothing to do" and "was never invoked" produce byte-identical
  evidence, which is `applyRedoRecovery`'s four-phase sin wearing a schedule.
  The paths come out of `vercel.json` (`cronPaths`) rather than a copy, so a cron
  added tomorrow is walked tomorrow, and an unparseable file reads as **null**
  rather than as no crons — `[]` would walk nothing and print no failures at all.
  Asked with **GET and no secret**: the handler refuses before doing any work, so
  the check reconciles nothing. **401 is the pass** — deployed and guarded. A 404
  is the failure worth having, because a scheduler firing at a missing page
  appears in Vercel's cron log as an invocation that happened; a 200 means a
  money sweep anybody can trigger. **It cannot prove `CRON_SECRET` is set** — the
  handler answers 401 for a wrong secret and for no secret alike, which is
  correct and makes them indistinguishable from outside, so `?deep=1` is what
  proves the secret — **and reachability is never evidence that anything fired.**
  Only Vercel's cron log says that.
  **The rules self-test on every run and again in
  `tests/unit/deploy-check.test.ts`**, which matters more here than anywhere
  else: this script runs in neither CI nor the sandbox, so between one human run
  and the next nothing else exercises it. `--self-test` runs the rules and the
  coverage pass with no network at all.

All are proven by breaking them on purpose, not by passing once. Lighthouse
is still the periodic check — the bar and the median-of-3 rule are unchanged.

## Signed-in pages

`app/[locale]/(app)/` holds them: site header and footer, page content in the
middle. Everything that renders a page lives under `app/[locale]/` —
`app/api/triage/route.ts` is deliberately outside it, because it is not a page
and must never be rewritten to `/ne/api/triage`. `app/[locale]/[...rest]` is
the catch-all that puts an unknown path back inside the locale tree so
`not-found.tsx` can answer it in the right language.
`/bookings` and `/account` are placeholders with real empty states — Phase 6
fills the first, Phase 10 makes the second editable — but they exist now
because the account menu links to them and a 404 from your own menu reads as
a broken product.

**`/bookings` answers two questions before it lists anything**: is anything
happening, and does anything need me. It was a stack of identical cards
newest-first, which answered neither — a professional on the way sat between
two jobs finished in June, and a booking silently held at its trip
confirmation looked exactly like one that was proceeding. Three tiers now:
**Needs you**, then **Happening now** at full weight with the name of the
person coming, then **Earlier**, quiet and small. `attentionFor` in
`lib/booking/attention.ts` is the rule and it is pure, so what counts as
needing the customer is tested and can drive a notification later without
being written twice. It returns **one** thing per booking — a card with two
calls to action has none — and `resolveMismatch` outranks `pay` because
nothing settles while the figures disagree. The page still ships **no client
JavaScript**: it is all links, so it is correct on a connection that never
finishes loading a bundle, which is the state somebody is in when they are
checking whether anybody is coming. The "book again" button stays in the
header and goes to `/services`, the same destination as the empty state, so
the two can never disagree.

`components/shared/empty-state.tsx` is the shape: quiet, no warning colour, and
always an action. A screen that says "nothing here" and offers no way forward
is a dead end.

`components/shared/route-transition.tsx` is the one route entrance, used by
both `template.tsx` files.

Footer links to pages that do not exist yet carry `soon: true`, which sets
`prefetch={false}`. Without it every page with a footer fired a dozen 404s into
the console. Delete the flag in the phase that ships the page.

## Gotchas

- `cn()` extends tailwind-merge with our custom type scale. Any new step added
  to `fontSize` in `tailwind.config.ts` must also be listed in `lib/utils/cn.ts`,
  or tailwind-merge mistakes it for a colour and silently drops real colours.
- The shadcn registry and `*.vercel.app` are unreachable from the sandbox.
  Write primitives by hand against the shadcn contract; trust the user's word
  on whether the deploy is up.
