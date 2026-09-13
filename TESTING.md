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

## Adding a fourth

Before you do: say which entity it is, and give it its own number. A second
professional is genuinely useful — a guarantee claim attended by somebody other
than the original professional is the only path that writes a ledger debt, and
it needs two. A second *customer* proves one customer cannot read another's
bookings, which the database suite already proves without anybody signing in.
