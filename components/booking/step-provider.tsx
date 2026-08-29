"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { BadgeCheck, Check, Sparkles, Star } from "lucide-react";

import type { ShortlistEntry } from "@/app/[locale]/(app)/book/actions";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Step d — who.
 *
 * The shortlist is fetched and ranked on the server with the same weights the
 * catalogue uses, so the order here is the order they would have seen on
 * /services. Two different answers to "who is best for this" would be a bug
 * nobody could see.
 *
 * It is inline rather than a link out to the list: sending somebody back to a
 * catalogue mid-booking loses the flow, and this is the step where a funnel
 * with four screens of input behind it can least afford to lose anyone.
 */
export function StepProvider({
  category,
  area,
  urgency,
  providerId,
  autoAssign,
  preselected,
  onChoose,
}: {
  category: string;
  area: string | null;
  urgency: string | null;
  providerId: string | null;
  autoAssign: boolean;
  /** The professional who came in on the URL, if any. */
  preselected: ShortlistEntry | null;
  onChoose: (next: { providerId: string | null; autoAssign: boolean }) => void;
}) {
  const t = useTranslations("booking.flow.provider");
  const [list, setList] = React.useState<ShortlistEntry[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setList(null);

    void (async () => {
      const { shortlistAction } = await import(
        "@/app/[locale]/(app)/book/actions"
      );
      const result = await shortlistAction({ category, area, urgency });
      if (!cancelled) setList(result);
    })();

    return () => {
      cancelled = true;
    };
  }, [category, area, urgency]);

  // The preselected professional stays at the top even if the ranking would
  // not have put them there — the customer chose them, and quietly reordering
  // that would be the product overruling them.
  const entries = React.useMemo(() => {
    if (!list) return null;
    if (!preselected) return list;
    return [preselected, ...list.filter((p) => p.id !== preselected.id)];
  }, [list, preselected]);

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => onChoose({ providerId: null, autoAssign: true })}
        aria-pressed={autoAssign}
        className={cn(
          "flex items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          autoAssign
            ? "border-primary bg-primary/[0.06]"
            : "border-border hover:border-primary/40 hover:bg-muted/40",
        )}
      >
        <Sparkles
          aria-hidden="true"
          className={cn(
            "mt-0.5 size-4 shrink-0",
            autoAssign ? "text-primary" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-body-md font-semibold">
            {t("autoTitle")}
          </span>
          <span className="mt-0.5 block text-body-sm text-muted-foreground">
            {t("autoBody")}
          </span>
        </span>
        {autoAssign ? (
          <Check aria-hidden="true" className="size-4 text-primary" />
        ) : null}
      </button>

      <p className="mt-1 text-body-sm font-semibold">{t("orChoose")}</p>

      {entries === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 rounded-xl border border-border p-4"
            >
              <div className="animate-skeleton size-11 shrink-0 rounded-full bg-muted" />
              <div className="min-w-0 flex-1">
                <div className="animate-skeleton h-4 w-32 rounded bg-muted" />
                <div className="animate-skeleton mt-2 h-3 w-44 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-border bg-muted/40 p-4 text-body-sm text-muted-foreground">
          {t("noneNearby")}
        </p>
      ) : (
        <div className="assemble flex flex-col gap-2">
          {entries.map((provider, i) => {
            const active = !autoAssign && providerId === provider.id;
            return (
              <button
                key={provider.id}
                type="button"
                onClick={() =>
                  onChoose({ providerId: provider.id, autoAssign: false })
                }
                aria-pressed={active}
                style={{ ["--i" as string]: i }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  active
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-11 shrink-0 items-center justify-center rounded-full bg-muted text-body-md font-semibold text-muted-foreground"
                >
                  {provider.displayName.slice(0, 1)}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-body-md font-semibold">
                      {provider.displayName}
                    </span>
                    {provider.isVerified ? (
                      <Badge variant="verified">
                        <BadgeCheck aria-hidden="true" className="size-3" />
                        {t("verified")}
                      </Badge>
                    ) : null}
                    {provider.availability === "now" ? (
                      <Badge variant="gold-subtle">{t("availableNow")}</Badge>
                    ) : null}
                  </span>

                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Star
                        aria-hidden="true"
                        className="size-3 fill-gold text-gold"
                      />
                      {provider.ratingAvg.toFixed(1)} ({provider.ratingCount})
                    </span>
                    <span className="tabular-nums">
                      {t("jobs", { n: String(provider.jobsCompleted) })}
                    </span>
                    <span className="tabular-nums">
                      {t("respondsIn", {
                        n: String(provider.avgResponseMinutes),
                      })}
                    </span>
                  </span>
                </span>

                {active ? (
                  <Check
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
