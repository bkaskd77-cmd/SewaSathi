import { describe, expect, it } from "vitest";

import {
  androidAppLink,
  assetLinksDetail,
  assetLinksReadiness,
} from "@/lib/pwa/twa";

/**
 * The file that decides whether the Android app has an address bar.
 *
 * WHY THIS IS TESTED AT ALL FOR A FILE NOBODY HAS PUBLISHED YET. Every way of
 * getting it wrong produces a file that serves perfectly and verifies against
 * nothing, and the only symptom is browser chrome across the top of the app —
 * seen on somebody else's phone, weeks after a store submission, and read as a
 * packaging mistake rather than a wrong constant. There is no log, no error and
 * no retry. A shape check now is the whole defence.
 */

const REAL = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90";

describe("whether we are vouching for an app", () => {
  it("is not, when nothing is set", () => {
    const status = assetLinksReadiness({});
    expect(status.ok).toBe(false);
    expect(assetLinksDetail(status)).toContain("No Android app is published");
    // 404 is correct until there is an app, and the sentence says so rather
    // than reading as a fault.
    expect(assetLinksDetail(status)).toContain("correct until there is an app");
  });

  it("is, when both halves are well formed", () => {
    const status = assetLinksReadiness({
      packageName: "np.com.sajilokaam.twa",
      fingerprint: REAL,
    });
    expect(status.ok).toBe(true);
    expect(assetLinksDetail(status)).toContain("np.com.sajilokaam.twa");
  });

  it("refuses a SHA-1 fingerprint, which is the paste people actually make", () => {
    /*
     * `keytool` prints SHA-1 immediately above SHA-256 in the same block, and
     * copying the wrong line is the single most common way this fails. Twenty
     * bytes instead of thirty-two.
     */
    const sha1 = "A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90:A1:B2:C3:D4";
    const status = assetLinksReadiness({
      packageName: "np.com.sajilokaam.twa",
      fingerprint: sha1,
    });
    expect(status.ok).toBe(false);
    expect(assetLinksDetail(status)).toContain("SHA-256");
    expect(assetLinksDetail(status)).toContain("not the SHA-1 line");
  });

  it("refuses a fingerprint with the colons stripped out", () => {
    const status = assetLinksReadiness({
      packageName: "np.com.sajilokaam.twa",
      fingerprint: REAL.replace(/:/g, ""),
    });
    expect(status.ok).toBe(false);
  });

  it("accepts lowercase hex and normalises it", () => {
    // Different tools print different cases; Android compares bytes.
    const status = assetLinksReadiness({
      packageName: "np.com.sajilokaam.twa",
      fingerprint: REAL.toLowerCase(),
    });
    expect(status.ok).toBe(true);
    expect(status.fingerprint).toBe(REAL);
  });

  it("refuses a package name that is not one", () => {
    for (const bad of ["sajilokaam", "", "np com sajilokaam"]) {
      expect(
        assetLinksReadiness({ packageName: bad, fingerprint: REAL }).ok,
        bad,
      ).toBe(false);
    }
  });

  it("names which half is missing, because the advice differs", () => {
    expect(
      assetLinksDetail(assetLinksReadiness({ fingerprint: REAL })),
    ).toContain("ANDROID_PACKAGE_NAME is not");
    expect(
      assetLinksDetail(assetLinksReadiness({ packageName: "np.com.sajilokaam.twa" })),
    ).toContain("ANDROID_CERT_FINGERPRINT is not");
  });

  it("never prints the fingerprint", () => {
    // It is not a secret, but a health endpoint that echoes configuration
    // values is a habit, and the next value echoed may be one that matters.
    for (const env of [
      { packageName: "np.com.sajilokaam.twa", fingerprint: REAL },
      { packageName: "np.com.sajilokaam.twa", fingerprint: "nonsense" },
      { fingerprint: REAL },
    ]) {
      expect(assetLinksDetail(assetLinksReadiness(env))).not.toContain(REAL);
    }
  });
});

describe("the statement Android reads", () => {
  const status = assetLinksReadiness({
    packageName: "np.com.sajilokaam.twa",
    fingerprint: REAL,
  });

  it("has the shape the spec defines", () => {
    const link = androidAppLink(status);
    expect(link.target.namespace).toBe("android_app");
    expect(link.target.package_name).toBe("np.com.sajilokaam.twa");
    expect(link.target.sha256_cert_fingerprints).toEqual([REAL]);
  });

  it("grants handling URLs and nothing else", () => {
    /*
     * `delegate_permission/common.get_login_creds` is the other relation an
     * assetlinks file can carry, and it is deliberately absent: it lets the app
     * read saved passwords for this origin. There is no password on any account
     * in this product — phone and OTP is the only way in — so granting it would
     * widen what an app may do for a capability nothing uses.
     */
    const link = androidAppLink(status);
    expect(link.relation).toEqual(["delegate_permission/common.handle_all_urls"]);
    expect(link.relation).not.toContain("delegate_permission/common.get_login_creds");
  });
});
