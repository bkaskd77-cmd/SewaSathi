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
    /*
     * ONE WORKER: the db suite owns a single Postgres cluster and parallel
     * files would race on the same tables.
     *
     * THIS WAS `pool: "forks"` PLUS `poolOptions.forks.singleFork`, AND VITEST 4
     * REMOVED `poolOptions`. `npm run typecheck` is what caught it — the option
     * is simply not in the config type any more, so vitest would have accepted
     * the object and ignored the key, and the db suite would have gone parallel
     * against one cluster with nothing saying so. A unit-only run stays green
     * through that, which is why the whole gate is the gate.
     *
     * `fileParallelism: false` is the replacement and says the thing directly:
     * all test files run sequentially. `pool: "forks"` is kept because process
     * isolation is still what keeps one suite's module state out of another's.
     */
    pool: "forks",
    fileParallelism: false,
  },
});
