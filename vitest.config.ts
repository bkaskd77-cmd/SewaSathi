import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Two projects, because they cost very different amounts to run.
 *
 * `unit` is pure logic with no I/O — it runs in under a second and is what you
 * want on every save. `db` spins up a throwaway Postgres cluster and applies
 * the real migrations, so it is slower and is kept separate rather than making
 * the fast suite feel expensive.
 *
 * Both are in `npm run verify`. The split is about feedback speed, not about
 * one of them being optional.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // See tests/support/server-only-stub.ts for why.
      "server-only": new URL(
        "./tests/support/server-only-stub.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/db/**/*.test.ts"],
    // The database suite serialises around one cluster and takes tens of
    // seconds; the default 5s would fail it for being slow rather than wrong.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // One process: the db suite owns a single cluster and parallel workers
    // would race on the same tables.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
