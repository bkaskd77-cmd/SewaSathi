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
- Claims: `+977 9800 000 000` is our support line. It appears on `/book`, `/bookings`, `/account`, the OTP help panel and the booking placeholder, always as "call us and we'll sort it". It is a placeholder and does not ring.
- Lives in: `common.supportPhone` / `common.callSupport` in both catalogues, and the `tel:` hrefs in `app/[locale]/(app)/book`, `bookings`, `account`, `components/auth/verify-form.tsx`
- Replaced by: a real number, set once in the catalogue and in the `tel:` links. Until then every "call us" path in the product is a dead end, which is worse than not offering one.

### BLOCKER: legal-documents-unreviewed
- Status: unresolved
- Claims: `/legal/terms`, `/legal/privacy` and `/legal/refunds` are presented as the terms a customer agrees to at sign-in. They are first drafts written by a developer, not by a lawyer, and they have not been reviewed against Nepali consumer, privacy or e-commerce law.
- Lives in: `lib/content/legal/*.ts`, rendered by `app/[locale]/(app)/legal/[slug]/page.tsx`
- Replaced by: review and revision by a Nepali lawyer. The pages carry a visible draft notice until then; removing that notice is part of resolving this entry.

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
