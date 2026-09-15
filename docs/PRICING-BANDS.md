# Price bands — where the numbers come from

The band (`categories.base_price_min` / `base_price_max`) is on every category
card, on `/services`, on each category page, inside the triage answer, and it is
the floor of every booking's quote — which the platform fee is charged on. Ten
pairs of numbers, all currently `invented`.

**Nothing in this document is applied.** The research in §1 is a proposal
awaiting approval; §2 designs a screen that is not built; §3 is two open
questions; §4 is the statistic chosen for §2.

The authority rule is in ARCHITECTURE.md and is the reason §2 has an approve
button rather than a cron job: **the system proposes, a person decides.** An
auto-adjusting band measures its own shadow — the band sets the quote, the quote
anchors what gets agreed, and those agreed figures are the rows the next
proposal reads.

---

## 1. Competitor research — proposal, 2026-09-15

Method: public Nepali price pages and service listings, Kathmandu Valley,
searched 2026-09-15. Where a source publishes per-unit rates (per sq ft, per
litre) the band was derived by applying them to a typical household job and the
arithmetic is shown. **Sources that only say "quote after inspection" are
recorded as absent, not interpolated.**

Sources reached, in rough order of usefulness:
[United Facility](https://unitedfacilityservice.com.np/water-tank-cleaning-price-kathmandu/) ·
[Sajilo Sewa](https://www.sajilosewa.com/) ·
[Repairing Service Nepal](https://repairingservicenepal.com/best-plumber-service-in-kathmandu-2025/) ·
[Technical Sewa](https://www.technicalsewa.com/service/plumber) ·
[Everest Electro](https://everestelectro.com/ac-servicing-in-kathmandu-guide-to-repair-costs-maintenance-ac-servicing-in-kathmandu/) ·
[Blue Diamond Service Centre](https://bluediamondservicecenter.com/blog/kathmandu-ac-service-installation-repair-annual-ma/) ·
[Namaste Nepal Cleaning](https://namastenepalcleaning.com.np/how-much-does-it-cost-to-clean-a-house/) ·
[Royal Cleaning](https://royalcleaning.com.np/guide-to-professional-cleaning-services-in-kathmandu/) ·
[Reshape Home](https://reshapehome.com/blogs/paint-price-in-nepal/) ·
[Ghar Durbar](https://ghardurbar.com/blogs/Paint-Price-in-Nepal%202025%E2%80%932026) ·
[Orange Ball](https://www.orangeball.com.np/orange-balls-service-rates-and-charges/) ·
[Homeplex](https://homeplexnepal.com/services/carpenter-services-in-kathmandu) ·
[Ghatal Groups](https://ghatalgroups.com/house-construction-cost-kathmandu-valley-2026/)

### The table

| Trade | Now | **Proposed** | Confidence |
| --- | --- | --- | --- |
| Water tank cleaning | 1,500–4,000 | **1,500–6,000** | High |
| AC servicing | 1,800–5,500 | **1,000–12,000** | High |
| Plumbing | 900–4,500 | **500–6,000** | High |
| Electrical | 800–4,000 | **650–5,000** | High |
| Home cleaning | 1,500–5,000 | **1,200–12,000** | Medium-high |
| Appliance repair | 1,200–4,000 | **500–5,000** | Medium |
| Painting | 4,000–25,000 | **3,000–40,000** | Medium — see note |
| Carpentry | 1,000–3,500 | **600–6,000** | Low-medium |
| Pest control | 2,000–6,000 | **2,000–8,000** | Low |
| Movers & packers | 5,000–20,000 | **no proposal** | None |

### Per trade

**Water tank cleaning — 1,500–6,000. High.** The best-published trade of the
ten; one source gives a full rate card. Steel/plastic Rs 1,500 for 1,000 L then
Rs 1/L; cemented Rs 2,400 up to 6,000 L; beyond 8,000 L at 30 paisa/L; combined
cement + plastic at 70 paisa/L; Rs 100–200 transport outside the Ring Road.
A single overhead 1,000 L drum is 1,500 — our current floor is already exactly
right. A 6,000 L underground sump is 2,400; a large combined system reaches
4,000–6,000, which is why the ceiling moves up.

**AC servicing — 1,000–12,000. High.** Two independent sources agree closely.
Deep-clean service 1,200–2,000; gas refill 3,500–7,500 depending on refrigerant
and tonnage; split installation 5,000–12,000; small repairs "start at 500".
**Our current band is wrong at both ends** — the floor sits above an ordinary
service and the ceiling sits below a gas refill, which our own prompt note
already says belongs at the top of this band.

**Plumbing — 500–6,000. High.** Several sources, consistent. Inspection/consult
300–600; common jobs start 350–650; roughly 500/hour; fix a leak 500–1,200;
change pipes 1,500–3,000; kitchen sink 1,500–3,000; geyser install 1,000–2,000.
A **full bathroom fitting is 8,000–15,000** and is deliberately left outside the
band: it is a renovation quoted on site, not the call-out this product sells.
Flagging that as a scope decision rather than a pricing one.

**Electrical — 650–5,000. High.** One source publishes an unusually specific
list: minimum service charge 650, socket fitting 350, light point 550, MCB
replacement 500, decorative light 650, materials extra. The floor is set at the
**minimum charge** rather than the cheapest line item, because 650 is what a
customer actually pays for the smallest visit. Rewiring a room is quoted after a
visit everywhere, so the ceiling is a judgement, not a citation.

**Home cleaning — 1,200–12,000. Medium-high.** Sources are consistent but almost
all quote "from": basic housekeeping visit 800–1,500 for 1–2 hours; standard
2BHK from 2,500; deep clean 2BHK from 5,000; general cleaning from 5,500;
post-construction up to 60,000. The 60,000 is excluded — post-construction is a
different product and including it would make the band meaningless for everybody
else. **This is the trade where a single band is least informative** even with
good sources, because the price is driven by flat size more than by anything we
model.

**Appliance repair — 500–5,000. Medium.** Only a "starting at NPR 500" figure
was published, plus universal "full quote before repair starts" and parts
charged separately. No itemised list found for fridges or washing machines. The
band is labour and diagnosis; the part is a separate quote, which our prompt
note already says.

**Painting — 3,000–40,000. Medium on the rates, low on what a "job" is.**
Several sources agree on per-square-foot rates: labour only 8–15/sq ft; labour
plus materials 45–90/sq ft for primer and two coats; repainting 25–50/sq ft;
skilled labour 900–1,200/day. Applied to one room of roughly 400 sq ft of wall:
labour only 3,200–6,000, with materials 18,000–36,000. **The band is wide
because the underlying jobs are genuinely two different products** — a
labour-only repaint and a supply-and-paint job. This is the strongest argument
for the sub-band question in §3; no single pair of numbers describes it well.

**Carpentry — 600–6,000. Low-medium, and the published figures do not match
what we sell.** The rates found are for *fabrication* — Rs 550/sq ft rising to
2,200–3,200/sq ft for made furniture — while our category is hinges, locks,
doors, drawers and shelves. No per-day or per-call-out labour rate was
published anywhere. The proposal is anchored to the general skilled-trade
day rate (900–1,200) and the shape of the other repair trades, not to a
carpentry citation. **Treat as barely better than the current guess.**

**Pest control — 2,000–8,000. Low.** Only *commercial* rates are published:
Rs 4–15/sq ft with an 800 sq ft minimum, which is 3,200–12,000 for a commercial
job. Every residential provider quotes after inspection. The proposal keeps the
current floor and widens the ceiling toward the low end of the commercial range,
which is inference, not evidence.

**Movers & packers — no proposal. None.** Two searches, including one in
Nepali, found **no published Nepali pricing at all**. Every operator quotes
after a survey, and the Indian rate cards that dominate the results are a
different currency and a different market. I will not stamp a band `researched`
on this. Options, for you: leave it `invented` and let `check:blockers` keep
refusing launch; ring three operators for quotes on a standard one-bedroom move
and record those as the source; or drop the category until there is a real
number.

### Least confident, in order

1. **Movers & packers** — no data at all.
2. **Carpentry** — data exists but is about a different kind of work.
3. **Pest control** — residential prices are not published by anyone.
4. **Painting** — good rates, but the band spans two different products.

### A caveat on all ten

These are *advertised* prices from companies that publish them, which skews
toward the organised end of the market. The individual मिस्त्री a customer would
otherwise ring from a shop window is cheaper and publishes nothing. So every
floor here is likely to sit somewhat above the true market floor — which is the
direction that matters, because the floor sets the commission basis. Worth
re-checking against our own settled jobs as soon as there are enough of them
(§4), and worth knowing that the first `observed` revision will probably pull
floors **down**.

---

## 2. The admin band editor — design, not built

One screen per category, reached from the admin panel when it exists. It
answers: what do we publish, where did it come from, what does our own data say,
and is there a proposal.

### What it shows

```
  Plumbing                                     pricing_source: researched
  ─────────────────────────────────────────────────────────────────────
  PUBLISHED          Rs 500 – Rs 6,000
                     researched · 2026-09-15
                     "Sajilo Sewa, Technical Sewa, Repairing Service Nepal"
                     last changed by Bikas, 2026-09-15 — "launch research"

  OBSERVED           n = 84 settled jobs, last 180 days
                     p25 Rs 850   median Rs 1,400   p75 Rs 3,100
                     4 of 84 winsorised at the upper fence
                     12% landed below our floor · 1% above our ceiling

  PROPOSED           Rs 800 – Rs 3,400        [ Approve ]  [ Reject ]
                     robust p25/p75, movement capped at ±20%
                     reason: ____________________________  (required)
```

### Rules

- **Nothing applies itself.** Approve writes the new band, sets
  `pricing_source` to `observed`, stamps `pricing_checked_at`, and records the
  revision. Reject records the rejection and the reason, and suppresses that
  proposal until the sample has meaningfully changed — otherwise the same
  rejected number reappears every week and gets approved out of fatigue.
- **No proposal below the minimum sample** (§4). The row reads "not enough
  settled jobs yet — 12 of 30", so the screen is honest about why it is quiet
  rather than looking broken.
- **A reason is required on both.** The band is published copy and it moves
  commission; "why" is the part a future reader needs and the part nobody
  writes unless the form insists.
- **Every change is versioned** — a `category_price_revisions` table: category,
  old pair, new pair, source, proposed pair, n, actor, timestamp, reason,
  approved-or-rejected. Append-only with the same trigger shape as
  `security_events`, because a price history the application can edit proves
  nothing. This is also what makes "was the band we published then right"
  answerable later, alongside `bookings.band_min`.
- **The observed column is never blank when data exists**, even with no
  proposal. Seeing p25/p75 drift for two quarters before a proposal appears is
  how a person builds the judgement the approve button needs.
- **Approving shows what it will change**: this band is the floor of every new
  quote in the trade, so the screen states plainly that it does not touch any
  existing booking — `band_min` and `quoted_min` are frozen per row.

### Access

Admin only, `is_admin()`, and the write goes through the service role like every
other price write. `categories` has no update policy today and should not get
one: RLS is row-level, so an update policy on `categories` would make every
column editable from a browser, including the Nepali copy.

---

## 3. Two open questions — noted, not answered

**Should bands vary by area?** Probably yes, eventually, and the evidence is
already in the product: water tank cleaners charge Rs 100–200 more outside the
Ring Road, and that is the smallest version of a real gradient. Arguments for:
an outer-ward job costs the professional travel time, and a single valley-wide
band silently taxes the cheap wards to subsidise the expensive ones. Arguments
against, and they are currently stronger: it multiplies ten bands into ten ×
however many wards, which fragments the sample so far that §4's minimum is
unreachable per cell for years; it makes the published page harder to read; and
it invites the accusation that we charge Lalitpur more for the same work. **The
shape if we do it**: not a band per ward, but a small number of named *zones*
(inside Ring Road / outside / beyond the valley) with a multiplier on the
category band, so there is still one band per trade and one number per zone.
Revisit when any single trade has a few hundred settled jobs.

**Should the per-job sub-bands in `price-bands.ts` become real data?** The
`BAND_NOTES` strings — "washer or joint leak 900-2200; blocked drain 1200-3000;
burst pipe 1500-4500" — are prompt text today. They are already doing real work:
the triage narrows within the category band using them, which is exactly the
right shape, and it is why a leak and a burst pipe do not quote the same range.
Making them a table would let us measure each sub-band separately, would let the
category band be *derived* from its sub-bands rather than guessed alongside
them, and would give painting the two products it actually has. The cost is a
second level of price data to keep honest, with its own provenance and its own
minimum sample — and sub-band samples are by definition smaller than category
samples. **Recommendation**: do it for the trades where a single band is
demonstrably wrong (painting first, then home cleaning and movers), not across
all ten. The natural trigger is the first time a rejected proposal's reason is
"this category is two different jobs".

---

## 4. The robust measure, and why

The problem: `percentile_cont` on a small sample is not as robust as it looks.
With n = 30, p75 interpolates between the 22nd and 23rd values, so three unusual
jobs move it — and in this product the unusual jobs are systematically large
(one whole-flat deep clean among thirty bathroom cleans).

**Chosen: Tukey-fenced winsorised percentiles, with a movement cap.**
Implemented in `lib/data/band-proposal.ts`, pure and tested, **wired to
nothing**.

1. **Minimum sample: 30 settled jobs** in the category over a rolling 180 days.
   Below that there is no proposal at all, not a tentative one.
2. Compute Q1, median, Q3 and IQR on `final_amount` for settled, paid jobs.
3. Fence at **Q3 + 1.5·IQR** and **Q1 − 1.5·IQR** (Tukey).
4. **Winsorise** — cap values at the fence rather than dropping them.
5. Recompute p25/p75 on the winsorised sample. That pair is the proposal.
6. Round outward to Rs 100, so the published band never reads like a computed
   artefact.
7. **Cap movement at ±20%** of the currently published band per revision.
8. Report `n` and how many were winsorised, both on screen.

**Why winsorise rather than drop.** A Rs 40,000 job happened. Dropping it
discards the evidence that the ceiling is not absurd; capping it stops that one
job *setting* the ceiling. Removing data because it is inconvenient is how a
measurement quietly becomes an opinion.

**Why an IQR fence rather than mean ± kσ.** The mean and the standard deviation
are themselves dragged by the outliers you are using them to detect — the
circularity that makes z-score outlier detection fail exactly when it matters.
Quartiles have a 25% breakdown point from each side: a quarter of the sample can
be arbitrarily large before Q3 moves at all.

**Why a movement cap on top.** Robustness handles outliers; it does not handle
*bias*. A genuinely bimodal category — painting, movers — produces a proposal
that is stable, robust and wrong, because the statistic is fine and the model
("one band") is not. The cap means no single approval can move a published price
by more than a fifth, and the winsorised count is the tell: if 15 of 84 jobs are
being capped, the answer is sub-bands (§3), not a wider band.

**Also excluded from the sample**: guarantee re-do visits, which are unpaid
returns rather than market prices. Commission appeals are *not* excluded — an
honest small job is exactly the signal the floor should hear.
