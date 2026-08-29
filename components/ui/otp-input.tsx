"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Six separate digit boxes with auto-advance, paste, backspace and arrow keys.
 *
 * Separate boxes rather than one field because the code arrives by SMS and
 * people read it back a digit at a time — and because on a phone the boxes
 * make the target big enough to hit without zooming.
 *
 * Paste is handled on every box, not just the first: iOS "Paste" from the SMS
 * notification can land anywhere, and dropping the paste because focus was on
 * box 3 is the kind of thing that makes people give up.
 *
 * Motion: each digit pops as it lands, so a keypress that registered looks
 * different from one that did not. A paste staggers across the boxes it fills
 * rather than flashing all six at once. `errorNonce` shakes the group once —
 * bumping it re-fires the shake on the second wrong code, which toggling a
 * boolean would not, because the class never leaves the DOM between attempts.
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  errorNonce = 0,
  success,
  autoFocus,
}: {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  errorNonce?: number;
  success?: boolean;
  autoFocus?: boolean;
}) {
  const t = useTranslations("auth.verify");
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const completedFor = React.useRef<string | null>(null);

  // Indices filled since the last render, so only new digits animate.
  const [landed, setLanded] = React.useState<number[]>([]);
  const previousLength = React.useRef(value.length);

  const [shaking, setShaking] = React.useState(false);

  React.useEffect(() => {
    const before = previousLength.current;
    previousLength.current = value.length;

    if (value.length <= before) {
      setLanded([]);
      return;
    }

    const fresh = Array.from(
      { length: value.length - before },
      (_, i) => before + i,
    );
    setLanded(fresh);

    // Clear once the longest stagger has finished, so a later edit re-animates.
    const timer = window.setTimeout(
      () => setLanded([]),
      200 + fresh.length * 45,
    );
    return () => window.clearTimeout(timer);
  }, [value]);

  React.useEffect(() => {
    if (errorNonce === 0) return;
    setShaking(true);
    const timer = window.setTimeout(() => setShaking(false), 340);
    return () => window.clearTimeout(timer);
  }, [errorNonce]);

  React.useEffect(() => {
    if (value.length === length && completedFor.current !== value) {
      completedFor.current = value;
      onComplete?.(value);
    }
    if (value.length < length) completedFor.current = null;
  }, [value, length, onComplete]);

  const focusBox = (index: number) => {
    refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();
  };

  const setDigit = (index: number, digit: string) => {
    const next = value.padEnd(length, " ").split("");
    next[index] = digit;
    onChange(next.join("").replace(/\s/g, "").slice(0, length));
  };

  return (
    <div
      className={cn(
        "flex justify-between gap-2 sm:gap-3",
        shaking && "animate-shake",
      )}
      role="group"
      aria-label={t("otpLabel")}
    >
      {Array.from({ length }).map((_, i) => {
        const filled = Boolean(value[i]);
        const landedAt = landed.indexOf(i);

        return (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={value[i] ?? ""}
            disabled={disabled}
            autoFocus={autoFocus && i === 0}
            inputMode="numeric"
            // One-time-code lets both iOS and Android offer the SMS autofill.
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            aria-label={t("otpDigit", { index: String(i + 1) })}
            aria-invalid={invalid || undefined}
            style={
              landedAt > 0
                ? { animationDelay: `${landedAt * 45}ms` }
                : undefined
            }
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "");
              if (!digits) {
                setDigit(i, "");
                return;
              }
              // Typing fast, or an autofill, can deliver several digits at once.
              const merged = value.slice(0, i) + digits.slice(0, length - i);
              onChange(merged.slice(0, length));
              focusBox(i + digits.length);
            }}
            onKeyDown={(event) => {
              if (event.key === "Backspace") {
                event.preventDefault();
                if (value[i]) {
                  onChange(value.slice(0, i) + value.slice(i + 1));
                } else if (i > 0) {
                  onChange(value.slice(0, i - 1) + value.slice(i));
                  focusBox(i - 1);
                }
                return;
              }
              if (event.key === "ArrowLeft") focusBox(i - 1);
              if (event.key === "ArrowRight") focusBox(i + 1);
            }}
            onPaste={(event) => {
              event.preventDefault();
              const pasted = event.clipboardData
                .getData("text")
                .replace(/\D/g, "")
                .slice(0, length);
              if (!pasted) return;
              onChange(pasted);
              focusBox(pasted.length);
            }}
            className={cn(
              "h-14 w-full min-w-0 rounded-lg border bg-card text-center font-display text-2xl font-bold tabular-nums",
              "transition-[border-color,background-color,box-shadow,transform] duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              "disabled:cursor-not-allowed",
              // Success keeps full contrast: the boxes are the confirmation,
              // so fading them at the moment of success reads as a failure.
              success ? "disabled:opacity-100" : "disabled:opacity-60",
              landedAt !== -1 && "animate-digit-in",
              success
                ? "border-success bg-success/[0.07]"
                : invalid
                  ? "border-destructive focus-visible:ring-destructive"
                  : filled
                    ? "border-primary/55 bg-primary/[0.04]"
                    : "border-input",
            )}
          />
        );
      })}
    </div>
  );
}
