# Moving production from Vercel to our own VPS

**Status: planning.** Decided by the owner on 2026-11-25: production will run on
our own VPS, not on Vercel. Production stays on Vercel until the cut-over below
has passed every check. Tracked as `LAUNCH-BLOCKERS.md § vps-migration`.

**The app itself is portable; the machinery around it is not.** Measured by
reading every `VERCEL_*` read and every Vercel mention in code: the product reads
Vercel in five places, all of them deploy automation, scheduled jobs, or checks.
Nothing a customer touches needs rewriting.

---

## Decide first

1. **Location: Singapore, unless there is a strong reason otherwise.** The
   database (Supabase) is in Singapore, and a signed-in page asks it 8–12
   questions, several one after another. Server and database must be close:
   this product once ran its server in the USA against a Singapore database and
   every page waited 2–3 seconds before sending a byte. A server in Nepal is
   much nearer than the USA but still pays a Kathmandu–Singapore round trip on
   every question; measure it before choosing it (`server.region` on
   `/api/health` prints the figure).
2. **Size.** Build in CI and ship the result, so the server only *runs* the app:
   **2 vCPU, 2–4 GB RAM, 40 GB SSD, Ubuntu 24.04 LTS, a static IPv4.** Building
   on the server instead needs 4 GB, because `next build` is the hungriest thing
   this app does.
3. **Domain and DNS.** Cloudflare in front (free plan): HTTPS at the edge, static
   files cached near Nepal, and DDoS protection — the three things Vercel did
   that a bare VPS does not.

---

## What does not change

The app code, Supabase (database, sign-in, storage), GitHub and every CI test,
the nightly database backup (`backup.yml` dumps Supabase, not the server), and
UptimeRobot (only its URL moves).

## What changes

| # | Today on Vercel | On the VPS | Repository change |
|---|---|---|---|
| 1 | Vercel runs the app | `next start`, **one process**, under systemd so it restarts after a crash | `deploy/sajilokaam.service` |
| 2 | Vercel's HTTPS | Caddy as the reverse proxy (automatic certificates), Cloudflare in front | `deploy/Caddyfile` |
| 3 | Push → CI → Vercel deploy hook (`scripts/trigger-deploy.mjs`), gated by `scripts/vercel-ignore-build.mjs` | CI, after `verify` passes: build, copy the build to the server over SSH, switch a symlink, restart. **Rollback is switching the symlink back.** | Replace both scripts with one deploy script. **Keep** `await-deploy.mjs`, `check:deployed` and `check:drift` — they read the live site and work on any host. |
| 4 | `vercel.json` crons call `/api/payments/reconcile` (03:00 UTC) and `/api/bookings/dispatch` (04:00 UTC) | The server's crontab calls the same two URLs with `Authorization: Bearer $CRON_SECRET` | `deploy/crontab`; the test comparing `CRON_JOBS` with `vercel.json` reads it instead |
| 5 | Secrets in Vercel's dashboard | One env file on the server, readable only by the app's own user | — (the 18 names are in `.env.local.example`) |
| 6 | `server.region` reads `VERCEL_REGION` | **Would report `unknown` — a 503 on the detailed health check.** Judge by the measured round trip to Supabase instead of a region name, which is what the check's own comment says matters | `app/api/health/route.ts` |
| 7 | `after-deploy.yml` listens for Vercel's deployment events | Removed — Vercel stops sending them. CI's deploy job keeps the same walk and drift check | Delete the workflow; update `tests/unit/drift-token.test.ts` |
| 8 | Vercel's CDN | Cloudflare caches `/_next/static/*` only — **never a page, never `/sw.js`**, for the reason `lib/pwa/cache-rule.ts` gives | Cloudflare cache rules |
| 9 | Vercel looks after the machine | Ours: a non-root app user, SSH keys only (no passwords), firewall open on 22/80/443 only, automatic security updates, fail2ban | A server-setup section in this file |
| 10 | Rate limits and the triage cache live per Vercel instance | One process means one shared counter — **better than today**. Do not switch on cluster mode (`pm2 -i`) without moving them to a shared store first | — |
| 11 | No fixed address, so SMS IP whitelisting was a problem | **A static IP: register it with the SMS provider's whitelist**, so a stolen token is useless from anywhere else | Provider dashboard |
| 12 | Build stamp from `VERCEL_GIT_COMMIT_SHA` | Already falls back to `git rev-parse HEAD`; CI passes the commit when it builds | — |

---

## Cut-over, in order — every step reversible

1. **Prepare the server** (rows 1, 2, 5, 9). Nothing points at it yet.
2. **Deploy to a test address** such as `new.<domain>`. Run `npm run check:deployed`
   and `npm run check:drift` against it; sign in with a test number; open a booking.
3. **Start the server's crontab.** The two sweeps are idempotent — running on
   Vercel and the VPS in the same night is safe, a night when neither runs is
   not. Confirm `cron_runs` shows rows from the VPS before step 6.
4. **Point UptimeRobot** at the new address.
5. **Switch DNS** to the VPS. Leave the Vercel deployment running untouched for a
   week: **rollback is pointing DNS back**.
6. **Turn off Vercel's crons** only after step 3 is confirmed.
7. **If the domain changed**, update Supabase → Authentication → URL
   configuration (site URL and redirect URLs), the Send SMS hook URL, and
   `NEXT_PUBLIC_SITE_URL`. Sign-in breaks silently without the first one.

---

## What is needed from the owner

- **The VPS's details**: provider, location, size, operating system, whether the
  IP is static. A screenshot of the provider's page is enough. **Never a
  password or a key.**
- **The domain**, and whether its DNS can move to Cloudflare.
- **Deploy access**: an SSH key pair made for deploys only — the public half
  added on the server, the private half saved as a GitHub Actions secret. Exact
  steps follow once the server exists.
