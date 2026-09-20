/**
 * Environment access for SajiloKaam.
 *
 * Deliberately lazy: reading a missing variable throws at the call site, not at
 * import time. That keeps `next build` green on a fresh clone with no
 * `.env.local` — the app only fails when a feature genuinely needs a key that
 * isn't there, with a message naming the variable.
 *
 * NEXT_PUBLIC_* values are inlined by Next at build time, so they must be
 * referenced as full literal `process.env.NEXT_PUBLIC_X` expressions rather
 * than looked up dynamically.
 *
 * NOTHING SECRET IS NAMED IN THIS FILE, and that is the point of the split.
 *
 * It used to export `serverEnv` — holding `SUPABASE_SERVICE_ROLE_KEY`, which
 * bypasses every RLS policy in the database — from the same module that
 * `lib/supabase/client.ts` imports to build the BROWSER client. It never
 * reached a bundle, but only because the key was read inside a getter body and
 * Next dropped the unused export while tree-shaking. That is an accident of
 * how the file happened to be written, not a rule: a top-level `const`, a
 * barrel re-export, or one helper touching both halves would have inlined the
 * key into a file every visitor downloads, and the build would have stayed
 * green.
 *
 * So the secrets live in `./server`, which declares `server-only` — a Client
 * Component that reaches them now fails the build and names the file. The
 * source pass in `scripts/check-secrets.mjs` is the other half: it fails if
 * any module reads a secret name without that declaration, which is the rule
 * this file itself once broke.
 */

export function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.local.example to .env.local and fill it in (and add it in Vercel → Settings → Environment Variables for deployments).`,
    );
  }
  return value;
}

/** Public Supabase config — safe to expose to the browser. */
export const publicEnv = {
  get supabaseUrl() {
    return required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  },
};

/** True when both public Supabase vars are present — used for graceful UI. */
export function hasSupabaseConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
