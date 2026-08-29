import { notFound } from "next/navigation";

/**
 * Everything that matched no route, sent to the localised 404.
 *
 * Without this, an unknown path falls out of the `[locale]` segment entirely
 * and Next serves its own built-in 404 — a bare white page with no header, no
 * footer, and English text in front of a Nepali reader. The middleware has
 * already rewritten `/nope` to `/en/nope` by the time it gets here, so this
 * catch-all is what puts it back inside the locale tree.
 *
 * It only ever renders `notFound()`, which means `app/[locale]/not-found.tsx`.
 */
export default function CatchAllPage() {
  notFound();
}
