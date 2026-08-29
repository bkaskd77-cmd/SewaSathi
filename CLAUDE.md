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
- **Automate everything reachable.** Only ask the user for things that need
  their account or a credential, and then ask for one thing at a time.
- **Be brief.** Short answers, copy-pasteable steps, no walls of text.

### The handover — five headings, nothing else

Write these five, in this order, and stop. A heading with nothing under it gets
deleted, not padded.

- **Built** — what now exists that did not before. Bullets, not prose.
- **Decided** — the calls made and the one-line reason for each. Only decisions
  that constrain what comes next; leave out anything reversible and obvious.
- **Fixed** — bugs found on the way, including ones that were already there.
  Say which were pre-existing.
- **Verified** — what was actually run, with the numbers. "Tests pass" is not a
  verification; "median-of-3 mobile Lighthouse 97, budgets green, 8 paint
  checks" is. If something was not checked, say so here.
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

Both are proven by breaking them on purpose, not by passing once. Lighthouse
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
