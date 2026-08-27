# SajiloKaam

AI-native home services platform for Nepal — plumbing, electrical, cleaning,
appliance repair, carpentry, pest control and similar household work.

**Status: Phase 2 — landing page live.** Foundation, design system and the public
marketing homepage are built. `/design-system` holds the internal component
reference. Auth, AI triage and booking are still ahead.

---

## Stack

| Concern    | Choice                                                       |
| ---------- | ------------------------------------------------------------ |
| Framework  | Next.js 14 (App Router) + TypeScript                         |
| Styling    | Tailwind CSS 3 + CSS-variable design tokens                  |
| Components | shadcn/ui (CLI configured, primitives added in Phase 1)      |
| Motion     | Framer Motion                                                |
| Backend    | Supabase — Postgres, Auth, Storage, Realtime                 |
| AI         | Anthropic Claude (`@anthropic-ai/sdk`) — triage from Phase 4 |
| Theming    | next-themes (light / dark / system)                          |
| Hosting    | Vercel                                                       |

---

## What you need to do

Three things need your accounts. Everything else is already committed.

### 1. Create the Supabase project

1. Go to **https://supabase.com/dashboard** and sign in (GitHub sign-in is fine).
2. Click **New project**.
   - **Name:** `sewax-dev`
   - **Database password:** generate a strong one and save it in your password
     manager — you cannot see it again, and you'll need it for direct Postgres
     access later.
   - **Region:** `Southeast Asia (Singapore)` — the closest region to Nepal, so
     it gives the lowest latency for real users.
   - **Plan:** Free.
3. Wait ~2 minutes for provisioning.
4. Open **Project Settings → API**. You need two values from that page:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role / secret** key (click to reveal) → `SUPABASE_SERVICE_ROLE_KEY`

> The `service_role` key bypasses row level security. Keep it out of the browser
> and out of git.

You also need an Anthropic key for Phase 4 — get one at
**https://console.anthropic.com → API keys**. Wiring it now means Phase 4 starts
with nothing to configure.

### 2. Push to GitHub

The repository already exists at `bkaskd77-cmd/SewaSathi` and this branch is
pushed. To run it locally:

```bash
git clone https://github.com/bkaskd77-cmd/SewaSathi.git
cd SewaSathi
npm install
cp .env.local.example .env.local   # then paste your keys in
npm run dev                        # http://localhost:3000
```

### 3. Connect Vercel

1. Go to **https://vercel.com/new** and sign in with GitHub.
2. **Import** the `SewaSathi` repository. (If it isn't listed, click _Adjust
   GitHub App Permissions_ and grant access to it.)
3. Vercel detects Next.js — leave the build settings on their defaults.
4. Before clicking Deploy, expand **Environment Variables** and add all four.
   Paste each name and value, and tick **Production**, **Preview** and
   **Development** for each:

   | Name                            | Value                     | Exposed to browser |
   | ------------------------------- | ------------------------- | ------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`      | Supabase Project URL      | yes (by design)    |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key         | yes (by design)    |
   | `SUPABASE_SERVICE_ROLE_KEY`     | Supabase service_role key | **no**             |
   | `ANTHROPIC_API_KEY`             | Anthropic API key         | **no**             |

5. Click **Deploy**. First build takes about a minute.
6. Open the URL Vercel gives you. The homepage should show both "Service
   wiring" rows as **connected**. If either still says _awaiting keys_, the
   variable is missing or misspelled — fix it under **Settings → Environment
   Variables**, then **Deployments → ⋯ → Redeploy**.

Every push to this branch now deploys a preview automatically; merges to the
default branch deploy to production.

---

## Design tokens

`styles/globals.css` holds every colour, radius and shadow as a CSS variable;
`tailwind.config.ts` maps them onto Tailwind's scale. Nothing in the app
hardcodes a colour — change a variable and the whole product restyles, in both
themes.

The placeholder palette is **Deep Jade** (primary — trust, verification) with a
**Sindoor crimson** accent drawn from Nepal's flag, on neutrals carrying a faint
green cast so greys sit with the primary rather than fighting it. Deliberately
not the blue/orange every on-demand services app uses. We refine this together
in Phase 1.

Tokens `--background` through `--ring` follow the shadcn/ui contract, so
components added later inherit the theme with no edits:

```bash
npx shadcn@latest add button card badge
```

> Note the shadcn convention: `--accent` is the subtle hover/active surface, not
> the brand accent. The brand accent is `--sindoor`.

Type: **Sora** for display, **Plus Jakarta Sans** for body, **Noto Sans
Devanagari** for Nepali. Any element marked `lang="ne"` picks up the Devanagari
face automatically.

---

## Layout

```
app/                  routes (App Router)
components/ui/        shadcn primitives — Phase 1 populates this
components/shared/    cross-feature composed components
lib/supabase/         browser, server, admin clients + middleware helper
lib/ai/               Claude helpers — Phase 4
lib/utils/            general utilities (cn, currency formatting)
lib/env.ts            lazy, validated environment access
types/                shared TypeScript types + generated DB types
styles/               global CSS and design tokens
```

## Scripts

```bash
npm run dev           # dev server
npm run build         # production build
npm run lint          # ESLint
npm run typecheck     # tsc --noEmit
npm run format        # Prettier (with Tailwind class sorting)
npm run ui:add -- button   # add a shadcn primitive
```

## Roadmap

Phase 0 foundation ✅ · 1 design system ✅ · 2 landing page ✅ · 3 phone + OTP auth ·
4 AI problem triage · 5 categories & provider discovery · 6 booking flow ·
7 payments (eSewa, Khalti, cash) · 8 live order tracking · 9 reviews & trust
score · 10 provider dashboard · 11 admin dashboard · 12 AMC subscriptions ·
13 notifications · 14 mobile app.
