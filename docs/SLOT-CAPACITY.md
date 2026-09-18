# Slot capacity — plan

**Built, and since superseded in two places.** This is the write-up asked for
before building, kept for the reasoning. Two things in it are no longer true and
ARCHITECTURE.md is the current map:

1. **A fixed two-hour window is gone.** Every booking carries its own length —
   `estimated_working_minutes` from the sub-band, or the professional's own
   figure after they have seen it — and overlap is measured per job, so a
   four-hour deep clean no longer reserves the same block as a forty-minute
   leak.
2. **`categories.max_concurrent_jobs` is dropped and the provider column is
   `crew_count`.** The column was two facts under one name: job length, which
   the scheduler now models directly, and crew size, which it never did. Every
   formula below that reads `max_concurrent_jobs` means `providers.crew_count`
   with no category term, and `PROBATION.maxConcurrentJobs` is
   `PROBATION.maxCrew`.

Today nothing stops two customers booking the same professional at 2pm. The one
who loses finds out on the day, from a person who does not arrive. The
`canServeAt` work shipped earlier deliberately left this out — it answers "are
they in somebody's house *right now*", which is a different question from "is
Thursday 2pm already spoken for".

Decisions already taken, and this plan assumes them:

- A full professional is **shown greyed with their next free slot**, not hidden.
- **Deliberate overbooking is allowed only when the professional explicitly
  offers it on that specific booking.** Never a standing setting, never
  customer-initiated, never automatic.

---

## The model

The unit is **concurrent jobs in an overlapping window**, not "one booking per
slot". `WORKING_HOURS.slotHours` is 2, so a job at 2pm occupies 14:00–16:00 and
overlaps anything starting before 16:00.

```
effective limit = min(
  providers.max_concurrent_jobs ?? categories.max_concurrent_jobs,
  PROBATION.maxConcurrentJobs   // 2, while on probation
)
```

Counted against the limit: bookings held by that professional in `pending`,
`accepted`, `en_route` or `in_progress` whose window overlaps. An emergency
counts as starting now.

**Why a per-listing override exists, and why it is not self-set.** A `providers`
row is sometimes one person and sometimes a firm with three crews. A category
number cannot describe both, and movers is where that breaks hardest — see the
defaults below. So `providers.max_concurrent_jobs` is nullable and **admin-set
at onboarding from verified crew size**; a professional setting their own would
make every listing say 10 and capacity would mean nothing. Probation always
caps, whatever the override says.

**Enforced by a trigger, not a call site.** A booking gains a professional five
ways — `createBooking`, `chooseProvider`, `claimJob`, the dispatch sweep, and
the overbook offer. `enforce_slot_capacity` on `bookings`, BEFORE INSERT OR
UPDATE, same argument as `bookings_sync_quote_floor`. The pure half is
`lib/booking/capacity.ts` (`slotWindow`, `capacityFor`, `hasRoom`), so the
screens and the database read one rule.

---

## The ten defaults, with the trade knowledge behind them

Two of these are the ones to argue about, and the challenge was right on both.

| Trade | Default | Why |
| --- | --- | --- |
| Home cleaning | **1** | Physically in one house for the whole window. There is no version of this that overlaps. |
| Water tank cleaning | **1** | A crew, one tank, 1–3 hours including drain, scrub and refill. The tank is out of service while they work. |
| Movers & packers | **1** *(+ override)* | See below — the number is right and the *model* is wrong. |
| Plumbing | **2** | A leak or a blocked drain is 30–90 minutes and plumbers genuinely stack call-outs in a neighbourhood. Two in one window means real travel between; three is a promise that fails. |
| Appliance repair | **2** | Diagnose plus repair is 45–90 minutes, and a part run to the shop is common and unpredictable. |
| Carpentry | **2** | Bimodal: a hinge or a lock is 20 minutes, a door or a cupboard rebuild is half a day. Two is safe for the short end and honest about the long one. |
| Pest control | **2** | Treatment is 45–90 minutes per flat plus chemical handling. Operators do several a day, but the safety window between makes three in one slot unrealistic. |
| AC servicing | **2** | A service is 45–60 minutes; a gas refill or an installation is 2–4 hours. Two, because the expensive jobs are the long ones. |
| Electrical | **3** | The published rate cards tell the story — socket 350, light point 550, MCB 500 — these are 20–40 minute visits. Three is comfortable. |
| **Painting** | **3** | **The challenge was right.** Painting is multi-day with long idle stretches by design: putty dries, primer cures, coats need hours between them. A painter who is not running two or three sites concurrently is losing money. |

### Painting

Three, and a caveat that matters more than the number: **the slot model does
not describe painting.** A two-hour window is the wrong unit for a job that
occupies a site for four days and a person for a few hours of each. Capping it
at 3 concurrent two-hour slots is a crude proxy that will be roughly right for
booking collisions and roughly meaningless for the professional's actual week.
The real fix is a job-duration field — `categories.typical_duration_hours`, or
per-job durations once the sub-bands in `docs/PRICING-BANDS.md` §3 exist — and
until then painting's number should be read as "do not block a painter from
taking a second job", not as a model of their capacity.

### Movers & packers

**1, and this is the trade that proves the per-category default is the wrong
shape on its own.** One man with a pickup can do one move. A firm with three
trucks and three crews can do three, simultaneously, in different wards — and
both are a single `providers` row today. A category number cannot tell them
apart.

So: category default **1**, because that is the safe floor and the one that
protects a customer; and `providers.max_concurrent_jobs` set by an admin at
onboarding for a listing that is verifiably a firm. A mover who is genuinely
three crews gets 3 and the cap stops meaning "one van, three houses, one
morning". This is also the only trade where an over-promise is close to
unrecoverable: a half-loaded lorry cannot be handed to somebody else.

---

## 1. The greyed row — a conversion moment

A full professional stays in the list. A customer who arrived from Krishna's
profile and cannot find Krishna assumes the product is broken, which is the same
reasoning that kept unavailable professionals visible in the on-a-job work.

The row shows, quietly and with no warning colour:

```
  ┌────────────────────────────────────────────────────────┐
  │  K   Krishna Bahadur Gurung          ⓘ Busy at 2:00 pm │  (dimmed)
  │      ★ 4.8 (127) · 340 jobs                Rs 900 from │
  │      Next free today at 4:00 pm                        │
  │      [ Book 4:00 pm instead ]                           │
  └────────────────────────────────────────────────────────┘
```

Rules:

- **The button works and books.** One tap rewrites `slot` on the draft, keeps
  everything else the customer has typed, selects Krishna, and returns them to
  the review step. It is not a hint to go back and change the time themselves.
- **Choosing somebody else stays one tap** — the rest of the list is unchanged
  and undimmed beneath.
- **The next free slot comes from the same generator the When step uses**
  (`generateSlots`, minus their overlapping windows), so the shortlist and the
  time picker can never disagree about what is bookable.
- **No free slot inside the horizon** → the row says so plainly and offers only
  "choose someone else". A Book button that leads nowhere is worse than no
  button.
- **Never an error state.** No red, no `aria-invalid`, no "unavailable". The
  professional is popular; that is information, not a fault — and on the card
  it reads closer to a recommendation than a warning.
- **The list does not re-sort under the finger** when a slot is picked.

---

## 2. Emergency — absent, not greyed

A professional with no room **does not appear in emergency suggestions at all**,
consistent with the on-a-job rule already shipped.

Two surfaces, and they are deliberately different — this is the distinction most
likely to get muddled later:

- **`pickAlternatives`** (the replacement panel after a withdrawal, and any
  emergency suggestion list) — **filtered out entirely.** That list is read by
  somebody already let down once; a name they tap that the server refuses is a
  second failure inside a minute. The filter already exists via `blocksBooking`;
  capacity joins `canServeAt`, so this needs no new code there.
- **The booking shortlist** on an emergency — the existing "Cannot come right
  now" group, shown but not selectable. A customer choosing for themselves is
  told why; a customer being *offered* names is only offered ones that work.

Mechanically: `canServeAt` gains the capacity question, so everything that
already reads it inherits the behaviour — `createBooking`, `chooseProvider`,
`pickAlternatives` and the shortlist.

---

## 3. When an overbooking goes wrong

The part worth deciding now rather than discovering.

### The offer itself

- Attached to **one booking**, recorded with who offered and when
  (`bookings.overbook_offered_by`, `overbook_offered_at`). It does not survive
  the booking and there is no setting anywhere.
- **The customer is told before they book**, on the review screen: *"Krishna has
  offered to fit you in alongside another job. He may arrive later in the
  window."* Consent at the point of choice, not a surprise on the day — the same
  rule as the quote band and blind cash entry.
- **At most +1 over the effective limit.** A professional cannot stack offers
  until the cap means nothing.

### When it goes wrong

Triggered when the earlier job is still `in_progress` inside the later job's
window:

- **The second customer is told, before the slot ends, not after.** A keyed
  notification (`booking.mayRunLate`), so Nepali works and Phase 13 sends it by
  SMS with no new decision. The message says what is true: he is finishing
  another job and may be late.
- **They get a one-tap out.** "Find somebody else" releases and reopens the job
  immediately, no fee, no penalty — and **records no refusal against the
  professional**, who was working rather than refusing. Exactly the
  `widened_by_customer_at` reasoning already in the dispatch code.

### What it counts against

Two facts, and conflating them would be the mistake:

- **Lateness is the professional's and it is measured** — a start after the slot
  ends. It goes into **ranking, never rating**, the same rule as availability: a
  busy plumber is not a worse plumber, but a habitually late one is a worse
  choice for a named time.
- **An overrun is not automatically a fault.** The counter is
  `provider_stats.overbook_misses` over `overbook_offers` — incremented only
  when they *deliberately offered* the overlap **and** the second job then
  started late or the customer left. Every job overrunning sometimes is the
  trade; offering to fit somebody in and not turning up is the thing worth
  counting, and that ratio is its honest denominator.
- **Never an automatic step on the enforcement ladder.** It is a ranking input
  and a number on their own dashboard, so a professional can see what
  over-offering costs them before anybody else does.
- **`/providers/standards` gains a line under *What is never a signal*:**
  offering to fit somebody in is not held against you — only offering and then
  not arriving. Deterrence nobody can read is a trap, and this is a rule people
  would otherwise learn by being punished.

---

## What changes

| File | Change |
| --- | --- |
| `lib/booking/capacity.ts` *(new)* | `slotWindow`, `capacityFor`, `hasRoom`, `nextFreeSlot` — pure, tested |
| `lib/provider/serving.ts` | `canServeAt` gains the capacity question, so every existing caller inherits it |
| migration | `categories.max_concurrent_jobs`, `providers.max_concurrent_jobs`, `bookings.overbook_offered_{by,at}`, `provider_stats.overbook_{offers,misses}`, `enforce_slot_capacity` trigger |
| `components/booking/step-provider.tsx` | the greyed row, next free slot, one-tap reslot |
| `components/booking/step-review.tsx` | the overbook sentence before confirming |
| `lib/data/recommendations.ts` | inherits the emergency filter; no change expected, pinned by a test |
| `app/[locale]/(work)/provider/**` | the offer control on one job, and the miss ratio on the dashboard |
| `lib/notify` | `booking.mayRunLate` |
| `lib/content/pages/standards.ts` | the never-a-signal line, both languages |
| `messages/{en,ne}.json` | the new copy, Nepali written not translated |

## Verification

- Unit: the overlap arithmetic at window edges (a job ending exactly as another
  starts does **not** overlap); `capacityFor` taking the min of category,
  override and probation; `nextFreeSlot` skipping full windows and returning
  null past the horizon.
- Unit: an emergency never proposes a professional with no room.
- Db: the trigger refuses the second booking at capacity, for the customer's own
  session **and** the service role; allows it when an offer is recorded; refuses
  a second offer beyond +1; two simultaneous claims cannot both land.
- Db: probation caps a firm's override.
- Walk it with the three test accounts: fill a professional, see the greyed row
  and book the next slot; as the professional offer an overlap and confirm the
  customer is told before confirming; leave the first job running into the
  second and confirm the notification and the one-tap out.
