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
- Claims: "1,200+ ID-verified professionals", "Average rating 4.8 from 10,000+ households". There are 28 providers in the database, none of them real people, and no completed bookings at all. This is the most serious entry in the file: it is the first thing on the landing page, it is the specific claim the product asks to be trusted on, and it is false.
- Lives in: `app/[locale]/page.tsx` (`TRUST_ITEMS`), `messages/en.json` and `messages/ne.json` (`home.trust.*`)
- Replaced by: Phase 9 aggregates — a verified-provider count, a mean of real `provider_stats.rating_avg`, and a count of distinct customers with a completed booking. Until those exist, the honest version is to drop the numbers and keep the labels.

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
- Status: unresolved
- Claims: `/legal/refunds` and `/providers/standards` now publish the guarantee in full — a re-do within 30 days for a repair, 90 for painting, 48 hours for a clean, with the visit deciding who pays. Every word of it is the policy we intend, and there is no button anywhere in the product that makes a claim. A customer whose tap fails again on day 12 can read exactly what they are entitled to and has no way to ask for it except the support number, which is itself a placeholder (see `support-phone-number`).
- Lives in: `lib/config/guarantee.ts` (the rule, complete and tested), `lib/content/legal/refunds.ts`, `lib/content/pages/standards.ts`, `messages/*.json` (`booking.payment.cashPending.guarantee`)
- Replaced by: Phase 11 — a `guarantee_claims` table (booking, claimant, fault description, photo, verdict, who paid, resolved by), a `provider_ledger` carrying what a professional owes for a redo somebody else attended, the claim button on a settled booking, the free re-dispatch, the verdict capture on the professional's screen, and the balance on their dashboard. `claimIsAllowed`, `claimOutcome` and `applyRedoRecovery` already decide all three; what is missing is the two tables and the two screens.

### BLOCKER: next-14-advisories
- Status: unresolved
- Claims: nothing to a visitor — this one is not a promise on a screen, it is a way in that nobody in this repository wrote. `npm audit` reports two high-severity entries, Next itself and postcss beneath it, and `fixAvailable` for both is `next@16`. Most of the individual advisories do not describe this deployment (the Image Optimizer ones need `next/image` with `remotePatterns`, which this app does not use; several denial-of-service ones are specific to self-hosting). Three plausibly do reach us on Vercel: cache poisoning of React Server Component responses, cache confusion of response bodies for requests with bodies, and unauthenticated disclosure of internal Server Function endpoints. The last matters most, because every write in this product is a server action.
- Lives in: `package.json` (`next@14`), and `.github/workflows/ci.yml`, which gates at `critical` rather than `high` so CI is not red on every commit until this lands — an always-red check is a check nobody reads.
- Replaced by: the upgrade to Next 16 across next-intl and the whole route table, with `npm run verify` green afterwards, and `--audit-level=high` restored in CI. It is its own piece of work and deliberately not done inside a security phase whose brief was to break nothing.
