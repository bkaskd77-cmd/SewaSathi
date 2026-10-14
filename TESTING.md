# Walking the product

Three accounts, one per entity. **One number, one thing** — that is the whole
rule, and it exists because the previous set broke it.

## The accounts

| Walk as | Phone | Lands on | Has |
| --- | --- | --- | --- |
| **Customer** | `9779841234567` | `/` | 9 bookings, live and finished |
| **Professional** | `9779800000011` | `/provider/jobs` | a listing, "Bikas Khadka" |
| **Admin** | `9779800000012` | `/` | nothing of its own |

The six-digit codes are in **Supabase → Authentication → Providers → Phone →
test numbers**, and nowhere in this repository. A fixed code written beside the
number it opens is a password written on the door.

Sign in at `/login`. There is one sign-in for everybody and that is deliberate:
Supabase keys an account to its phone number, so two sign-in buttons would mean
two accounts on one number, and with phone plus OTP both buttons would open the
same screen and send the same code anyway.

## What each one should see

**Customer.** The account menu has Bookings and Account, and **no "My work"** —
that link appears only for an account that owns a listing. `/bookings` opens on
three tiers: what needs them, what is happening now, then everything earlier.

**Professional.** Signing in with no destination in mind lands on
`/provider/jobs`, not the homepage. The chrome is a dark emerald bar with two
tabs and no catalogue — if you are looking at the ivory marketing header, you
are on the customer side. The wordmark goes back to the public site.

**Admin.** `/admin/applications` opens. The account menu has no "My work",
because an admin is not a professional: they can reach the working screens to
support somebody, but they have no listing and no work of their own.

## The rule that keeps this true

An account's role is a **grant**, recorded in `provisioned_accounts` and applied
by `scripts/provision-accounts.sql`. Editing `profiles.role` by hand works once
and then rots, because nothing records who did it or why.

The same script also **unlinks** any listing from an account granted `customer`
or `admin`. That is not tidiness. The previous roster had an admin account that
had also made every booking in the database and picked up a seed listing by
walking the provider application — one number being all three entities, which is
exactly why it became impossible to tell the dashboards apart.

## What is deliberately not in this table

`9779800000001` is a standing **break-glass admin** and not a walkthrough
account. It is a Supabase test number, so it works while an SMS gateway is dead;
that is the point of it, and it is why it must never be a real SIM. See
`SECURITY.md`.

## The automated half, and what is left for a person

**Every route is walked on the live site by CI**, in the `deploy` job, straight
after the hook that asks Vercel to build: `scripts/await-deploy.mjs` waits until
the alias is serving the commit CI is deploying, then `check:deployed` asks each
public route for its `og:url` and each guarded route for a redirect that keeps
the reader's language. So "did it deploy, is every page there, is every guard
on" is answered without anybody signing in, and a red `deploy` job is the signal
that something below needs looking at by hand.

**What it cannot see is a body behind a guard.** There is no way for a script to
authenticate here — the one door is a phone OTP and that gateway is a launch
blocker — so the three accounts above are the only way anybody looks at
`/bookings`, `/provider/jobs` or the twelve admin screens. That is the half this
section is for.

### Phase 11 — what to look at, and what the live data says you will see

Read off production on 2026-10-14, so these are predictions rather than hopes.
A difference is a finding.

**One rating figure, everywhere.** There is exactly one rated listing —
**Bikas Khadka**, a single 5-star review 25 days old. Every surface should read
**4.5 (1)**: the catalogue card on `/services/plumbing`, the profile page, the
professional picker in the booking flow, the replacement list on a withdrawn
booking, and the professional's own record panel on `/provider`. The figure is
the Bayesian average over the recency-weighted pair and the number in brackets
is the real row count.

- **The profile page is the one to check first.** It printed the raw `5.0`
  until this phase while the card beside it printed `4.5` — two numbers for one
  person, on the page a customer opens to decide.
- **4.5 rather than 5.0 is correct and is the prior**, not a bug: one review is
  thin evidence and the figure says so. The recency half changes nothing
  visible today, because the review is 25 days old and its weight is 0.957 —
  which is the designed behaviour, not a sign it is not wired.

**The review wall is absent, and that is the pass.** One published review
against a floor of eight, so `/` should show nothing at all between the
category grid and "How it works" — no empty heading, no "1 review". Two of the
five refusals also apply to that row: its author has opted out of the activity
strip, and it has no words in it.

**`/admin/reviews`** should show one card: five gold stars, Bikas Khadka,
a **"The customer opted out"** badge, and the sentence "0 of 1 on the homepage
— the wall needs 8 before it appears at all." There should be **no hide form**
on it and the line "Not on the homepage for a reason that is not ours to
change" instead — hiding a review the customer already withheld would write a
staff decision over somebody else's reason.

**What cannot be walked at all today**, and it is worth knowing before looking
for it: nobody can hide a review, because the only published review is not
eligible to be on the homepage in the first place. The hide form appears on a
review that is on the wall or already hidden. The first real test of it is the
eighth review.

## Adding a fourth

Before you do: say which entity it is, and give it its own number. A second
professional is genuinely useful — a guarantee claim attended by somebody other
than the original professional is the only path that writes a ledger debt, and
it needs two. A second *customer* proves one customer cannot read another's
bookings, which the database suite already proves without anybody signing in.
