# SajiloKaam — working notes

AI-native home services platform for Nepal. Next.js 14 (App Router) · Tailwind ·
shadcn-style primitives · Supabase · Claude · Vercel.

## Working agreement

- **One phase at a time.** At the end of each phase, hand over a concise
  summary: what was built, what was decided, what is verified, what is next.
- **Deploy by pushing.** The branch is the Vercel production branch — a push
  deploys. Never ask the user to click Redeploy.
- **Automate everything reachable.** Only ask the user for things that need
  their account or a credential, and then ask for one thing at a time.
- **Be brief.** Short answers, copy-pasteable steps, no walls of text.

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

The header toggle writes a `sajilokaam-locale` cookie and refreshes; the server
reads it (`lib/i18n/server.ts`) and renders category names from `name_ne`. That
is all it does today, deliberately.

`lib/i18n/locale.ts` is constants and types only — the toggle is a Client
Component and `next/headers` cannot be bundled for the browser.

**Before extending this**, decide the approach once. The recommendation is
next-intl with `[locale]` segments, message catalogues per namespace, and
Nepali as a first-class locale rather than a translation layer bolted on: it
gives locale-aware routing and metadata, keeps strings out of components, and
handles plurals and dates, which hand-rolled cookies never will. Retrofitting
it across twenty screens costs a week; doing it before Phase 6 adds screens
costs a day.

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

Lighthouse on the landing page must stay ≥ 90 for performance and 100 for
accessibility. `/design-system` scores SEO 60 on purpose — it is `noindex`.
Take the median of 3 runs: this machine swings ±6 points on identical code, so
a single run will send you chasing noise.

## Performance guard

Numbers in a summary are not a guard. Two things run automatically:

- **Bundle budget** — `npm run build` is `scripts/check-bundle-budget.mjs`,
  which runs `next build` and then fails on the printed route table. Ceilings
  live in `scripts/perf-budget.mjs`: `/` 140 kB, `/login` 190 kB, any route
  200 kB, shared 95 kB. Vercel runs `npm run build`, so a regression cannot
  deploy. Raising a ceiling is a decision — move it in the commit that needs
  it and say why.
- **Paint check** — `npm run check:paint` loads `/` and `/login` in a real
  Chromium and fails if either never records a first-contentful-paint. That is
  the signature of content hidden behind an entrance animation, and it has now
  happened twice. It is not in `next build` because Vercel's builder has no
  browser; `.github/workflows/ci.yml` runs it on every push, and
  `npm run verify` runs the whole set locally.

Both are proven by breaking them on purpose, not by passing once. Lighthouse
is still the periodic check — the bar and the median-of-3 rule are unchanged.

## Signed-in pages

`app/(app)/` holds them: site header and footer, page content in the middle.
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
