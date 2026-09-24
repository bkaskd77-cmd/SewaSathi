import { getTranslations } from "next-intl/server";

import type { QueuePage } from "@/lib/data/queue";

/**
 * The line that says whether you are looking at all of it.
 *
 * WHAT IT REPLACES IS SILENCE. Every admin queue is capped and every one of
 * them used to stop at the cap and render nothing about it. A drained list and
 * a truncated one looked identical, and they call for opposite responses: one
 * means the work is done, the other means somebody has been waiting since
 * before the cut and nobody can see them.
 *
 * THREE STATES, AND THE THIRD IS THE ONE THAT MATTERS. A count that failed is
 * null, and null prints "we could not count these" rather than falling back to
 * a number. An admin screen that says "0 waiting" because a query broke is the
 * most expensive sentence in the product — it is the one that tells somebody
 * to stop looking.
 *
 * NOT A WARNING COLOUR. Being over the cap is ordinary and expected on a busy
 * week; it is information, not an alarm. Only the unreadable case is tinted,
 * because that one is genuinely wrong.
 *
 * A Server Component with no client JavaScript, like the pages it sits on.
 * Numbers are interpolated as strings — `ne` renders them in Devanagari and a
 * bare numeric would come out in Latin digits beside them.
 */
export async function QueueExtent<T>({ page }: { page: QueuePage<T> }) {
  const t = await getTranslations("admin.extent");

  if (page.total === null) {
    return (
      <p className="animate-rise mt-2 text-body-sm text-warning-ink">
        {t("unknown")}
      </p>
    );
  }

  // Nothing waiting: the page's own empty state is already saying so, and a
  // second sentence under it would be two ways of saying none.
  if (page.total === 0) return null;

  const capped = page.total > page.cap;

  return (
    <p className="animate-rise mt-2 text-body-sm text-muted-foreground">
      {capped
        ? t("showing", {
            shown: String(page.rows.length),
            total: String(page.total),
            cap: String(page.cap),
          })
        : t("all", { total: String(page.total) })}
    </p>
  );
}
