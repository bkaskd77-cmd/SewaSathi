import { execSync } from "node:child_process";

import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Stamp the build so a served page can say which commit produced it.
 *
 * Vercel hands us the SHA directly. Off Vercel we ask git, and a checkout that
 * has no git (a tarball, a Docker build) simply says "unknown" rather than
 * failing the build — a missing stamp is a weaker check, not a broken product.
 */
function buildCommit() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    BUILD_COMMIT: buildCommit(),
    BUILD_TIME: new Date().toISOString(),
  },
};

export default withNextIntl(nextConfig);
