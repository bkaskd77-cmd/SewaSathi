"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { BadgeCheck, Check, Sparkles, Star } from "lucide-react";

import type { ShortlistEntry } from "@/app/[locale]/(app)/book/actions";
import { Badge } from "@/components/ui/badge";
import {
  canServeAt,
  hasRating,
  hasResponse,
  quoteFloor,
  type Availability,
} from "@/lib/provider";
import { cn, formatNpr } from "@/lib/utils";

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
  onChosenEntry,
  when = null,
  band,
}: {
  category: string;
  area: string | null;
  urgency: string | null;
  providerId: string | null;
  autoAssign: boolean;
  /** The professional who came in on the URL, if any. */
  preselected: ShortlistEntry | null;
  onChoose: (next: { providerId: string | null; autoAssign: boolean }) => void;
  /**
   * The chosen entry, lifted so the review screen can say whether they can
   * actually come. Held by the flow outside the saved draft — it is derivable
   * and the draft is sessionStorage, same reasoning as the photo preview.
   */
  onChosenEntry?: (entry: ShortlistEntry | null) => void;
  /** The slot the customer picked, or null for as soon as possible. */
  when?: string | null;
  /** The published band of the category being booked. */
  band: { low: number; high: number } | null;
}) {
  const t = useTranslations("booking.flow.provider");
  const tc = useTranslations("common");
  const locale = useLocale() as "en" | "ne";
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

  /*
   * Hand the chosen entry up so the review screen can judge it. Done here
   * rather than re-fetched there because this component already has the list,
   * and a second fetch could disagree with the first.
   */
  React.useEffect(() => {
    if (!onChosenEntry) return;
    if (autoAssign || !providerId) {
      onChosenEntry(null);
      return;
    }
    // Nothing is reported while the list is still in flight: clearing it would
    // make the review screen say "we can assign somebody" for a moment about a
    // professional the customer definitely picked.
    if (!entries) return;
    onChosenEntry(entries.find((p) => p.id === providerId) ?? null);
  }, [onChosenEntry, entries, providerId, autoAssign]);

  /** What each option can do about the time the customer asked for. */
  const verdictFor = (provider: ShortlistEntry) =>
    canServeAt({
      state: provider.availability as Availability,
      busyUntil: provider.busyUntil,
      when,
    });

  /*
   * ON AN EMERGENCY THE TWO GROUPS ARE SEPARATED, and only here.
   *
   * Somebody who picked emergency needs a person now, so ranking a professional
   * who is demonstrably in another house above one who is free would be the
   * list actively misleading them — and `EMERGENCY_WEIGHTS` puts 0.40 on
   * availability precisely because that is the term that matters at 2am.
   *
   * The unavailable ones are shown rather than hidden: a customer who came from
   * Krishna's profile and cannot find Krishna in the list assumes the product
   * is broken. They are shown, marked, and not selectable — which is the
   * honest version of what tapping them would have led to.
   *
   * For every other urgency nothing is reordered. "On a job at 11am" says
   * nothing about a Thursday slot, and demoting the busiest people for it would
   * take work from exactly the professionals the platform runs on.
   */
  const emergency = urgency === "emergency";
  const groups = React.useMemo(() => {
    if (!entries) return null;
    if (!emergency) return [{ free: true, entries }];
    const free = entries.filter((p) => verdictFor(p).ok);
    const engaged = entries.filter((p) => !verdictFor(p).ok);
    return [
      ...(free.length > 0 ? [{ free: true, entries: free }] : []),
      ...(engaged.length > 0 ? [{ free: false, entries: engaged }] : []),
    ];
    // verdictFor is derived from `when`, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, emergency, when]);

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
        <div className="flex flex-col gap-4">
          {groups?.map((group) => (
            <div key={group.free ? "free" : "engaged"}>
              {/* Only ever two groups, and only on an emergency — so the
                  heading appears exactly when it is carrying information. */}
              {!group.free ? (
                <p className="mb-2 text-caption font-semibold uppercase text-muted-foreground">
                  {t("cannotComeNow")}
                </p>
              ) : null}

              <div className="assemble flex flex-col gap-2">
                {group.entries.map((provider, i) => {
                  const active = !autoAssign && providerId === provider.id;
                  const verdict = verdictFor(provider);
                  // An emergency is the only case where a refusal stops the
                  // choice. Everywhere else it is a note, and the review
                  // screen makes the promise about what happens next.
                  const barred = emergency && !verdict.ok;

                  return (
                    <button
                      key={provider.id}
                      type="button"
                      disabled={barred}
                      onClick={() =>
                        onChoose({ providerId: provider.id, autoAssign: false })
                      }
                      aria-pressed={active}
                      style={{ ["--i" as string]: i }}
                      className={cn(
                        "flex items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        barred
                          ? "cursor-not-allowed border-border opacity-60"
                          : active
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
                          {/*
                              EVERY STATE, NOT ONLY `now`. This used to render
                              a badge for a free professional and nothing at
                              all for anybody else, so somebody on a job looked
                              identical to somebody free by appointment — on
                              the one screen where the customer chooses.
                           */}
                          <Badge
                            variant={
                              provider.availability === "now"
                                ? "gold-subtle"
                                : provider.availability === "on_job"
                                  ? "info"
                                  : "muted"
                            }
                          >
                            {t(`availability.${provider.availability}`)}
                          </Badge>
                        </span>

                        {/* Defaults are not printed as facts here either —
                            the same rule the catalogue card follows, asked of
                            the same function. */}
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                          {hasRating(provider) ? (
                            <span className="inline-flex items-center gap-1 tabular-nums">
                              <Star
                                aria-hidden="true"
                                className="size-3 fill-gold text-gold"
                              />
                              {provider.ratingAvg.toFixed(1)} (
                              {provider.ratingCount})
                            </span>
                          ) : (
                            <span>{t("notRated")}</span>
                          )}
                          <span className="tabular-nums">
                            {t("jobs", { n: String(provider.jobsCompleted) })}
                          </span>
                          {hasResponse(provider) ? (
                            <span className="tabular-nums">
                              {t("respondsIn", {
                                n: String(provider.avgResponseMinutes),
                              })}
                            </span>
                          ) : null}
                        </span>
                      </span>

                      {/*
                          THE PRICE ON THE ROW. This screen had no price on it
                          at all: the customer chose a professional blind and
                          met a range on the next page. The figure shown is the
                          one that becomes the floor of their quote — the same
                          `quoteFloor` the server writes — so the review screen
                          repeats it rather than introducing it.
                       */}
                      <span className="shrink-0 text-right">
                        <span className="block text-body-sm font-semibold tabular-nums">
                          {formatNpr(
                            band
                              ? quoteFloor({
                                  providerRate: provider.baseRate,
                                  band,
                                })
                              : provider.baseRate,
                            { locale },
                          )}
                        </span>
                        <span className="text-caption block text-muted-foreground">
                          {tc("from")}
                        </span>
                      </span>

                      {active && !barred ? (
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 size-4 shrink-0 text-primary"
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
