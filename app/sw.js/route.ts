import { serviceWorkerSource } from "@/lib/pwa/worker-source";

/**
 * `GET /sw.js` — the service worker script, served from the origin root so it
 * can claim the whole scope. The script itself is built by
 * `lib/pwa/worker-source.ts`; everything interesting is there and in
 * `lib/pwa/cache-rule.ts`.
 *
 * `Cache-Control: no-store` IS LOAD-BEARING AND IS THE CLASSIC WAY TO GET STUCK.
 * Browsers cap a worker script's own freshness at 24 hours, but an intermediary
 * that caches it for a day is a day in which no update can reach anybody — and
 * the whole point of versioning the cache by commit is that an update always
 * can. The browser re-fetches this URL and compares bytes; `no-store` is what
 * makes that comparison mean anything.
 *
 * `Service-Worker-Allowed: /` lets a script served from here claim the whole
 * origin. It is served from the root already, so this is belt and braces rather
 * than a widening — and it is the header to remember if the path ever moves.
 */

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(serviceWorkerSource(process.env.BUILD_COMMIT ?? "unknown"), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store, must-revalidate",
      "Service-Worker-Allowed": "/",
    },
  });
}
