"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Briefcase, Check, Loader2, Moon, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Whether a professional can come, in three explicit controls and one the
 * system fills in.
 *
 * WHAT WAS WRONG WITH ONE SWITCH. It read "You are available now" when on and
 * "Say you are available now" when off — a statement and an instruction, and
 * neither told a tradesperson what tapping would do. A control whose current
 * state and its action are indistinguishable is a control people stop touching,
 * and the failure mode of not touching it is leaving yourself marked free while
 * you are under somebody's sink.
 *
 * NOW THE STATE IS SHOWN AND THE ACTIONS ARE SEPARATE. Whichever is true is
 * marked; the others are things you can press. Nothing changes meaning between
 * taps.
 *
 * "ON A JOB" IS NOT A BUTTON. It is written by a trigger when a booking of
 * theirs goes en route, and it overrides both of their own settings — so
 * offering it as something to press would be offering a control that does
 * nothing. It is shown as a fact, with the reason, because a professional who
 * cannot see why the other buttons are refused would think the screen was
 * broken.
 *
 * NOTHING HERE IS COUNTED AGAINST ANYBODY, and the screen no longer says so.
 * `/providers/standards` publishes "Turning work down. You are allowed to be
 * busy." under *What is never a signal*, and that is where the promise is
 * kept. Repeating it under the buttons raised the idea of a penalty that does
 * not exist, directly beneath the one we most want pressed — this control's
 * whole job is to get somebody to "Free now" when they are.
 */
export function AvailabilityControls({
  state,
  minutesLeft,
  endsToday,
}: {
  state: "now" | "on_job" | "busy" | "today" | "scheduled";
  /** On whichever stamp is currently deciding the state. */
  minutesLeft: number | null;
  /**
   * Does that stamp end today? Pressed after closing it lands tomorrow
   * evening, and the sentence used to call that "the end of today".
   */
  endsToday: boolean;
}) {
  const t = useTranslations("provider.dashboard.availability");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState<string | null>(null);

  const onJob = state === "on_job";

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      const result = await work();
      if (!result.ok) setFailed(result.error ?? "generic");
    } catch {
      setFailed("generic");
    } finally {
      setBusy(false);
    }
  }

  const setAvailable = (on: boolean) =>
    void run(async () => {
      const { setAvailabilityAction } = await import(
        "@/app/[locale]/(work)/provider/actions"
      );
      return setAvailabilityAction(on);
    });

  const setBusyWindow = (preset: string | null) =>
    void run(async () => {
      const { setBusyAction } = await import(
        "@/app/[locale]/(work)/provider/actions"
      );
      return setBusyAction(preset);
    });

  const hours = minutesLeft != null ? Math.floor(minutesLeft / 60) : 0;
  const mins = minutesLeft != null ? minutesLeft % 60 : 0;

  return (
    <div>
      {/* The fact first. A professional on a job needs to know that is why the
          buttons below are not what decides their listing right now. */}
      {onJob ? (
        <p className="animate-rise mb-3 flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-caption text-foreground">
          <Briefcase aria-hidden="true" className="size-4 text-primary" />
          {t("onJob")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Choice
          active={state === "now"}
          disabled={busy || onJob}
          onClick={() => setAvailable(true)}
          label={t("free")}
        />
        <Choice
          active={state === "busy"}
          disabled={busy || onJob}
          onClick={() => setBusyWindow("restOfDay")}
          label={t("busyToday")}
          icon={Moon}
        />
        <Choice
          active={state === "today" || state === "scheduled"}
          disabled={busy || onJob}
          onClick={() => {
            setAvailable(false);
            setBusyWindow(null);
          }}
          label={t("neither")}
        />
        {busy ? (
          <Loader2
            aria-hidden="true"
            className="size-4 animate-spin self-center text-muted-foreground"
          />
        ) : null}
      </div>

      <p className="text-caption mt-2 text-muted-foreground">
        {state === "now" && minutesLeft != null
          ? t(endsToday ? "until" : "untilTomorrow", {
              hours: String(hours),
              minutes: String(mins),
            })
          : state === "busy" && minutesLeft != null
            ? t("busyUntil", { hours: String(hours), minutes: String(mins) })
            : t("explain")}
      </p>

      {failed ? (
        <p role="alert" className="text-caption mt-2 text-destructive-ink">
          {t(`errors.${failed}`)}
        </p>
      ) : null}
    </div>
  );
}

/** One state: marked when it is true, pressable when it is not. */
function Choice({
  active,
  disabled,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  icon?: LucideIcon;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(active && "pointer-events-none")}
    >
      {active ? (
        <Check aria-hidden="true" className="size-4" />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-4" />
      ) : null}
      {label}
    </Button>
  );
}
