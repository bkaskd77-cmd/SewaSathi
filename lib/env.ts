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
 */

function required(name: string, value: string | undefined): string {
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

/**
 * Server-only secrets. Never import this into a Client Component — the service
 * role key bypasses row level security.
 */
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get anthropicApiKey() {
    return required("ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
  },
};

/** True when both public Supabase vars are present — used for graceful UI. */
export function hasSupabaseConfig(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
