import { androidAppLink, assetLinksReadiness } from "@/lib/pwa/twa";

/**
 * `GET /.well-known/assetlinks.json` — what proves to Android that the Play
 * Store app and this website are the same people.
 *
 * WHAT IT DOES. A Trusted Web Activity is a Chrome tab with no browser chrome,
 * and Android will only remove that chrome if the site vouches for the app:
 * this file names the app's package and the SHA-256 fingerprint of the
 * certificate it was signed with. Android fetches it at install and again
 * later, from a client that follows no redirect and reports nothing to anybody.
 * If it is missing or wrong, the app still works and still opens the site — it
 * just opens it with an address bar across the top, which is the difference
 * between an app and a bookmark.
 *
 * A ROUTE RATHER THAN A FILE, AND THE FINGERPRINT COMES FROM THE ENVIRONMENT.
 * The fingerprint belongs to an upload key in a keystore that does not exist
 * yet and must never be in this repository. The tempting alternative is a file
 * with a placeholder in it, and that is the worst of the three options: it
 * would publish a fingerprint matching nothing, Android would fail
 * verification silently, and the symptom — an address bar — looks like a
 * packaging mistake rather than a wrong constant. So there is no file, there is
 * no placeholder, and the day the keystore exists this is one Vercel variable
 * and no deploy of new code.
 *
 * 404 WHEN IT IS UNSET, which is the honest answer: we are not vouching for any
 * app, because there is no app yet. `/api/health` reports the same fact for
 * free under `twa.assetlinks`, so "did somebody set it" never costs a Play
 * Store submission to find out.
 */

export const dynamic = "force-dynamic";

export function GET(): Response {
  const status = assetLinksReadiness({
    packageName: process.env.ANDROID_PACKAGE_NAME,
    fingerprint: process.env.ANDROID_CERT_FINGERPRINT,
  });

  if (!status.ok) {
    return new Response(JSON.stringify({ error: "not configured" }), {
      status: 404,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify([androidAppLink(status)], null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      /*
       * Android re-reads this periodically and a stale copy is a verification
       * that passes after the key has been rotated — or fails for an hour after
       * it has been fixed. An hour is short enough to recover from a mistake
       * and long enough not to be fetched on every install.
       */
      "Cache-Control": "public, max-age=3600",
    },
  });
}
