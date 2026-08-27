# Sewa[X] — working notes

AI-native home services platform for Nepal. Next.js 14 (App Router) · Tailwind ·
shadcn-style primitives · Supabase · Claude · Vercel.

## Working agreement

- **One phase at a time.** At the end of each phase, hand over a concise
  summary: what was built, what was decided, what is verified, what is next.
- **Deploy by pushing.** The branch is the Vercel production branch — a push
  deploys. Never ask the user to click Redeploy.
- **Automate everything reachable.** Only ask the user for things that need
  their account or a credential, and then ask for one thing at a time.
- **Be brief.** Short answers, copy-pasteable steps, no walls of text.

## Design tokens — the one rule

`styles/globals.css` is the single source of truth. Nothing hardcodes a colour.

Brand (fixed): Deep Emerald `#0F6B5B` · Warm Gold `#D6A84B` · Ivory `#FFF8E7` ·
Deep Slate `#24323A`.

A light hue can be a **fill** or it can be **text**, not both. Gold, warning,
info, success and destructive each have a `--*-ink` token for anything
text-sized. Never use `text-gold` — it is 2.07:1 on ivory. Use `text-gold-ink`.

Every new component gets a contrast pass in both themes before it ships;
4.5:1 minimum.

## Gotchas

- `cn()` extends tailwind-merge with our custom type scale. Any new step added
  to `fontSize` in `tailwind.config.ts` must also be listed in `lib/utils/cn.ts`,
  or tailwind-merge mistakes it for a colour and silently drops real colours.
- The shadcn registry and `*.vercel.app` are unreachable from the sandbox.
  Write primitives by hand against the shadcn contract; trust the user's word
  on whether the deploy is up.
