# Moving production from Vercel to our own VPS

**Status: planning.** Decided by the owner on 2026-11-25: production will run on
our own VPS, not on Vercel. Production stays on Vercel until the cut-over below
has passed every check. Tracked as `LAUNCH-BLOCKERS.md § vps-migration`.

**The app itself is portable; the machinery around it is not.** Measured by
reading every `VERCEL_*` read and every Vercel mention in code: the product reads
Vercel in five places, all of them deploy automation, scheduled jobs, or checks.
Nothing a customer touches needs rewriting.

---

## Decided (2026-11-25)

- **The server: the owner's existing Hostinger VPS** — plan KVM 2, Ubuntu 24.04
  LTS, static IPv4 `31.97.177.207`, 100 GB disk (77 GB already used by the
  owner's other projects when read), 8 TB bandwidth.
- **Shared with the owner's other projects, each in its own Docker container**,
  rather than a separate server. All projects on it are the owner's. The cost is
  stated once so it is a decision rather than an oversight: this server will hold
  the Supabase service-role key, the payment keys and the key sealing
  professionals' bank accounts, and a compromise of the HOST — not of a
  container — reaches all of them. The rules under *Docker on a shared host* are
  what keep a problem in another project's container from becoming ours.
- **The domain goes through Cloudflare.**

## Still to decide

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
| 1 | Vercel runs the app | **One Docker container** running `next start` (Next's `standalone` output keeps the image small), one process, `restart: unless-stopped` | `Dockerfile`, `deploy/compose.yml`, `output: "standalone"` in `next.config.mjs` |
| 2 | Vercel's HTTPS | Cloudflare at the edge; the host's existing reverse proxy routes our domain to our container | Proxy config for our domain |
| 3 | Push → CI → Vercel deploy hook (`scripts/trigger-deploy.mjs`), gated by `scripts/vercel-ignore-build.mjs` | CI, after `verify` passes: **build the image in CI** (never on the server — 23 GB free and other projects running), push it to GitHub's registry tagged with the commit, then SSH in and `docker compose pull && up -d`. **Rollback is starting the previous commit's image.** | Replace both scripts with one deploy script. **Keep** `await-deploy.mjs`, `check:deployed` and `check:drift` — they read the live site and work on any host. |
| 4 | `vercel.json` crons call `/api/payments/reconcile` (03:00 UTC) and `/api/bookings/dispatch` (04:00 UTC) | The server's crontab calls the same two URLs with `Authorization: Bearer $CRON_SECRET` | `deploy/crontab`; the test comparing `CRON_JOBS` with `vercel.json` reads it instead |
| 5 | Secrets in Vercel's dashboard | One env file on the host, readable only by root, passed to the container with `env_file` — never inside the image | — (the 18 names are in `.env.local.example`) |
| 6 | `server.region` reads `VERCEL_REGION` | **Would report `unknown` — a 503 on the detailed health check.** Judge by the measured round trip to Supabase instead of a region name, which is what the check's own comment says matters | `app/api/health/route.ts` |
| 7 | `after-deploy.yml` listens for Vercel's deployment events | Removed — Vercel stops sending them. CI's deploy job keeps the same walk and drift check | Delete the workflow; update `tests/unit/drift-token.test.ts` |
| 8 | Vercel's CDN | Cloudflare caches `/_next/static/*` only — **never a page, never `/sw.js`**, for the reason `lib/pwa/cache-rule.ts` gives | Cloudflare cache rules |
| 9 | Vercel looks after the machine | Ours: a non-root app user, SSH keys only (no passwords), firewall open on 22/80/443 only, automatic security updates, fail2ban | A server-setup section in this file |
| 10 | Rate limits and the triage cache live per Vercel instance | One process means one shared counter — **better than today**. Do not switch on cluster mode (`pm2 -i`) without moving them to a shared store first | — |
| 11 | No fixed address, so SMS IP whitelisting was a problem | **A static IP: register it with the SMS provider's whitelist**, so a stolen token is useless from anywhere else | Provider dashboard |
| 12 | Build stamp from `VERCEL_GIT_COMMIT_SHA` | Already falls back to `git rev-parse HEAD`; CI passes the commit when it builds | — |

---

## Docker on a shared host

A container is a wall between projects only if nothing props a door open in it.
These are the doors:

- **Our container runs as a non-root user**, and is never started with
  `--privileged`.
- **No container on the host gets `/var/run/docker.sock`.** Whoever can reach
  that socket controls every container and the host itself — including ours,
  from inside somebody else's.
- **Our secrets live in one env file on the host**, readable only by root,
  passed in with `env_file`. Never baked into the image: the image sits in a
  registry, and anything in it is readable by anyone who can pull it.
- **Our own Docker network.** No volume shared with another project, and the
  container publishes no port to the internet — only the reverse proxy reaches it.
- **The host is the one shared thing, so the host is hardened:** SSH keys only,
  root and password login off, firewall, automatic security updates.
- **Only Cloudflare may reach the server on 80 and 443.** The IP is already
  known, so without this anybody can skip Cloudflare's protection by connecting
  to the address directly. Cloudflare's SSL mode is *Full (strict)*, with a
  Cloudflare origin certificate on the server.
- **Old images are pruned**, keeping the last few for rollback. Disk is shared
  and already three-quarters full.

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

- **The VPS's location** — the one detail the overview page does not show.
- **Which reverse proxy already runs on the host** (Nginx, Traefik, Caddy,
  Nginx Proxy Manager…), so our container plugs into it rather than a second one
  fighting it for ports 80 and 443.
- **The domain.** **Never a password or a key** in the chat.
- **Deploy access**: an SSH key pair made for deploys only — the public half
  added on the server, the private half saved as a GitHub Actions secret. Exact
  steps follow once the server exists.
