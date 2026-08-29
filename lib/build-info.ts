/**
 * Which commit is actually serving.
 *
 * "Pushed" and "deployed" diverged silently once: four commits sat on the
 * branch while production kept serving an older build, and the only way anyone
 * noticed was by reading the HTML by hand. A page that cannot say which build
 * produced it cannot be checked, so every page now says.
 *
 * The values are inlined by `next.config.mjs` at build time — deliberately not
 * read here at request time, because the point is to identify the *build*, not
 * the moment someone asked for the page.
 */

/** Full commit SHA, or "unknown" outside a git checkout and off Vercel. */
export const BUILD_COMMIT = process.env.BUILD_COMMIT || "unknown";

/** ISO timestamp of the build. */
export const BUILD_TIME = process.env.BUILD_TIME || "unknown";

/** The short form people actually quote. */
export const BUILD_COMMIT_SHORT =
  BUILD_COMMIT === "unknown" ? "unknown" : BUILD_COMMIT.slice(0, 7);
