# SajiloKaam — working notes

AI-native home services platform for Nepal. Next.js 14 (App Router) · Tailwind ·
shadcn-style primitives · Supabase · Claude · Vercel.

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
- **Automate everything reachable.** Only ask the user for things that need
  their account or a credential, and then ask for one thing at a time.
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
   natural approach as well as the correct one. Romanized Nepali has no
   spelling standard, so those lists stay deliberately loose. Anything matching
   user text gets cases in `tests/unit/hazard-corpus.test.ts` phrased the way
   somebody in a hurry would actually type them — including the ordinary
   complaints that must NOT fire, because a product that cries wolf is worth
   nothing when it is real ("करेन्ट आएको छैन" means the power is out).
6. **When something breaks, reproduce it with a failing test first.** Never fix
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
- **Rate limit** 12/min and 60/hour, per user id when signed in, per IP
  otherwise. **Cache** 10 minutes, text only, 500 entries. Both are in-process,
  so on Vercel they are per-instance: a soft cost ceiling, not a security
  control. Swap in Upstash behind the same signatures when it matters.
- **Not streamed.** The response is one small object that has to pass schema
  validation, the price clamp and the safety floor before anyone sees it.
  Streaming would mean showing fields we haven't finished checking.
- **Every triage is logged** to `triage_logs` (text, photo yes/no, category,
  urgency, latency, source, hazard). The photo is never stored. `hazard` is
  written as `text:gas`, `vision:burning` or `unseen-photo`, so the two
  detectors can be compared later. This is the only record of whether the bands
  are right — Phase 9 reads it.
- **The dev badge.** A silent fallback is indistinguishable from a working
  product — with no API key every triage still answers. The card carries a
  small line saying which path served it and why (`no ANTHROPIC_API_KEY`,
  `timeout`, `the reply failed validation`…). It shows in development, and
  anywhere with `?debug=triage` on the URL, because this branch deploys to
  production and a strict production check would hide it exactly where it is
  needed. Ordinary visitors never see it.

`lib/mock/` — `activityFeed.ts` (becomes a Supabase realtime subscription in
Phase 8) and `categoryStats.ts` (becomes a rolling booking aggregate in
Phase 5). Every mock file states in a comment what replaces it and when.

## Services and discovery

`categories` is the single source of truth for the ten services — the landing
grid, `/services`, the category pages and the price bands in the triage prompt
all read from it, so repricing happens once.

The authored copy is `lib/data/seed/*.json`. It seeds the tables
(`npm run seed:sql` regenerates the seed migration) **and** it is the fallback
every read falls back to when Supabase is unconfigured or unreachable. That is
why a fresh clone with no keys still renders the whole product. Edit the JSON,
re-run `seed:sql`, apply the migration — never edit the generated SQL.

`lib/data/` is the boundary: `categories.ts`, `providers.ts` (list, one, counts,
reviews) and `ranking.ts`. Pages never touch Supabase directly.

**The fallback is a blind spot, so it announces itself.** The seed and the
tables hold the same rows, which means a broken query renders a page that looks
perfect. Every read records which path it took (`lib/data/source.ts`) and
`?debug=data` prints it — `categories: database · providers: seed`. Same rule
as the triage badge: dev, or the query param on any deployment. If you add a
read to `lib/data/`, call `markDataSource` on both branches.

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
safety copy, anything a frightened person reads — say so in the handover rather
than shipping it silently.

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
  credentials are real. Point it at a Supabase *test* number and it is free.
- **`unknown` is never `ok`.** Not looking must never read as working; that is
  precisely the confusion that let this run for a day.
- **The login screen never dead-ends.** `strandsCustomer()` decides when the
  failure is ours and unfixable by retrying, and then the screen offers a phone
  number instead. A mistyped digit gets the ordinary error — telling somebody to
  ring support when they need to retype a character is how a working product
  comes to feel broken.
- **`?debug=auth`** prints the provider's own status and message on the login
  form. Same rule as the triage and data badges: dev, or the query param
  anywhere. Finding this the first time meant reading a network response in
  DevTools, which nobody does on a phone.
- **`site.supportPhone` is one constant.** It appears on five screens and one
  of them is that fallback — the screen somebody reaches when nothing else in
  the product is working for them.
- The SMS gateway is a **launch blocker** until `?deep=1` reports
  `auth.sms: ok` against production. The dashboard looked correct the whole
  time it was broken.

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
  for ranking, and `withdrawalPenalty` in `lib/data/ranking.ts` is where it
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
  The screen carries the sentence that makes blind entry honest: *your 30-day
  guarantee covers up to the amount you enter*. That belongs on the screen, not
  in the terms.
- **A receipt goes to both sides on every settlement**, carrying the recorded
  amount. Somebody who paid 2,000 and receives a receipt for 1,000 notices —
  afterwards, when the professional has left and saying so costs nothing. It is
  a notification key, so Phase 13 sends it over SMS by adding a channel.
- **Digital is paid out sooner because it is verified sooner** —
  `lib/payments/payout.ts` holds every lever in one place: hold time per method
  (real, and doing the work today), a commission differential either way, an
  opt-in instant payout, and the customer-side incentive. All the
  differentials ship at zero; turning one on is one edit there. Ranking is
  deliberately **not** a lever — list position must not depend on how the
  customer chose to pay.
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

## Schema

`supabase/migrations/`, applied in filename order. If it is not in a migration
file it does not exist — nothing gets clicked into the dashboard.

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

**Revoking a function grant on Supabase means three roles, not one.** Supabase
grants `execute` directly to `anon` and `authenticated` through a default
privilege on `public`; `revoke ... from public` leaves both in place and clears
nothing. The harness models that default privilege now, so a revoke that misses
them fails locally instead of only showing up as warnings that would not go
away.

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
- **`npm run check:timing`** measures time to first byte per route, median and
  worst of N. It refuses to report a blocked request as fast: Vercel stamps
  `x-vercel-id`, and without that header the request never arrived. Same
  sandbox limit as `check:deployed` — it exits 2 rather than lying.

## Performance guard

Numbers in a summary are not a guard. Two things run automatically:

- **Bundle budget** — `npm run build` is `scripts/check-bundle-budget.mjs`,
  which runs `next build` and then fails on the printed route table. Ceilings
  live in `scripts/perf-budget.mjs`: `/[locale]` 155 kB, `/[locale]/login`
  205 kB, any route 210 kB, shared 95 kB. Vercel runs `npm run build`, so a
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

- **Deploy check** — `npm run check:deployed` (optionally with a URL) asks the
  live site which commit it is serving, via the `x-build-commit` meta that
  `next.config.mjs` stamps and `app/[locale]/layout.tsx` renders, then walks
  every route in `ROUTES` and checks `og:url` matches the host. Add a route to
  that list in the phase that ships it; a page missing from it is a page nobody
  is checking. It is not in `next build` — it tests the thing the build
  produces, which does not exist yet at build time — and it cannot run from the
  agent sandbox at all.

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
