# Launch blockers

Everything in this product that is **invented, placeholder, or a claim we
cannot currently stand behind**, on a URL a member of the public can already
open.

Each entry is a claim a visitor would reasonably believe. A comment in the
source saying `MOCK DATA` protects the next developer; it does not protect the
person reading the page. This file is that protection, and
`npm run check:blockers` is what stops it from becoming a note nobody reads.

## How the guard works

`scripts/check-launch-blockers.mjs` parses the entries below and fails the
build when **all** of these hold:

- `LAUNCH=true`
- `NODE_ENV=production`
- one or more entries are still `unresolved`

So ordinary development and preview deploys are unaffected, and the build that
would put this in front of real customers cannot succeed while a false claim is
still on the page. Resolving an entry means changing its `Status` line to
`resolved` **in the same commit that removes the mock**, not before.

## Entry format

Parsed, not decorative. Keep the four fields and the heading shape.

```
### BLOCKER: some-id
- Status: unresolved
- Claims: what a visitor would believe
- Lives in: the files
- Replaced by: what makes it true
```

---

### BLOCKER: sms-gateway-unverified
- Status: unresolved
- Claims: "We text you a 6-digit code and you're in." Phone OTP is the ONLY way into this product — there is no email or password path anywhere — so if the gateway is not real, nobody signs in, nobody books, and the failure is total rather than partial.
- Lives in: Supabase → Authentication → Providers → Phone (an external dashboard, not this repository), reached through `lib/auth/otp.ts`
- Replaced by: real SMS credentials, proved end to end by `GET /api/health?deep=1` reporting `auth.sms: ok` against a production deployment — not by the dashboard looking correct. It looked correct while every send was failing with Twilio 20003, and the only thing that noticed was a person trying to log in.
- Measured 2026-09-10, against production, sending to a real Nepali number: `422: Error sending confirmation OTP to provider: Authenticate` — Twilio error 20003, credentials rejected. **Not a deliverability question and not a Nepal routing question: the request never leaves Twilio's front door.** So this is no longer a suspicion carried over from the August incident, it is the current state, and no walkthrough of this product can sign anybody in over real SMS until it changes. Nothing was sent and nothing was charged, because a refused authentication costs nothing. The three things built after that incident all did their job on the same screen: the customer sentence said nothing about the cause, `?debug=auth` named it exactly, and `strandsCustomer()` decided the failure was ours and offered the phone fallback — which is itself a placeholder, see `support-phone-number`. **Those two blockers compound and the screenshot proves it: the only way in is dead, and the escape hatch printed beside it does not ring.** Until a gateway is real, the Supabase test numbers in `test-account-otps` are not a convenience, they are the only way anybody signs in at all.

### BLOCKER: test-account-otps
- Status: unresolved
- Claims: nothing to a visitor — this one is a way in rather than a promise on a screen. Seven numbers in `provisioned_accounts` carry standing roles, three of them admin, and six are configured in Supabase as test numbers with a fixed six-digit code. A fixed code is a password that never rotates, and it opens an account that can read every profile, every address and every identity document. Today that is a product with no real customers in it and the exposure is one unshipped database; the day there are real users it is an unrotatable admin credential on a public login form.
- Lives in: Supabase → Authentication → Providers → Phone → test numbers (an external dashboard, not this repository), and `public.provisioned_accounts`, whose roster is recorded in `scripts/provision-accounts.sql`
- Replaced by: deleting the four walkthrough numbers (`9800000011`, `9800000012`, `9800000021`, `9800000022`) from both the Supabase test list and `provisioned_accounts`, and deciding one of two things about the two test-number admins (`9800000001`, `9841234567`) — either they keep their fixed codes as the documented break-glass (SECURITY.md § 3), which is a deliberate accepted risk that must be written down as such and the codes rotated, or they lose them and admin recovery moves to a real second factor. Not both by default: leaving them because nobody chose is how this becomes a credential nobody remembers. `9843119897` is not a test number and is unaffected.

### BLOCKER: trust-strip-counts
- Status: unresolved
- Claims: Claimed "1,200+ ID-verified professionals" and "Average rating 4.8 from 10,000+ households". **The invented figures are gone** — the strip now carries four statements that are true on day one and no numbers at all. It stays open because the rows a count would draw on are still fixtures: 28 of the 30 providers are seeded and 26 of them are marked verified.
- Lives in: `app/[locale]/page.tsx` (`TRUST_ITEMS`), `lib/data/platform.ts`, `lib/config/platform.ts`, `home.trust.*` in both catalogues
- Replaced by: `platformStats()` reads real counts and each one appears only above a floor — but **the filter matters more than the floor**, and that is why this entry survives its own fix. A floor of 25 would have PASSED on 26 seeded "verified" rows and put "28 ID-verified professionals" on the landing page: a smaller lie, arrived at carefully. So the count requires `application_id is not null` as well, and this blocker is now formally dependent on `seed-providers-and-reviews` — `npm run check:blockers` fails if this one is marked resolved while that one is open, so a green check here can never hide the reason the strip is empty.

### BLOCKER: activity-ticker
- Status: unresolved
- Claims: A live feed of bookings happening right now — named people in named wards, minutes ago. Every entry is invented and the list never changes.
- Lives in: `lib/mock/activityFeed.ts`, `components/marketing/activity-ticker.tsx`, `activity` namespace in both catalogues
- Replaced by: Phase 8 — a Supabase realtime subscription on `bookings`, filtered to the viewer's city, first names only. The component's shape already matches what that subscription returns.

### BLOCKER: category-booked-this-week
- Status: unresolved
- Claims: "312 booked this week" and similar on every category card. There have been no bookings.
- Lives in: `lib/mock/categoryStats.ts`, rendered by `app/[locale]/page.tsx`
- Replaced by: a rolling 7-day count per category over the `bookings` table, cached. Phase 9.

### BLOCKER: category-price-bands
- Status: resolved
- Claims: a price range for every service. Nine of the ten are researched against named Kathmandu competitors (2026-09-15) with sources and a confidence level per trade, floors deliberately at the bottom of each researched range. Movers and packers was the one still open — no Nepali operator publishes a price, every one quotes after a survey, and five screens went on showing an invented Rs 5,000–20,000 that nobody quoted.
- Lives in: `lib/data/seed/categories.json` (`pricingModel: "survey"` on movers), the `categories` table, and `isSurveyPriced` in `lib/config/services.ts`, which every surface now asks.
- Replaced by: movers publishes **no band anywhere**, and the booking path asks for a free survey instead of quoting. `quote_model = 'survey'` carries a null band until somebody has looked, and `enforce_survey_quote` will not let such a job reach `in_progress` until the customer has approved a surveyed figure — so the 2× overcharge ceiling is never measured off a number nobody agreed to. The failure was five surfaces each re-deriving "should I show a range" as "does this row have numbers"; one function decides now and `tests/unit/quote-floor.test.ts` pins it. The movers row keeps its old numbers on purpose — nothing reads them, and deleting them would hide whether the flag is working. The other nine are researched; their next step is `observed`, which is a revision rather than a blocker.

### BLOCKER: sub-band-durations
- Status: unresolved
- Claims: nothing, and that is deliberate. All 36 sub-bands carry a `typicalWorkingMinutes` and a `typicalElapsedDays`, every one of them guessed — nobody in Nepal publishes how long a tap leak takes or how many days a room needs between coats. **No screen prints any of them.** The numbers schedule and stay silent, which is the honest state rather than a bug to route around.
- Lives in: `lib/data/seed/price-bands.json` (`durationSource: "invented"` on every row), the `category_price_bands` table, and `hasPublishableDuration` in `lib/provider/measured.ts`, which is the one gate every surface asks.
- Replaced by: durations with real provenance. Two routes and they arrive in this order. **Researched** — ring painters and cleaners and ask how long a room actually takes, then record `durationSource: "researched"` with a `durationCheckedAt` and a note naming who was asked. **Observed** — `actual_working_minutes` accumulating on settled bookings, compared per sub-band against what we estimated, which is the same path `pricingSource` has to `observed` and the reason the professional's own correction is stored separately rather than overwriting ours. Painting is worth doing first: it is the trade whose four-day span the whole two-number model exists for, and it is the one where a customer most needs to be told before they commit. The script checks the seed rather than this status line, so marking it resolved without doing the work fails the build.

### BLOCKER: multi-day-scheduling
- Status: unresolved
- Claims: nothing, deliberately, and this entry exists so that stays true. Painting's products carry spans of two, four and seven days, and a span is the one duration number that MOVES A CALENDAR: it holds days of a professional's week and days of a customer's home. Every one of those spans is currently a guess. So `spansDays()` refuses them and every job holds its minutes on a single day — exactly what every booking did before duration existed.
- Lives in: `spansDays` in `lib/booking/duration.ts`, `typicalElapsedDays` in `lib/data/seed/price-bands.json`, and the `booking_days` generation trigger, which produces no rows while the gate is shut.
- Replaced by: researched durations, which is `sub-band-durations` — and `check:blockers` enforces that dependency rather than trusting this line, the same way `trust-strip-counts` is chained to `seed-providers-and-reviews`. **The two duration numbers are gated differently on purpose.** A wrong `typical_working_minutes` reserves 90 minutes where 120 was right: bounded, the same order as the flat two-hour window it replaced, and strictly better than holding the same two hours for a tap washer and a whole-flat repaint — so an invented working figure is allowed to reserve, because a reservation nobody reads makes no claim. A wrong span takes four days of real bookable capacity, invisibly, and nothing on any screen distinguishes it from a measurement. A professional's own correction is evidence and passes the gate whatever our provenance says: they have been to the site, and what is gated is our guess, not their judgement.

### BLOCKER: seed-providers-and-reviews
- Status: unresolved
- Claims: 28 named professionals with photos-worth-of-detail, ratings, job counts, completion rates, response times, and 94 written reviews from named customers. All invented. A visitor can browse them, read their verification breakdown, and tap "Book".
- Lives in: `lib/data/seed/providers.json`, `lib/data/seed/reviews.json`, `supabase/migrations/20260830000002_services_seed.sql`
- Replaced by: real provider onboarding (Phase 10). The seed rows must be deleted from the production database, not merely stopped from rendering — they are in the table, not just the fallback.

### BLOCKER: support-phone-number
- Status: unresolved
- Claims: nothing, now. The placeholder is gone and no screen offers a call. What is still missing is the line itself, which is why this stays open — a home-services platform with no way to reach a person is a gap, it is simply no longer a lie.
- Lives in: `NEXT_PUBLIC_SUPPORT_PHONE` (unset), read once by `lib/config/site.ts`
- Replaced by: a real number in that one variable. Every screen that would offer a call reads it and renders the call again the moment it is set; `lib/content/pages/contact.ts` is the one place still written as prose and needs its phone section restored by hand in the same commit.
- Fixed 2026-09-11. `+977 9800 000 000` used to appear on nine screens as "call us and we'll sort it", and on the day the SMS gateway refused every code the login fallback offered it to somebody who could not get in — a dead door and a dead escape hatch as one wall. The escape hatch is the half that reads as contempt: the product did not merely fail, it offered help that was not there. `site.supportPhone` is now `string | null`, unset is a supported state every caller handles, a malformed value becomes null rather than reaching a screen, and `npm run check:contacts` fails the build on a placeholder phone or email in user-facing copy — judged by shape (repeated digits, counting sequences, 555, reserved example domains) rather than a blocklist of the ones already found, and self-tested on every run against the exact strings that shipped.

### BLOCKER: nepali-native-read
- Status: unresolved
- Claims: that this product speaks Nepali rather than being an English product with Nepali underneath it. Nepali is a first-class path here — every screen ships in both — and the strings were written with care, checked against a list of calques that have already shipped once, and never read by a native speaker. Care is not the same test. The test is "would anyone say this", and only a Nepali speaker can apply it. The strings this blocks on are the ones where a line that merely *means* the right thing is not good enough: a figure somebody is about to hand over in cash, what their guarantee covers, and what they read while frightened.
- Lives in: `messages/ne.json`, scoped by `scripts/ne-review-scope.mjs` — `booking.payment`, `booking.guarantee`, `booking.notifications`, `safety`, `triage`, `legal`, `provider.standards`, `admin.mismatches`. **203 of 1,412 keys**, which is a reviewable batch rather than a week nobody has. Plus four long-form documents that are NOT in the catalogue at all — `lib/content/pages/standards.ts` and the three under `lib/content/legal/` are written as `{ en, ne }` prose, so a backlog built from `messages/ne.json` alone reported the enforcement ladder as read when nobody had looked at it. `npm run check:messages` prints the outstanding count on every run and `npm run ne:review` prints the strings themselves, English beside Nepali, grouped by what getting them wrong would cost.
- Replaced by: a Nepali speaker reading each one **in place on the screen**, not in a spreadsheet — register is invisible out of context, and three of the mistakes already caught were right in the dictionary and wrong in the room. Each key they sign off is added to `messages/ne-reviewed.json`; this entry resolves when the count reaches zero. The scope is derived from namespace rules rather than a hand-kept list, so a string added under one of those prefixes after the pass raises the count again on its own — which is the intended behaviour, not a bug to work around.
- Note: the *prose* of the legal pages is `legal-documents-unreviewed`, a separate entry needing a lawyer rather than a translator. The `legal.*` keys here are only the labels around it.

### BLOCKER: legal-documents-unreviewed
- Status: unresolved
- Claims: `/legal/terms`, `/legal/privacy` and `/legal/refunds` are presented as the terms a customer agrees to at sign-in. They are first drafts written by a developer, not by a lawyer, and they have not been reviewed against Nepali consumer, privacy or e-commerce law.
- Lives in: `lib/content/legal/*.ts`, rendered by `app/[locale]/(app)/legal/[slug]/page.tsx`
- Replaced by: review and revision by a Nepali lawyer. The pages carry a visible draft notice until then; removing that notice is part of resolving this entry.

## Ask before signing an SMS contract

Eight questions, to both Sparrow and Aakash, before money or a signature. Each
one is here because getting it wrong is expensive *after* the contract and free
*before* it. Ask all eight of both, and compare the answers rather than the
brochures.

**Question 2 decides the gateway.** A gateway that never asks for an IP
allowlist is worth more than any fallback for one, so it is a selection
criterion rather than a problem to solve afterwards — and it is only available
before choosing. **Question 6 decides whether the product works at the hour it
is for**, and its answer is wanted in writing.

1. **Sender ID: what does approval need, and how long does it take?** Account
   signup is advertised in minutes; sender ID approval goes through NTC and
   Ncell and is the slow part. Ncell refuses unregistered sender IDs rather
   than rewriting them, so until it is approved a Ncell customer receives
   nothing. Nobody publishes this timeline, which is exactly why it is the
   first question.
2. **Will you disable IP restriction for a serverless caller?** See the
   fallback below. Ask before signing, not after the first failed send.
3. **What is the per-message rate to NTC and to Ncell at a few thousand a
   month?** Two networks, two numbers. A single blended figure hides which one
   is expensive.
4. **Do we get per-message delivery receipts, or only acceptance?** Both
   gateways answer a send with a queue acknowledgement, which says nothing
   about whether a handset saw it. **This is the difference between knowing
   sign-in works and assuming it does**, and assuming it did is precisely how
   the Twilio failure ran for a day. Ask specifically: is there a DLR callback
   on the *SMS* API — not only on the enterprise or Viber product — what does
   it POST, and how long are reports retained if we miss one? A gateway with
   no DLR means the only measurement of delivery we will ever have is
   customers failing to sign in.
5. **Is OTP traffic routed differently from promotional?** Ask which route OTP
   rides, and what happens to our traffic while somebody else's campaign is
   running. **An OTP that arrives four minutes late is a failed sign-in.**
6. **WILL OUR CODES DELIVER AT 2AM, ON NTC AND ON NCELL? GET IT IN WRITING.**
   This one is blocker-level rather than a detail, and it is the question where
   the product's positioning and its only way in point in opposite directions:
   we sell emergencies, so 2am is the moment we most need to work, and it is
   also when promotional routes are most likely to be barred. Ask specifically
   whether the NTA restriction reaches **transactional** OTP or only
   promotional traffic. A verbal "should be fine" is worth nothing at 2am to
   somebody standing in a flooding bathroom. The architecture response if the
   answer is bad is designed in ARCHITECTURE.md rather than left to the night
   it happens.
7. **What is the delivery-time target under load, not under normal
   conditions?** An average measured on a quiet afternoon will never show the
   failure that matters. Ask for the figure during peak campaign hours, and
   what our traffic is queued behind when it happens.
8. **What is the escalation path when delivery degrades?** Not sales — who
   answers at 2am, and how do we reach them.

**If Viber comes up, it gets the same six questions, not a nod.** Sparrow sells
it and it is outside SMS routing rules, which makes it attractive enough to be
waved through on a call. Ask for template pre-approval rules, which message
categories we may send under, delivery-time targets and cost, all in writing —
none of it carries over from the SMS contract. And it is a **second channel,
never the floor**: it only reaches somebody who has it installed, signed in and
on data, and the person it would be reaching is frightened, possibly on a dying
battery, and may never have opened it. A channel with a precondition cannot be
the one we rely on at 2am.

Both are asked as questions rather than assumed, because the honest state of
our knowledge is that public documentation answers none of them.

## If IP restriction cannot be disabled

Decided in advance, because the alternative is deciding it during an outage on
the only way into the product.

Sparrow pins an account to registered source addresses (`response_code` 1001)
and Vercel's egress addresses are neither fixed nor published as a stable list.
So this is a live risk, and there are four answers in order of preference:

1. **Make it a selection criterion, not a problem to solve afterwards.** A
   gateway that does not require IP allowlisting costs nothing extra and adds
   no moving part. Aakash's documented request carries no IP story at all. This
   is the cheapest fix by a wide margin and it is only available *before*
   choosing.
2. **Vercel Static IPs — $100 a month per project**, plus private data
   transfer. It adds no new failure mode and nothing to operate, and at a few
   thousand messages a month it costs several times the SMS itself. Real money
   for this stage, but it is worth remembering what it buys: the only way into
   the product, with Vercel's reliability rather than ours.
3. **A small fixed-IP relay, and the seam for it already exists.** The Send SMS
   Hook is called *by Supabase*, not by our Next.js app — it is a URL in their
   dashboard. So the hook can be hosted anywhere with a fixed address without
   touching the app at all, and `lib/sms/` imports nothing from Next, so the
   adapters port as they are. A €4-6 VPS does it. **The cost is not the money,
   it is that a single unreplicated box is then on the sign-in path**, and
   Supabase does not retry a failed hook — if the box is down, sign-in is down.
   Acceptable while walking the product; a thing to fix before real customers.
4. **A static-IP proxy service** (QuotaGuard and similar) sits between the two
   on price and adds a vendor to the sign-in path. Mentioned for completeness;
   nothing recommends it over (2) or (3) here.

Not chosen now because the answer depends on question 2 above. Recorded so that
when the answer arrives it is a decision already made rather than a scramble.

## Ask at merchant onboarding: gateway-funded cashback

Not a blocker — a question that must be asked while somebody from eSewa and
Khalti is on the phone, because it is far harder to raise afterwards.

Both run cashback and promo campaigns for merchants. If either funds an
incentive for paying through them, the customer-side digital incentive costs us
nothing and reaches exactly the customers we would otherwise pay to reach. Ask
what campaigns are open to a new merchant, what the merchant has to fund, and
whether the platform can be listed in their own app.

Until then the incentive is the four true things on the payment screen
(`components/booking/digital-benefits.tsx`) and no money at all.

### BLOCKER: guarantee-unclaimable
- Status: resolved
- Claims: `/legal/refunds` and `/providers/standards` publish the guarantee in full — a re-do within 30 days for a repair, 90 for painting, 48 hours for a clean, with the visit deciding who pays. A customer can now ask for it: every completed booking carries the panel, claimable or not, because a promise that appears only when it can be used is indistinguishable from one that was never made.
- Lives in: `lib/config/guarantee.ts` (the rule), `lib/data/claims.ts` (the writes), `components/booking/guarantee-panel.tsx` and `openClaimAction` (the customer), `components/provider/claim-card.tsx` and `/provider` (the professional), `supabase/migrations/20260912000002_guarantee_claims.sql` (`guarantee_claims`, `provider_ledger`)
- Replaced by: the whole path exists and is walked. A customer opens a claim from the booking it applies to; `claimIsAllowed` judges the window, the settlement and the two-per-booking limit; the original professional is told and usually goes back themselves; a claim they cannot take is offered to the rest of the trade and `acceptClaim` reassigns it; the attending professional records a verdict, which decides who pays; `sameFault` writes a `provider_ledger` debt netted forward by `applyRedoRecovery`, never chased backward, and visible to the professional on their dashboard. `tests/db/guarantee-claims.test.ts` holds 24 cases, including that no verdict and no combination of verdicts produces a refund without a person, and that the ledger is append-only for every caller, service role included. The customer is told where it has got to at every step — "We are arranging a visit", "Somebody is coming to look", "They have been and looked" — and a booking with a claim in flight now sits under **Happening now** rather than filed away under Earlier, which is what this entry's last real gap was.
- **The refund screen exists now, and this line said otherwise for a phase after it shipped.** It read "there is no admin screen to issue a guarantee refund" — there is: `/admin/guarantee-claims`, with `issueRefund`, `markRefundPaid` and `sendRefundToGateway` behind it, and `refundFunding` previewing on the screen the same split `agreeRefund` applies server-side. The note outlived the code, which is the same failure as a column nothing writes to seen from the other end: a document describing an absence that was filled. A refund still needs a person, which the db suite pins (`money back needs a person`), and it remains the rare capped case the policy describes rather than the guarantee's normal operation, which is a re-do.

### BLOCKER: next-14-advisories
- Status: unresolved
- Claims: nothing to a visitor — this one is not a promise on a screen, it is a way in that nobody in this repository wrote. `npm audit` now reports **one critical and one high**: Next itself and postcss beneath it, 27 advisories between them, and `fixAvailable` for both is `next@16`. Most of the individual advisories do not describe this deployment (the Image Optimizer ones need `next/image` with `remotePatterns`, which this app does not use; several denial-of-service ones are specific to self-hosting). Three plausibly do reach us on Vercel: cache poisoning of React Server Component responses, cache confusion of response bodies for requests with bodies, and unauthenticated disclosure of internal Server Function endpoints. The last matters most, because every write in this product is a server action.
- **Escalated to critical on 2026-09-10** — `GHSA-p293-qw3h-jr36` (unauthenticated RCE on Windows-hosted servers) and `GHSA-2xp9-vwfh-vxw4` (unauthenticated RCE in the Image Optimization API via AVIF). Neither describes this deployment: Vercel is not Windows-hosted and this app does not use `next/image` with remote patterns. **That does not make it safe, it makes it not-yet-exploitable-here** — a different sentence, and the reason this stays open rather than being accepted and forgotten.
- Lives in: `package.json` (`next@14`), `scripts/check-advisories.mjs` (the accepted list and the reasoning), `.github/workflows/ci.yml` (the `advisories` job)
- **What this cost while nobody was looking, which is the part worth keeping.** The old gate was `npm audit --audit-level=critical` as the sixth step of a single CI job, set to `critical` precisely so the known Next 14 *highs* would not redden every commit. When a *critical* arrived, that step began failing — and every step below it stopped running: lint, typecheck, the message and transition checks, the whole test suite, the build, the paint check, the flow check. **Seventy-one consecutive runs, nine days**, each red at 37 seconds, each sending an email that said only that all jobs had failed. The paint check and the flow check run *only* in CI, because they need a browser Vercel's builder does not have — so for nine days they ran nowhere at all. It was found by a person asking why the emails kept arriving. **A check that cannot pass must never be able to silence the checks that can**, and a severity threshold is exactly the kind of gate whose meaning changes without anybody editing it.
- Replaced by: the upgrade to Next 16 across next-intl and the whole route table, with `npm run verify` green afterwards. Then delete both entries from `ACCEPTED` in `scripts/check-advisories.mjs` — it reports a stale entry by name, so an accepted advisory that no longer applies cannot sit there as a hole left open on purpose. It is its own phase and deliberately not done inside one whose brief was to break nothing.
