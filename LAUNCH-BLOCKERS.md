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
- Measured again 2026-09-29, against production on `36a11f2`, and the sentence changed in a way that matters: `422: Error sending confirmation OTP to provider: auth account AC00000000000000000000000000000000 does not exist` — Twilio error 20003 again, but naming the Account SID, and it is **`AC` followed by thirty-two zeros**. So this is not a wrong password or a rotated credential. **Nobody has ever entered one.** The field is still holding the placeholder it shipped with, which is the August incident's "placeholder zeros" verbatim and unchanged nineteen days after the 2026-09-10 reading. The earlier measurement said "credentials rejected"; this one says there are no credentials, which is a different and more actionable fact — there is nothing to debug, only something to fill in. Nothing was sent and nothing was charged.
- **It stays unresolved on purpose, and the sequencing is a decision rather than a delay.** The gateway is contracted and configured as the last step before going live, not now: it costs money per message, a Nepali sender ID needs registering, and the product still has design and development ahead of it. What that buys until then is stated plainly so nobody mistakes it for progress — **every walkthrough, demo and test runs on the Supabase test numbers, which GoTrue answers itself without ever calling a provider.** That is precisely why the dashboard has looked correct throughout. No amount of using the product this way is evidence the gateway works, and the only thing that ever will be is `?deep=1` reporting `auth.sms: ok` with a handset in Nepal receiving the code.
- **The probe is armed and waiting**: `SMS_HEALTH_NUMBER` is set in Vercel on Production and `auth.sms.probe` confirms it parses, so clearing this blocker is one dashboard change plus one `?deep=1` run — no code, no deploy.

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
- Status: resolved
- Claims: nothing, now. It claimed a live feed of bookings happening right now — named people in named wards, minutes ago. Every entry was invented, `minutesAgo` was a hardcoded constant so it read "3 minutes ago" permanently, and the list never changed. It was live on the homepage above the fold.
- Lives in: `components/marketing/promise-strip.tsx`, which took the slot
- Replaced by: three promises that are true on day one and enforced in code rather than asserted — paying only after the work (`lib/payments`), gas and sparking treated as urgent with what to do first (`lib/ai/safety.ts`, every path including the fallback), and our fee coming from the professional and never the customer's price (every constant in `lib/payments/payout.ts` says so, `cashCommissionSurchargeBps` is 0). **Not the obvious replacement**: the trust grid immediately above already carries "Upfront pricing" and "Work guaranteed", so a strip about price and the guarantee would have repeated the row above it in smaller type.
- **The Phase 8 feed is still wanted, and its shape is recorded so deleting the component did not lose it**: a booking maps to `{ name (first only), area, actionKey, minutesAgo }` over a Supabase realtime subscription, filtered to the viewer's city, surnames stripped. The note lives at the foot of `promise-strip.tsx`. With 14 bookings there is nothing to show — a feed rendering two entries looks worse than none — so it returns when there is volume, and it returns as a second strip rather than by reviving this one.


### BLOCKER: category-booked-this-week
- Status: resolved
- Claims: nothing, now. It claimed "312 booked this week" and similar on every category card, against 14 real bookings across every category combined.
- Lives in: `app/[locale]/page.tsx`, the card's last line
- Replaced by: the **researched price floor** — "From Rs 350" — which is dated 2026-09-15, carries named sources and a confidence level, and answers what somebody choosing a category is actually asking. A count they cannot verify never did. `isSurveyPriced` decides, as it already does on five other surfaces: movers publishes no band anywhere, so it reads "Priced after a free survey" — the same sentence `/services` uses, taken from the same key so the two cannot drift. A category with no band never renders a floor of zero, which is rule 6.
- The rolling 7-day count is still a reasonable thing to show **once it is true and above a floor**, the way `platformStats()` already gates the trust strip. It is not a blocker any more because nothing on the page claims it.

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
- Status: resolved
- Claims: 28 named professionals with photos-worth-of-detail, ratings, job counts, completion rates, response times, and 94 written reviews from named customers. All invented. A visitor can browse them, read their verification breakdown, and tap "Book".
- Lives in: `lib/data/seed/providers.json`, `lib/data/seed/reviews.json`, `supabase/migrations/20260830000002_services_seed.sql`
- Replaced by: **done.** 24 of the 28 deleted from production outright; the other 4 retired with `is_active = false`, `closed_at` and `closed_reason = 'fixture'`, because `bookings.provider_id` is ON DELETE SET NULL and deleting them would have left 9 real bookings — 2 with `payout_due_at` — recording work paid for by nobody. Verified before and after: 14 bookings, all 14 still carrying their provider, 4 settled payouts intact, 2 listings visible to `anon`.
- **And the seed JSON was emptied in the same commit**, which is the half that deleting rows does not cover: `lib/data/providers.ts` falls back to `seed/providers.json` when a query *errors*, so all 28 would have returned to a public page on any database hiccup. A fresh clone now renders an empty catalogue, which is a deliberate cost.
- `provider_reviews` held **one** row in production and it is on a real listing. The 94 invented reviews existed only in `seed/reviews.json` and were never applied.

### BLOCKER: support-phone-number
- Status: unresolved
- Claims: nothing, now. The placeholder is gone and no screen offers a call. What is still missing is the line itself, which is why this stays open — a home-services platform with no way to reach a person is a gap, it is simply no longer a lie.
- Lives in: `NEXT_PUBLIC_SUPPORT_PHONE` (unset), read once by `lib/config/site.ts`
- Replaced by: a real number in that one variable. Every screen that would offer a call reads it and renders the call again the moment it is set; `lib/content/pages/contact.ts` is the one place still written as prose and needs its phone section restored by hand in the same commit.
- Fixed 2026-09-11. `+977 9800 000 000` used to appear on nine screens as "call us and we'll sort it", and on the day the SMS gateway refused every code the login fallback offered it to somebody who could not get in — a dead door and a dead escape hatch as one wall. The escape hatch is the half that reads as contempt: the product did not merely fail, it offered help that was not there. `site.supportPhone` is now `string | null`, unset is a supported state every caller handles, a malformed value becomes null rather than reaching a screen, and `npm run check:contacts` fails the build on a placeholder phone or email in user-facing copy — judged by shape (repeated digits, counting sequences, 555, reserved example domains) rather than a blocklist of the ones already found, and self-tested on every run against the exact strings that shipped.

### BLOCKER: nepali-native-read
- Status: unresolved
- Claims: that this product speaks Nepali rather than being an English product with Nepali underneath it. Nepali is a first-class path here — every screen ships in both — and the strings were written with care, checked against a list of calques that have already shipped once, and never read by a native speaker. Care is not the same test. The test is "would anyone say this", and only a Nepali speaker can apply it. The strings this blocks on are the ones where a line that merely *means* the right thing is not good enough: a figure somebody is about to hand over in cash, what their guarantee covers, and what they read while frightened.
- Lives in: `messages/ne.json`, scoped by `scripts/ne-review-scope.mjs` — fifteen namespace rules, each carrying the tier that says what getting it wrong costs. **446 of 1,736 keys, plus four long-form documents** that are not in the catalogue at all: `lib/content/pages/standards.ts` and the three under `lib/content/legal/` are written as `{ en, ne }` prose, so a backlog built from `messages/ne.json` alone reported the enforcement ladder as read when nobody had looked at it. **This entry blocks on 273 of those keys and all four documents, not on all 446.** `BLOCKING_TIERS` is the split: money (225 — the payment and guarantee screens, the professional's own money view, the cancellation dialogue, the activity opt-out), safety (44) and legal (4 keys + 4 documents) refuse a launch build; **staff (173) does not**. One entry over everything could not be satisfied without reviewing admin copy no customer or professional will ever read, which held the money and safety lines behind the staff ones — and the two are not the same risk: an admin misreading a queue label costs a slower queue, in a room with somebody who can ask; a professional misreading the cash-fee line on `provider.money` loses money and trusts us less with nobody there to correct it, and a frightened person misreading a hazard line is the failure `foldNepali` exists for. The staff count is **still printed on every `check:messages` and `check:blockers` run**, because reclassifying is not the same as doing and a number that stops being said out loud is one nobody closes. `npm run ne:review` prints the strings themselves, English beside Nepali, grouped by tier and marked with which block.
- Replaced by: a Nepali speaker reading each one **in place on the screen**, not in a spreadsheet — register is invisible out of context, and three of the mistakes already caught were right in the dictionary and wrong in the room. Each key they sign off goes into `messages/ne-reviewed.json`; a document goes in by its path, which **had no sign-off path at all** until the split — that file held keys, a document has no key, and all four were listed as waiting for ever. `check:blockers` reads the backlog rather than this status line: marking it resolved while a blocking key or document is unread fails the build on every run, launch or not, the same way a `resolved` band over an `invented` seed does. The scope is derived from namespace rules, so a string added under one of those prefixes after the pass raises the count again on its own — intended behaviour, not a bug to work around.
- Note: the *prose* of the legal pages is `legal-documents-unreviewed`, a separate entry needing a lawyer rather than a translator. The `legal.*` keys here are only the labels around it. The `staff` tier being outside this gate is a decision about what a launch waits for, not a decision that it does not matter — it is the same backlog, counted on the same line.

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

### BLOCKER: payout-notice-undeliverable
- Status: unresolved
- Claims: **that a professional will know if somebody moves their money.** `/provider/payouts` tells them "Changed on {date}. Was that not you? Ring {phone}", and `DESTINATION_COOLDOWN_HOURS` holds any new account for 72 hours expressly so they have time to act on that sentence. `/providers/standards` and the screen both present the wait as a protection.
- **The protection has no reader.** The notice is written as a `payout.destinationChanged` notification and rendered on a page. The in-app channel has no delivery address, there is no SMS channel, and the page requires a session to open. So the only person who can read "your account was changed" is whoever is holding the session — which, in the one scenario the warning exists for, is the attacker. The cooldown still delays the theft; nothing tells the victim it is happening.
- Lives in: `lib/notify/channel.ts` (`payout.destinationChanged`, whose comment already records the rule an SMS channel must follow), `app/[locale]/(work)/provider/payouts/page.tsx` (where it renders), `lib/config/payout-policy.ts` (`DESTINATION_COOLDOWN_HOURS`).
- Replaced by: the notice delivered over SMS to the contact **as it stood before the change** — not to today's number, because somebody who took the account over changed that too. It depends on the same gateway as `sms-gateway-unproven`; it is a separate entry because fixing that one does not fix this one. A working gateway with no channel wired still delivers nothing.
- **The compensating control is a person, and it is deliberately not called a fix.** `/admin/payout-destinations` lists every account that replaced another and is still inside its window, counted on the admin index. An admin can ring the professional on the number we hold. That is slower than a text, reaches nobody out of hours, and depends on somebody opening the page — which is why this stays open rather than being downgraded.
- **Payouts cannot go live while this is open.** Not "should not": the whole design of the destination table assumes somebody can object inside 72 hours, and right now nobody can be told they have something to object to.

### BLOCKER: payouts-unbuilt
- Status: unresolved
- Claims: **that professionals get paid.** `/providers/join` says "Steady work, paid out weekly." and lists "Weekly payouts" as a reason to sign up — in both languages, on the page somebody reads before applying. `/providers/standards` goes further and describes the mechanics: a redo balance "shows on your dashboard as a balance you can watch going down", and on long-guarantee trades "a quarter of your earning arrives 30 days after the rest". Every one of those sentences is about money arriving. **No money has ever arrived, and nothing in this product can make it arrive.**
- Lives in: `messages/en.json` and `messages/ne.json` (`providers.join.prosTitle`, `providers.join.prosPayouts`), `lib/content/pages/standards.ts` (the `payouts` section and the redo-balance paragraph), and the tables that do not exist — there is no `payouts`, no `payout_destinations`, and no remittance adapter in `lib/payments/`.
- Replaced by: one confirmed payout reaching one real professional, through the run rather than by hand — a `payouts` row at `confirmed` carrying a real `external_reference`, with the professional's own money view showing it. Not by the admin screen existing, and not by a batch export: the test is that somebody was paid and can see that they were.
- **This is the `applyRedoRecovery` failure at product scale, and it is worth stating exactly because every individual link is built and tested.** `settleSplit` freezes `platform_fee`, `provider_earning` and `commission_bps` onto the booking. `payout_due_at` is computed — 24 hours for digital, 7 days for cash. `payoutPlan` splits a long-guarantee earning into two tranches and stamps `payout_holdback_rupees` and `payout_holdback_until`. `applyRedoRecovery` nets a guarantee debt forward at a quarter of a payout, `sweepRedoRecovery` runs it nightly, `sweepWriteOffs` clears a stale balance, and `provider_ledger` records all of it append-only with `provider_ledger_recovery_tranche_idx` making double recovery impossible. The job card even shows a professional what they earned on each job and when the held part releases. **What does not exist is the last step**: nothing groups those earnings, nothing sends money, nothing records that it was sent. The chain was never closed, and the promise on the join page was written as though it had been.
- **And the shape of the missing half is two-way, which is why it is not a small last step.** On a digital job we hold the customer's money and owe the professional; on a cash job the professional holds it and owes us the commission — `provider_earning` and `platform_fee` pointing in opposite directions on the same account. Cash is the primary path here, so both directions are ordinary rather than exceptional, and a payout run that only knows how to pay out would have nothing to say about a professional whose week was all cash.
- **Where the money goes now exists; nothing sends it yet.** `payout_destinations` holds one live destination per professional, sealed with AES-256-GCM against a key outside the database, retire-never-edit for every caller including the service role, with a 72-hour cooldown stamped on the row. `lib/data/payout-destinations.ts` is its one reader and writer: masked everywhere, one audited path to the digits, and a change refused outright unless the session re-authenticated inside 15 minutes. **That is the address, not the payment** — the entry stays unresolved on the same test as before: one confirmed payout reaching one real professional, through the run.
- **Two things about it are honestly incomplete rather than done, and both are downstream of the SMS gateway.** The re-auth gate refuses without a fresh stamp, but the OTP that would produce one cannot reach a real handset while `auth.sms` is down — so the gate today means "cannot change", not "changes are proved", and that is the safe half of the pair. And `payout.destinationChanged` is written as a notification with no channel that can deliver it: the in-app row has no address, and the line a professional actually reads comes off `payout_destinations` on a money view that does not exist yet. Nothing can change a destination until that screen is built, so there is no live window where a notice is silently going nowhere — but the ordering is stated here so it cannot later read as an oversight. When the SMS channel lands, that one kind must deliver to the contact **as it stood before the change**; a channel that reads today's number warns the attacker.
- **The account numbers already written are sealed now, and the dead match keys are replaced.** Measured rather than assumed: the conversion reported `sealed: 2, removed: 10, written: 12, remainingPlaintext: 0`, and the database was read directly afterwards — 2 of 2 envelopes, 0 not an envelope, 12 keys across 2 applications, 0 malformed. The 12-against-10 gap is the two `reference` keys those applications never had, since `20260912000001` postdated them. `provider_applications_payout_account_sealed` now refuses plaintext at the planner, proven as the owner with both a short and a 46-character value, so this cannot regress. **It changes nothing about this blocker**: knowing where to send money is not sending it, and the test is still one confirmed payout reaching one real professional through the run.
- **The run exists now, and the test has not changed.** `lib/data/payouts.ts` drafts
  one net figure per professional per ISO week — `provider_balance` after this run's
  `earning` and `commission_due` rows are written, so the two-way shape this entry
  describes is the ordinary case rather than an exception — and `/admin/payouts`
  approves, sends with the rail's reference, confirms or fails it, each behind
  `adminActor()`, a fifteen-minute `amr` proof and a recorded reason.
  `payout_transition_allowed` means the run can only ever produce drafts.
  **Nobody has been paid yet, so this stays unresolved**: the test is still one
  confirmed payout reaching one real professional *through the run*, with a real
  `external_reference` and the professional able to see it — not the screen existing.
  Two things stand between here and there and neither is in this repository: the SMS
  gateway (`payout-notice-undeliverable`, which this entry does not substitute for)
  and a human sending the first transfer from a bank's own screen.
- **Correction, 2026-09-30.** This entry said `provider_applications.payout_bank_name` was "the only destination field that exists anywhere" and that "nothing holds an account number or a wallet id". Both were wrong. `provider_applications.payout_account` has existed since `20260910000001`, is read on the admin review screen, is hashed into `application_match_keys` for duplicate detection, and **holds two real account numbers in production**. What is true is narrower and still blocking: there is nowhere a *payout run* reads a destination from, because that application field is collected once at review and never becomes a payable address. `payout_destinations` is that home.

### BLOCKER: withholding-tax-unconfirmed
- Status: unresolved
- Claims: nothing on a public page, and that is why this entry is worth writing down rather than trusting a comment. `PAYOUT_RUN.withholdingTaxBps` is **0**, and zero here means "withhold nothing" — a decision, not an absence, because the rate genuinely may be zero for some professionals. What is unconfirmed is whether it is zero for all of them, and nobody with a Nepali accountant's answer has been asked.
- Lives in: `lib/config/payout-policy.ts` (`PAYOUT_RUN.withholdingTaxBps`), `supabase/migrations/20261001000003_payouts.sql` (`payouts.tax_withheld_rupees`), `lib/config/ledger.ts` (`tax_withheld`, which nothing writes while the rate is 0)
- Replaced by: a rate confirmed with somebody who files returns in Nepal, and the filing obligation that comes with it understood — whether we withhold, at what rate, for whom, and what we have to remit and when. Then the constant moves and the run starts writing `tax_withheld` rows.
- **The column and the kind exist so this is a constant later rather than a migration**, and `tests/unit/payout-run.test.ts` pins that at 0 bps **no `tax_withheld` row is written at all**: a row for zero rupees would assert a withholding was calculated and came to nothing, which is not what happened — nobody has calculated anything. CLAUDE.md said this was "recorded in LAUNCH-BLOCKERS" for a phase before the entry existed; it does now.

### BLOCKER: ci-gates-deploy
- Status: unresolved
- Claims: nothing to a visitor directly. What it claims is internal and load-bearing: that the checks guarding this product can actually stop a bad build reaching production.
- **The hole, stated plainly.** The bundle budget used to run inside `next build`, so Vercel enforced it on every deploy. Next 16 deleted the data it parsed — the Size and First Load JS columns are gone from `next build` output under *both* builders — and the replacement measures script transferred in a real Chromium, which Vercel's builder does not have. So three checks now run in CI alone: the bundle budget, the paint check and the booking-flow check. **Vercel builds from the branch and never looks at GitHub's checks**, so today a push that fails all three still deploys. The branch is the production branch, so a push is the deploy.
- **It needs no setting at all any more.** `ignoreCommand` is a `vercel.json` field, so the gate is committed with the code: `"ignoreCommand": "node scripts/vercel-ignore-build.mjs"`. That is better than the dashboard equivalent (Settings → **Build and Deployment**, not Git, where this entry first sent somebody twice) — it is versioned, it is reviewable in a diff, and a fresh clone of this repository is gated without anybody remembering to configure it. It reads the commit's check runs from GitHub and exits 0 to skip the build, 1 to build (Vercel's contract, inverted, which is theirs not ours). It is **fail-closed**: no token, no checks reported yet, an unreachable API or a check still running all skip the production build rather than deploying something nobody verified. Preview deployments are never gated, because a preview is how you look at a branch whose CI is still running. Ignored Build Step is free on every plan including Hobby.
- **It needs one secret, and it is not the one this entry used to name.** `GITHUB_TOKEN` on the Vercel project is optional — this repository is public and GitHub answers `/check-runs` unauthenticated, so the gate works with nothing configured until the 60-per-hour limit bites. What it needs is `VERCEL_DEPLOY_HOOK` as a **GitHub Actions secret**, because of the finding below.
- **THE GATE WORKED AND FROZE PRODUCTION, which is the part nobody predicted.** Vercel starts building within seconds of a push; GitHub has not registered a single check run by then. So the gate's honest answer is "no checks reported yet" and its honest action is to skip — on *every* push, green or not. Four commits were pushed (`4495f0f`, `f50ba38`, `e39d837`, `ac84b9b`), all four went green in CI in about three minutes, and all four production deployments read **CANCELED**. Nothing anywhere said so: a skipped build looks like a success from the dashboard, from the branch and from the commit list, which makes it the worst available shape of `pushed is not deployed`. Found by reading the deployment states, not by anything in the repository.
- **So a push no longer triggers the production deploy — CI does.** `scripts/trigger-deploy.mjs` runs in a `deploy` job that `needs: verify`, and POSTs a Vercel deploy hook, which starts a production deployment of the branch head at a moment when the checks exist and have passed. The gate then finds them and builds. It stays in place as the floor under that: a hook called at the wrong moment, or a deployment started any other way, still has to show green. The script **fails the job loudly** when the secret is absent, because warning and carrying on is a green tick beside a frozen production, which is the state it exists to end. **A job of its own rather than a step of `verify`, and the first version got that wrong**: a red step inside `verify` makes `verify` red, which the gate reads as "nobody has shown this commit is good" — so it would have refused a manual redeploy too, removing the one escape hatch while complaining about the missing automatic one. Both `advisories` and `deploy` are in `NON_BLOCKING`; `deploy` structurally, because that job IS the deploy and is still running when Vercel evaluates the gate.
- **And the gate would have let a red advisory freeze production too.** It treated every reported check as blocking. `ci.yml` puts the dependency advisories in their own job precisely so a check that cannot pass is unable to silence the checks that can — see `next-14-advisories`, nine days, seventy-one runs. Letting that same red job stop every deploy would have brought the incident back with nothing shipping on top of it. `NON_BLOCKING` is a **named set**, so blocking stays the default, and the BUILD line names any waved-past job and its conclusion so a vulnerable dependency cannot deploy silently.
- **The other free path, and why it is not the one proposed.** This repository is public, so GitHub rulesets and branch protection are free, and "require status checks to pass" would do the job properly. But it only gates merges through a pull request, and this branch is pushed to directly — so taking it would mean moving the whole workflow to PR-only. That is a real option and a bigger decision than this entry should make; it is written down here so it is a choice rather than an oversight.
- Lives in: `vercel.json` (`ignoreCommand`), `scripts/vercel-ignore-build.mjs`, `scripts/trigger-deploy.mjs`, `.github/workflows/ci.yml` (the `Bundle budget` and `Deploy production` steps), `scripts/check-bundle-budget.mjs`, `tests/unit/deploy-gate.test.ts`
- **Both scripts run where nothing exercises them** — the gate runs once inside a Vercel build, the trigger only on the production branch — so `tests/unit/deploy-gate.test.ts` exercises the rules, the same answer `check-deployed.mjs` got for the same reason. The decision is a pure function of what GitHub reported, so it is testable at all. Two of its cases were blind when first written and are noted in the file: one asserted an exit code where a pattern-matched exemption produced the same code for the opposite reason.
- **Witnessed working on 2026-10-05, and the two halves were visible in one picture.** `VERCEL_DEPLOY_HOOK` was set, `b62347a` was pushed, and the same commit produced two production deployments: the **push-triggered** one at 14:54, `CANCELED` — the gate refusing a commit nothing had verified yet — and the **hook-triggered** one at 14:57, after `verify` went green, `READY`. The deployment it replaced was `582eb54`: **seven commits had piled up behind a frozen production**, which is what the four CANCELED states cost before anybody read them.
- **What is proven and what is not.** The trigger half is proven, and the refusal half is proven **for an unverified commit**. What is still unwitnessed is narrower than this entry first claimed: a commit whose CI has completed and FAILED, skipped with that reason in the log. The hook only fires from a green `verify`, so reaching that state means pushing a knowingly red commit — worth doing once, deliberately, rather than waiting for it to happen by accident.
- Replaced by: that one deliberate red push, seen skipped with `CI is not green:` and the failing check named in the Vercel log.

### BLOCKER: next-14-advisories
- Status: resolved
- Claims: nothing to a visitor — this one is not a promise on a screen, it is a way in that nobody in this repository wrote. `npm audit` now reports **one critical and one high**: Next itself and postcss beneath it, 27 advisories between them, and `fixAvailable` for both is `next@16`. Most of the individual advisories do not describe this deployment (the Image Optimizer ones need `next/image` with `remotePatterns`, which this app does not use; several denial-of-service ones are specific to self-hosting). Three plausibly do reach us on Vercel: cache poisoning of React Server Component responses, cache confusion of response bodies for requests with bodies, and unauthenticated disclosure of internal Server Function endpoints. The last matters most, because every write in this product is a server action.
- **Escalated to critical on 2026-09-10** — `GHSA-p293-qw3h-jr36` (unauthenticated RCE on Windows-hosted servers) and `GHSA-2xp9-vwfh-vxw4` (unauthenticated RCE in the Image Optimization API via AVIF). Neither describes this deployment: Vercel is not Windows-hosted and this app does not use `next/image` with remote patterns. **That does not make it safe, it makes it not-yet-exploitable-here** — a different sentence, and the reason this stays open rather than being accepted and forgotten.
- Lives in: `package.json` (`next@14`), `scripts/check-advisories.mjs` (the accepted list and the reasoning), `.github/workflows/ci.yml` (the `advisories` job)
- **What this cost while nobody was looking, which is the part worth keeping.** The old gate was `npm audit --audit-level=critical` as the sixth step of a single CI job, set to `critical` precisely so the known Next 14 *highs* would not redden every commit. When a *critical* arrived, that step began failing — and every step below it stopped running: lint, typecheck, the message and transition checks, the whole test suite, the build, the paint check, the flow check. **Seventy-one consecutive runs, nine days**, each red at 37 seconds, each sending an email that said only that all jobs had failed. The paint check and the flow check run *only* in CI, because they need a browser Vercel's builder does not have — so for nine days they ran nowhere at all. It was found by a person asking why the emails kept arriving. **A check that cannot pass must never be able to silence the checks that can**, and a severity threshold is exactly the kind of gate whose meaning changes without anybody editing it.
- Replaced by: the upgrade to Next 16 across next-intl and the whole route table, with `npm run verify` green afterwards. Then delete both entries from `ACCEPTED` in `scripts/check-advisories.mjs` — it reports a stale entry by name, so an accepted advisory that no longer applies cannot sit there as a hole left open on purpose. It is its own phase and deliberately not done inside one whose brief was to break nothing.
- **Resolved 2026-10-04.** `next@16.3.8`, `react@19`, `react-dom@19`. `npm audit --omit=dev` reports nothing, and `ACCEPTED` in `check-advisories.mjs` is empty — the stale-entry check named both packages on the first run after the upgrade, which is what it was built to do. The remaining `npm audit` noise is all dev-only tooling beneath `eslint-config-next@14` and `tailwindcss`, which `--omit=dev` excludes from this gate on purpose: it asks what ships.
- **What the upgrade cost, measured rather than assumed.** Next 16 defaults to Turbopack, and on Turbopack this landing page scored mobile Lighthouse 88/86/82 against 100/100/100 on Next 14 — LCP 1.5 s to 3.3 s, 0 ms to 280 ms of blocking, 12 kB to 206 kB of script in Lighthouse's window. Built with `--webpack` it is 100/100/100, identical to Next 14. **So `npm run build` passes `--webpack` deliberately**, and that flag is not a preference: removing it costs fourteen Lighthouse points on the first screen a stranger sees on a Nepali mobile connection. Turbopack stays the default for `next dev`, where bundling does not ship.
