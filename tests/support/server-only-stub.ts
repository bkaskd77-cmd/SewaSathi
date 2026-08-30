/**
 * `server-only` throws by design when imported outside a Server Component.
 *
 * Vitest is neither, so importing anything that guards itself with it — the
 * price bands, the data layer — fails at load. Aliased to this empty module in
 * vitest.config.ts.
 *
 * This weakens nothing: the guard exists to stop server code reaching a
 * browser bundle, and the bundler still enforces that. It has no job in a test
 * process, where there is no client to leak into.
 */
export {};
