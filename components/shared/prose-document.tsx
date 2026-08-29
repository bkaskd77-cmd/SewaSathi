import { getTranslations } from "next-intl/server";
import { AlertTriangle } from "lucide-react";

import type { ProseDocument } from "@/lib/content/types";

/**
 * Renders a long-form document.
 *
 * One place decides the measure, the rhythm and the heading scale, so a new
 * legal or help page is a content file rather than a layout decision. Sections
 * carry ids, so a support reply can link somebody to the exact clause.
 *
 * Entrance is the same staggered rise as everything else, capped so a
 * twelve-section document does not take a second and a half to finish
 * arriving.
 */
export async function ProseDocumentView({ doc }: { doc: ProseDocument }) {
  const t = await getTranslations("legal");

  return (
    <article className="mx-auto w-full max-w-2xl">
      <header className="animate-rise">
        <h1 className="text-balance font-display text-display-md">
          {doc.title}
        </h1>
        <p className="mt-3 text-pretty text-body-md text-muted-foreground">
          {doc.lead}
        </p>
        <p className="mt-2 text-caption text-muted-foreground">
          {t("lastUpdated", { date: doc.updated })}
        </p>
      </header>

      {doc.draft ? (
        // Visible to the reader, not just to the repository. Somebody is being
        // asked to agree to this at sign-in; they are the person who needs to
        // know it has not been through a lawyer yet.
        <aside
          role="note"
          className="animate-rise mt-6 flex gap-3 rounded-lg border border-warning/30 bg-warning/[0.07] p-4"
          style={{ animationDelay: "60ms" }}
        >
          <AlertTriangle
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-warning-ink"
          />
          <div>
            <p className="text-body-sm font-semibold text-warning-ink">
              {t("draftTitle")}
            </p>
            <p className="mt-1 text-pretty text-body-sm text-muted-foreground">
              {t("draftBody")}
            </p>
          </div>
        </aside>
      ) : null}

      {/* Numbered so support can say "clause 4" and mean something. */}
      <nav
        aria-labelledby="contents-heading"
        className="animate-rise mt-8 rounded-lg border border-border bg-muted/40 p-4"
        style={{ animationDelay: "100ms" }}
      >
        <h2
          id="contents-heading"
          className="text-overline uppercase text-muted-foreground"
        >
          {t("contents")}
        </h2>
        <ol className="mt-2 flex flex-col gap-1.5">
          {doc.sections.map((section, index) => (
            <li key={section.id} className="text-body-sm">
              <a
                href={`#${section.id}`}
                className="rounded-sm text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className="tabular-nums">{index + 1}.</span>{" "}
                {section.heading}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 flex flex-col gap-10">
        {doc.sections.map((section, index) => (
          <section
            key={section.id}
            id={section.id}
            className="animate-rise scroll-mt-24"
            style={{ animationDelay: `${Math.min(0.14 + index * 0.03, 0.3)}s` }}
          >
            <h2 className="font-display text-display-sm">
              <span className="mr-2 tabular-nums text-muted-foreground">
                {index + 1}.
              </span>
              {section.heading}
            </h2>

            <div className="mt-3 flex flex-col gap-3">
              {section.blocks.map((block, i) => {
                if ("p" in block) {
                  return (
                    <p
                      key={i}
                      className="text-pretty text-body-md leading-relaxed text-muted-foreground"
                    >
                      {block.p}
                    </p>
                  );
                }

                if ("ul" in block) {
                  return (
                    <ul
                      key={i}
                      className="flex list-disc flex-col gap-2 text-pretty pl-5 text-body-md leading-relaxed text-muted-foreground"
                    >
                      {block.ul.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  );
                }

                return (
                  <dl key={i} className="flex flex-col gap-3">
                    {block.dl.map((row, j) => (
                      <div
                        key={j}
                        className="rounded-lg border border-border p-3"
                      >
                        <dt className="text-body-sm font-semibold">
                          {row.term}
                        </dt>
                        <dd className="mt-1 text-pretty text-body-sm leading-relaxed text-muted-foreground">
                          {row.detail}
                        </dd>
                      </div>
                    ))}
                  </dl>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
