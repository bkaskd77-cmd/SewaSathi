# The mobile app — plan

**Nothing here is built.** Plan only, in `docs/SLOT-CAPACITY.md`'s shape: the
measurements first, then the five comparisons asked for, then one
recommendation with the conditions that would overturn it.

**Recommendation: an installable web app (PWA), now, in days — and native
deferred behind three named triggers.** The reasoning is below and it is
specific to this product; most of the generic PWA-versus-native argument does
not apply here, in both directions.

---

## 0. What the codebase actually is, measured

| | Count |
| --- | --- |
| Files under `app/` and `components/` | 205 |
| …of them Client Components (`"use client"`) | 85 |
| …so Server Components, which have no React Native equivalent at all | ~120 |
| Server Actions — the **entire** write surface | 26 |
| HTTP API routes | 8, and only `/api/triage` is one a client calls. The rest are two crons, a gateway return, health, version, retention and the unpointed SMS send. |
| Files importing `next-intl` | 145 |
| Lines in the isomorphic rule modules (`provider`, `booking`, `payments`, `reviews`, `abuse`, `config`, `geo`, `text`) | ~11,000 |
| `public/` directory | **does not exist** — no manifest, no icons, no service worker |

Two things follow from that table and they decide most of this document.

**There is no API for a native app to talk to.** Every write in this product is
a Server Action that re-reads `getSessionProfile()` and passes the id down as
`actorId` — the rule three security holes were found by breaking. A React Native
app cannot call a Server Action, so going native means re-exposing 26 actions as
authenticated endpoints: a new surface, a new place for the actor to arrive from
the client, and the one class of bug this product has already paid for three
times. That is the largest hidden cost in the native column and it is not a UI
cost.

**The rules already port and the screens do not.** The ~11,000 lines in those
eight modules are pure and isomorphic on purpose — `displayRating`,
`showsOnHomepage`, `attentionFor`, `blindCashEntry`, `jobFit`,
`containsContactDetails` — and would run unchanged inside Expo. The ~120 Server
Components would not, and `next-intl` would need replacing wholesale, though
`messages/en.json` and `messages/ne.json` are portable data.

---

## 1. Cost

**PWA: days, and no recurring fee.** A manifest, a set of icons, a service
worker, and an install prompt that is not annoying. There is no `public/`
directory yet, so this is additive — nothing existing changes. Play Store
listing via a Trusted Web Activity (Bubblewrap) is a **one-time $25** developer
registration if we want it; the install-from-browser path costs nothing.

**Native: a quarter, then forever.** The API layer for 26 actions, ~120 screens
rebuilt, a second i18n runtime, two store review cycles, and then permanent
dual-platform maintenance — every screen shipped afterwards is built twice, or
the web and the app drift, which is the `displayRating` split at the scale of a
product. Apple Developer Program is **$99/year**. Two things to verify before
costing it seriously: whether Apple Developer Program enrolment is available in
Nepal (I am not confident and it is load-bearing), and Google's current closed-
testing requirement for new personal developer accounts, which has recently
needed a number of testers over a number of days before production release.

---

## 2. Camera-only enforcement

**Neither closes it for free, and this is the finding worth the most in this
document.** `ARCHITECTURE.md § Camera-only is not enforceable on the web` says
the mobile app can close the hole, which is true of a native camera intent — but
the product's own gate makes the web middle path worse than it looks, and the
native path need more than the intent.

- **Today**: `capture="environment"` is a request every browser may ignore, so
  freshness is read from the photo's own EXIF `DateTimeOriginal` instead.
- **A PWA could use `getUserMedia`** — a live camera stream drawn to a canvas —
  and those bytes genuinely never touch a file picker. **But a canvas JPEG has
  no EXIF at all**, and `lib/photos/evidence.ts` refuses a claim photo whose
  freshness is `no-capture-time` with `reason: "noCameraTime"`. So the web
  camera path would be **refused by our own gate**, and the fix is not a camera
  change: it is deciding that the capture time may come from the app's own
  attestation rather than from the file.
- **A native intent has the same problem one step along.** It returns trusted
  bytes to the app; the server still only sees an upload, and "this came from a
  camera" is a claim the client makes. Closing it properly means signing the
  capture server-side or trusting a platform attestation (Play Integrity, App
  Attest) — which is real work on top of going native.

**So camera-only is not a reason to choose native.** The work it needs — moving
capture time off the file and onto something we can vouch for — is the same
work in both columns, and until it is done the checks that matter are the ones
on the bytes.

---

## 3. Push notifications

**This is native's strongest card and it is weaker here than usual**, because
of what this product's notifications are for.

- **`lib/notify` carries keys, not sentences**, precisely so a channel can be
  added later: one file implementing `NotificationChannel` plus a line in the
  registry. Push and SMS are the same size of change.
- **The job is telling somebody a professional is on the way.** The channel that
  does that for every handset in Nepal is **SMS** — it reaches feature phones,
  it reaches an iPhone whose owner will never install a PWA, and it needs no
  install step at all. Phase 13 is already SMS for this reason.
- **Web push works on Android** (Chrome, no install needed for notifications
  once permission is granted) and on **iOS only for a PWA added to the home
  screen**, since 16.4. So the iOS gap is real but it is a gap in the *push*
  channel, on the platform with the smaller share here, for a message SMS
  already delivers.
- Worth stating plainly: **the SMS gateway is a launch blocker and unbought**,
  so no channel works today. Choosing native for push would be buying a quarter
  of work to solve a problem the unbought gateway solves for a per-message fee.

---

## 4. Play Store and App Store

- **Play Store: a PWA can list**, wrapped as a Trusted Web Activity. It is the
  real browser engine, so there is one codebase and no drift.
- **App Store: a PWA cannot list.** Apple's guideline 4.2 rejects apps that are
  a thin wrapper around a website, and a TWA-equivalent is exactly that. An iOS
  presence means a real native app.
- **How much that costs us depends on a number I should not assert.** iOS share
  in Nepal is low — single digits to low teens by most estimates — and that is
  worth confirming against real figures before it carries a decision. If it is
  5%, the App Store is a rounding error for a launch; if it is 20% and
  concentrated among exactly the households who pay digitally for home services,
  it is not.
- **Being in a store is not the only way to be installed.** A PWA installs from
  the browser with no store, no review and no gatekeeper — which also means no
  review *delay* when something needs fixing, and this product deploys on every
  push.

---

## 5. How much of the current code each reuses

**PWA: all of it.** 205 files, 26 server actions, the whole i18n setup, every
rule module, and the performance work — the font scoping, the bundle budgets,
the `Reveal`/`animate-rise` motion, the server-rendered `/bookings` that ships
no JavaScript. A service worker makes that last one better rather than
redundant: the page is already correct on a connection that never finishes, and
a cache would make it instant.

**Native: the ~11,000 lines of pure rules, and the message catalogues as data.**
Everything else is rebuilt — and a second implementation of a screen is a second
opinion waiting to diverge, which this repository has a named scar for on
exactly that subject.

---

## 6. The recommendation, and what would overturn it

**Build the PWA.** It costs days, risks nothing, reuses everything, and is
reversible. Concretely: `public/manifest.webmanifest`, the icon set, a service
worker that caches the static shell and the catalogue reads (never a signed-in
page — a cached `/bookings` showing yesterday's state is the missed-transition
failure `use-booking-channel` exists to prevent), an install prompt behind a
real signal rather than on first load, and `display: standalone` so an installed
copy gets push on iOS the day a channel exists.

**Go native when one of these is true, and not before:**

1. **The professional side needs the phone to do something a browser cannot** —
   continuous background location, a foreground service, or a reliable alarm.
   Nothing today needs it: `on_job_since` is written by a trigger from booking
   status, not from GPS.
2. **iOS turns out to be a material share of paying customers**, measured off
   our own traffic rather than estimated.
3. **Push becomes the channel the product depends on** and SMS has proved too
   expensive or too slow at volume — a decision with a per-message figure
   behind it.

**One thing to do now that helps either way**: keep new rules in the isomorphic
modules and keep Server Actions thin. Every rule that lives in `lib/provider`
rather than inside a component is a line a native app would not have to rewrite,
and that is the cheapest possible hedge.

## 7. Not in this plan

Offline booking creation (a queued write that settles later is a money path and
needs its own argument), a native payments SDK, and app-store-specific
onboarding. Each is a decision rather than a detail.
