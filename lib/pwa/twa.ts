/**
 * Packaging this site as an Android app, and the one file that makes it one.
 *
 * A TRUSTED WEB ACTIVITY IS NOT A WRAPPER AROUND A WEBVIEW. It is the user's
 * own Chrome, full screen, with the address bar removed — same engine, same
 * service worker, same storage, same sign-in. That is why it is the right
 * packaging for this product and why `docs/TWA.md` recommends it over a
 * rewrite: there is no second codebase, no second release cycle, and a fix
 * deployed to the website is live in the app without a store review.
 *
 * THE CHROME IS REMOVED ONLY IF THE SITE VOUCHES FOR THE APP, through
 * `/.well-known/assetlinks.json`. Both halves of that proof — the package name
 * and the signing fingerprint — belong to a keystore that does not exist yet
 * and must never live in this repository, so they are environment variables
 * and this module is the rule for reading them.
 *
 * PURE AND DEPENDENCY-FREE so the shape of the file is testable without a
 * deployment, which matters more than usual here: the failure mode is an
 * address bar appearing on somebody else's phone, reported weeks later, with
 * nothing in any log we read.
 */

/** What we need before we can vouch for an app. */
export type AssetLinksStatus = {
  ok: boolean;
  packageName: string | null;
  fingerprint: string | null;
};

/**
 * A SHA-256 certificate fingerprint as Android writes it: 32 bytes, uppercase
 * hex, colon-separated.
 *
 * SHAPE-CHECKED RATHER THAN TRUSTED, because every way of getting this wrong
 * produces a file that serves perfectly and verifies against nothing. The
 * common ones are pasting the SHA-1 line from the same `keytool` output (20
 * bytes), or pasting it without colons from a different tool.
 */
const FINGERPRINT = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** An Android package name: at least two dot-separated segments. */
const PACKAGE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i;

/**
 * Is there a real pair to vouch with?
 *
 * BOTH HALVES OR NEITHER. One without the other produces a file Android reads
 * and rejects, which is indistinguishable from not publishing one at all except
 * that it looks configured — the `pushKeyStatus` shape, one feature over.
 */
export function assetLinksReadiness(env: {
  packageName?: string;
  fingerprint?: string;
}): AssetLinksStatus {
  const packageName = env.packageName?.trim() || null;
  const fingerprint = env.fingerprint?.trim().toUpperCase() || null;

  const ok =
    packageName !== null &&
    fingerprint !== null &&
    PACKAGE.test(packageName) &&
    FINGERPRINT.test(fingerprint);

  return { ok, packageName, fingerprint };
}

/** One sentence somebody can act on. Never prints the fingerprint. */
export function assetLinksDetail(status: AssetLinksStatus): string {
  if (status.ok) {
    return `Vouching for ${status.packageName}. A Play Store build will open without an address bar.`;
  }
  if (!status.packageName && !status.fingerprint) {
    return "No Android app is published. ANDROID_PACKAGE_NAME and ANDROID_CERT_FINGERPRINT are unset; /.well-known/assetlinks.json answers 404, which is correct until there is an app.";
  }
  if (!status.packageName) {
    return "ANDROID_CERT_FINGERPRINT is set but ANDROID_PACKAGE_NAME is not. Nothing is vouched for.";
  }
  if (!status.fingerprint) {
    return "ANDROID_PACKAGE_NAME is set but ANDROID_CERT_FINGERPRINT is not. Nothing is vouched for.";
  }
  /*
   * THE EXPENSIVE CASE. Both are set and one is malformed, so the file serves
   * and verifies against nothing — the app installs, opens the site, and wears
   * an address bar that reads as a packaging bug. The usual cause is the SHA-1
   * line from the same `keytool` output.
   */
  return "ANDROID_PACKAGE_NAME or ANDROID_CERT_FINGERPRINT is malformed. A fingerprint is SHA-256: 32 colon-separated hex pairs, not the SHA-1 line above it.";
}

/** The statement Android reads. One app, two permissions, as the spec defines them. */
export function androidAppLink(status: AssetLinksStatus): {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
} {
  return {
    /*
     * BOTH RELATIONS, AND THE SECOND IS THE ONE THAT MATTERS HERE.
     * `handle_all_urls` is what lets the app open our links; `delegate_permission/common.get_login_creds`
     * is deliberately NOT granted — it would let the app read saved passwords
     * for this origin, and this product has no password on any account.
     */
    relation: [
      "delegate_permission/common.handle_all_urls",
    ],
    target: {
      namespace: "android_app",
      package_name: status.packageName ?? "",
      sha256_cert_fingerprints: status.fingerprint ? [status.fingerprint] : [],
    },
  };
}
