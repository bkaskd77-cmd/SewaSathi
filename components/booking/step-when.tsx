"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { CalendarClock, Clock, Zap } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  bookableDays,
  slotLabel,
  slotsForDay,
  type Slot,
} from "@/lib/booking/schedule";
import type { Timing } from "@/lib/booking/flow-state";
import { cn } from "@/lib/utils";

const CHOICES: Array<{ value: Timing; icon: typeof Zap }> = [
  { value: "emergency", icon: Zap },
  { value: "today", icon: Clock },
  { value: "scheduled", icon: CalendarClock },
];

/**
 * Step c — when.
 *
 * The slot list is generated from the same function the server validates
 * against, so a customer cannot be offered a time that is then refused. Slots
 * in the past and outside working hours never appear; a day with nothing left
 * says so rather than showing an empty box.
 *
 * The date list is built on the client from the current time, which means it
 * is correct for somebody who left the tab open overnight — a server-rendered
 * list would still be offering yesterday.
 */
export function StepWhen({
  timing,
  day,
  slot,
  fromTriage,
  error,
  onChange,
}: {
  timing: Timing;
  day: string;
  slot: string;
  /** True when triage sent them here with an emergency. */
  fromTriage: boolean;
  error?: string | null;
  onChange: (patch: { timing?: Timing; day?: string; slot?: string }) => void;
}) {
  const t = useTranslations("booking.flow.when");
  const tErr = useTranslations("booking.flow.errors");

  // Recomputed on mount rather than at render time on the server, so a tab
  // left open does not keep offering a window that has passed.
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const days = React.useMemo(
    () => (now ? bookableDays(now) : []),
    [now],
  );
  const activeDay = day || days[0]?.value || "";
  const slots: Slot[] = React.useMemo(
    () => (now && activeDay ? slotsForDay(activeDay, now) : []),
    [now, activeDay],
  );

  return (
    <div className="flex flex-col gap-5">
      {fromTriage && timing === "emergency" ? (
        <p className="animate-pop-in rounded-lg border border-warning/30 bg-warning/10 p-3 text-body-sm text-warning-ink">
          {t("preselectedNote")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {CHOICES.map((choice) => {
          const active = timing === choice.value;
          const Icon = choice.icon;
          return (
            <button
              key={choice.value}
              type="button"
              onClick={() => onChange({ timing: choice.value })}
              aria-pressed={active}
              className={cn(
                "flex items-start gap-3 rounded-xl border p-4 text-left transition-all duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "border-primary bg-primary/[0.06]"
                  : "border-border hover:border-primary/40 hover:bg-muted/40",
              )}
            >
              <Icon
                aria-hidden="true"
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-body-md font-semibold">
                    {t(`options.${choice.value}.title`)}
                  </span>
                  {choice.value === "emergency" ? (
                    <Badge variant="urgent">{t("options.emergency.tag")}</Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-body-sm text-muted-foreground">
                  {t(`options.${choice.value}.body`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {timing === "scheduled" ? (
        <div className="step-forward flex flex-col gap-4">
          <div>
            <Label htmlFor="day">{t("dayLabel")}</Label>
            <select
              id="day"
              value={activeDay}
              onChange={(event) =>
                onChange({ day: event.target.value, slot: "" })
              }
              className="mt-2 h-12 w-full rounded-lg border border-input bg-card px-3 text-body-md transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {days.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.offset === 0
                    ? t("today")
                    : option.offset === 1
                      ? t("tomorrow")
                      : option.value}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-body-sm font-semibold">{t("slotLabel")}</p>
            {now === null ? (
              // Pre-hydration: the day list depends on the current time, which
              // the server does not know for this reader.
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="animate-skeleton h-11 rounded-lg bg-muted"
                  />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <p className="mt-2 text-body-sm text-muted-foreground">
                {t("noSlots")}
              </p>
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {slots.map((option) => {
                  const active = slot === option.start;
                  return (
                    <button
                      key={option.start}
                      type="button"
                      onClick={() => onChange({ slot: option.start })}
                      aria-pressed={active}
                      className={cn(
                        "h-11 rounded-lg border text-body-sm tabular-nums transition-all duration-200 active:scale-[0.98]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                        active
                          ? "border-primary bg-primary/[0.08] font-semibold text-primary"
                          : "border-border hover:border-primary/40 hover:bg-muted/40",
                      )}
                    >
                      {slotLabel(option)}
                    </button>
                  );
                })}
              </div>
            )}
            <FieldError
              id="slot-error"
              lines={1}
              message={error ? tErr(error) : null}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
