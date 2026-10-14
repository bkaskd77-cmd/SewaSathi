# The customer wallet — plan

**Nothing here is built, and nothing is built before launch** — the owner's
call, 2026-10-14. This is the write-up before building, in the shape
`docs/SLOT-CAPACITY.md` takes: the problem in the product's own facts, the
design, what it costs, and the four decisions, which are taken now and recorded
in §8 so they do not have to be argued again when the first cash refund has to
be paid.

**The headline decision: a refund keeps the original payment rail by default.**
Credit is an extra option offered beside it, never the preselected one.

---

## 1. The problem, and it is not the one the word "wallet" suggests

**What we owe a cash customer has no rail, and the published terms already
admit it.** `lib/content/legal/refunds.ts` says a cash refund is sent "to your
eSewa or Khalti account, or you can collect it in cash from our office. Your
choice, and we will ask rather than assume." That is honest and it is a manual
process with a person on each end. On the digital side a refund reverses to the
wallet it came from and `sendRefundAction` can do it; on the cash side there is
no rail at all, and cash is the **primary** path in this product by design.

**The symmetric mechanism already exists and runs in one direction only.**
`tripDebtOnBill` adds what a customer owes us to their next bill, capped at a
quarter of it (`TRIP_COMPENSATION.recoveryCapBps`), with the stated reason that
a bill which suddenly doubles is how somebody decides never to use the platform
again. `customer_risk.trip_debt_rupees` is the balance and it only goes up
until a later job brings it down. There is **no row anywhere for what we owe a
customer** — so the obligation lives in a `refunds` row at `requested` and in
somebody's memory.

So the thing to build is not a wallet. It is **the other direction of a net
that is already half-built**: a customer balance that a later bill draws down,
the way `applyRedoRecovery` nets a professional's debt forward against future
earnings rather than chasing it backwards.

**Three things it fixes, in order of how often they will happen:**

1. **A cash refund can be settled the day it is agreed** rather than waiting on
   a wallet transfer somebody has to initiate or a trip to an office that does
   not exist yet.
2. **Goodwill has somewhere to go.** Today the only apology this product can
   make costs a person's time and a gateway transfer. A Rs 300 credit is one
   insert.
3. **The gateway cashback campaigns** CLAUDE.md already says to ask eSewa and
   Khalti about at merchant onboarding land somewhere. A gateway-funded
   incentive costs us nothing and currently has no mechanism to arrive in.

---

## 2. What it must never be, and this is the load-bearing section

**It is closed-loop credit, not stored value.** The distinction is the whole
design and it has to be decided before a line is written, because the two are
different products under Nepali law:

- **No top-ups, ever.** A customer cannot put money in. Every rupee of credit
  arises from an obligation we already have — a refund we agreed, a trip
  charge we reversed, goodwill we chose, a gateway campaign we joined.
- **No cash-out.** Credit is spendable against our own services and nothing
  else. A customer who wants money instead gets the existing refund rail; that
  option is never removed, and the screen says so.
- **No transfers between accounts**, and no expiry (see §6).

**Why it matters:** holding customer money as a redeemable balance is a
regulated activity in Nepal — Nepal Rastra Bank licenses payment service
providers and payment system operators, and a wallet that accepts top-ups and
pays out is squarely what those licences are about. Closed-loop credit that
arises only from our own obligations and is never redeemable for money is a
materially different thing. **I am not in a position to tell you where the line
falls**, and the honest statement is that it is a question for somebody who is:
the design above is drawn to stay as far from the line as the feature allows,
and the one change that would move it is a top-up field. If a top-up is ever
wanted, that is a licensing question first and a schema question second.

The same reasoning is why `payoutPlan` holds back a quarter rather than
extending the payout hold, and why there is no cash surcharge: the cheapest
version of a feature is sometimes the only version that is ours to ship.

---

## 3. Where credit comes from

Four sources, each already a real event in the product with a row behind it:

| Source | Trigger today | What changes |
| --- | --- | --- |
| `refund` | `issueRefundAction` agrees a refund | The customer chooses credit or the existing rail. Credit is instant; the rail is unchanged. |
| `trip_reversal` | An admin upholds a customer's trip-charge dispute | `customer_risk.trip_debt_rupees` comes down today and nothing reaches the customer if it was already collected. Credit is how a collected charge is given back. |
| `goodwill` | A person decides, on a booking | New. Needs a cap and a reason — see §6. |
| `campaign` | A gateway-funded promotion | New, and deliberately last: nothing is built for it until a gateway has actually offered one. |

**Nothing writes credit automatically.** Every one of these is a decision a
person takes or an obligation already agreed, which is the same rule
`judgeNoShowClaim` has after its `upheld`-pays-itself branch was removed: an
automatic payoff is a farmable one.

---

## 4. Schema

Two objects, and the shape is `provider_ledger`'s because that arrangement has
already survived a payout run, a recovery sweep and a reversal.

**`customer_credits`** — append-only, `refuse_rewrite()`, like
`provider_ledger` and `security_events`. One row per movement, never a mutable
balance:

```
id, customer_id, booking_id (null for goodwill with no job),
kind  in ('refund','trip_reversal','goodwill','campaign','spent','expired')
amount_rupees  -- positive adds, negative spends. Never zero.
decided_by     -- null only for 'spent', which is the system applying it
reason         -- required on 'goodwill'; the refund's own row carries the rest
created_at
```

**`customer_balance(uuid)`** — `security definer`, and **the grant is the
question to ask of it**, not the policy. `provider_outstanding` and
`provider_balance` both shipped with `execute` for `authenticated` while being
definer functions, so any signed-in customer could read any professional's
money position by naming their id. The fix cost nothing because no production
caller needed the grant. This one is read by a customer's own account page, so
either it is revoked from `authenticated` and read through the service role
like every other money surface, or it takes the caller's id from
`auth.uid()` and never from an argument. **Revoked and service-role** is the
answer that matches the rest of the product.

Plus one column: **`bookings.credit_applied_rupees`**, frozen at settlement
beside `band_min` and `commission_bps`, so a dispute can show what the customer
actually handed over. Null is "not recorded" — every booking taken so far.

---

## 5. The rules, and where they are applied

**`lib/payments/credit.ts`**, pure, beside `pricing.ts` and `destination.ts`.
One function with the shape `tripDebtOnBill` already has:

```ts
creditToApply({ billRupees, balance, isCash }): {
  rupees: number; remaining: number; why: "none" | "capped" | "whole"
}
```

**Three rules, each with its reason:**

1. **It applies at settlement, never at the quote.** The band is what we
   published and the final amount is what the work came to; a credit is neither.
   Applying it to the quote would make `openPayment`'s judgement of an amount
   against the band a judgement of a different number, and
   `freeze_booking_band` would freeze a figure nobody agreed.
2. **There is no cap on the share of a bill it may clear, which is the opposite
   of the trip debt's quarter — and the asymmetry is the point.** That cap
   exists because a bill that suddenly doubles loses the customer along with the
   debt. A bill that goes DOWN has no such failure mode, so capping it would be
   making somebody wait for money we have already agreed they are owed, to no
   end.
3. **On a cash job the credit comes off what the professional collects, and
   they must be paid in full regardless.** This is the half that costs real
   money and it has to be said out loud: a customer with Rs 500 credit on a
   Rs 1,000 cash job hands over Rs 500, so the professional is Rs 500 short on
   notes they are owed. The answer is a `provider_ledger` row — the mirror of
   the `commission_due` row that `settleTripDebt` already writes on the cash
   path — so the shortfall rides the same two-way net to their next payout.
   **Never a shortfall the professional absorbs**, and never a reason to pay
   them less: `payoutPlan` and the published standards both promise otherwise.

---

## 6. What a customer reads, and the two numbers that are not in the schema

- **`/account` shows the balance, where each rupee came from, and that it
  cannot be cashed out** — with the refund rail offered beside it, because a
  credit presented as the only option is a refund quietly withheld.
- **No expiry.** Expiring credit is a liability that clears itself by taking
  something from somebody who did not spend it in time, and `expired` is in the
  kind list only so the column does not need a migration if that decision is
  ever taken. Nothing writes it and nothing should without a published term.
- **A goodwill cap, and it is deliberately not a number in this plan.** The
  shape to copy is `maxPaidClaimsPerPeriod`: a named constant set to `null` and
  unarmed, with the reasoning beside it, rather than a figure guessed under
  pressure later. Every goodwill credit is audited and on a screen; a cap
  arrives when there is a pattern to cap.

---

## 7. What it costs

- **A cash job where credit covers part of the bill puts a professional's money
  on our net rather than in their hand that day.** Bounded by the balance, which
  is bounded by what we agreed to refund — but it is real, and it is the one
  line in here somebody could reasonably refuse.
- **`/admin/revenue` grows a line.** Credit spent is not revenue and not a
  refund; it is an obligation being discharged. `refundFunding` already proves
  the shape — commission returned is its own line and is never netted, so a week
  with a large refund shows the refund. Credit needs the same treatment or the
  weekly figures stop reconciling.
- **One more frozen column on `bookings`**, which is now 85-odd wide.

---

## 8. Decided, and when

**NOT BEFORE LAUNCH.** The owner's call, 2026-10-14, and it is the right one:
every rupee of credit this would hold arises from an obligation we have already
agreed, and we have agreed none — there is no settled payment, no refund and no
guarantee claim in production. A wallet built now would be a schema with a
screen and nothing in it, which is `proposeBand`'s four-phase sin bought
deliberately instead of by accident. It gets built when the first cash refund
has to be paid and the rail is the slow way to do it.

**1. The refund keeps the original payment rail by default.** Decided. A
digital refund reverses to the wallet it came from and a cash refund goes
wherever the customer says, exactly as `lib/content/legal/refunds.ts` already
publishes it; credit is only ever an extra option, offered beside the rail with
"instant" next to it, never the preselected one. Defaulting to credit would be
defaulting to the option that keeps the money inside the platform, which is a
thing to be chosen by the person owed it and not by us.

The other three, in the plainest form, so the argument does not have to be had
again from scratch:

**2. Closed-loop only.** Credit can only ever arrive from something we already
owe — a refund we agreed, a trip charge we reversed, goodwill, a
gateway-funded campaign — and can only ever be spent on our own services, so
there is no top-up field anywhere and no way to take money back out. That
matters because the moment customers can put money in and get money out we are
running something Nepal Rastra Bank licenses, and the distance between those
two products is exactly the top-up field.

**3. A cash-job shortfall rides our net, and the professional is paid in full.**
If a customer with Rs 500 credit settles a Rs 1,000 cash job they hand over
Rs 500, so the professional is short Rs 500 of notes they are owed — and that
is recovered through a `provider_ledger` row on the same two-way net that
already carries cash commission, never by paying them less. The alternative is
restricting credit to digital jobs, which is simpler and safer and useless to
most of the people the feature is for, since cash is the primary path here.

**4. Goodwill needs the fifteen-minute re-auth, and a cap that starts unarmed.**
Issuing goodwill moves money out of the company on one person's judgement, so it
takes the `approvePayout` posture rather than `markConfirmed`'s — a code
demanded for a write that cannot cost anything is how people learn to tap
through the ones that can. The cap is a named constant set to `null` with the
reasoning beside it, the `maxPaidClaimsPerPeriod` shape, because a figure
guessed before any goodwill has ever been issued would freeze a guess into the
codebase as a standard.

## 9. Not in this plan

Loyalty points, referral credit, subscriptions, anything that earns credit from
behaviour rather than from an obligation. Those are a growth mechanism and this
is a settlement mechanism, and the reason to keep them apart is that the first
one makes credit something people chase — at which point "no cash-out" stops
being a design choice and starts being the thing somebody tries to get around.
