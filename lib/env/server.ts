import "server-only";

import { required } from "./index";

/**
 * The secrets. Never a browser's business, and now unable to become one.
 *
 * `server-only` IS THE ENFORCEMENT, not a comment asking nicely. The package
 * resolves to a module that throws in a client build, so a Client Component
 * that reaches this — directly or three imports away, which is how it happens
 * in practice — fails `next build` and names the file that pulled it in.
 * Before the split these lived beside `publicEnv` in a module the browser
 * Supabase client imports, and the only thing keeping the service role key out
 * of the bundle was Next tree-shaking an unused export.
 *
 * THE SERVICE ROLE KEY BYPASSES EVERY RLS POLICY IN THIS DATABASE. It is the
 * single worst thing this repository could leak, and it would leak quietly:
 * the build succeeds, the page renders, and the key sits in a JavaScript file
 * anybody can fetch.
 *
 * Still lazy, for the same reason as `publicEnv`: reading a missing variable
 * throws at the call site, so a fresh clone with no `.env.local` builds and
 * runs, and only the feature that genuinely needs a key fails — naming it.
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
