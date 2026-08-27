"use client";

import * as React from "react";

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
 */
export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled,
  invalid,
  autoFocus,
}: {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const refs = React.useRef<Array<HTMLInputElement | null>>([]);
  const completedFor = React.useRef<string | null>(null);

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
      className="flex justify-between gap-2 sm:gap-3"
      role="group"
      aria-label={`${length}-digit verification code`}
    >
      {Array.from({ length }).map((_, i) => (
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
          aria-label={`Digit ${i + 1}`}
          aria-invalid={invalid || undefined}
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
            "h-14 w-full min-w-0 rounded-lg border bg-card text-center font-display text-2xl font-bold tabular-nums transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:cursor-not-allowed disabled:opacity-60",
            invalid
              ? "border-destructive focus-visible:ring-destructive"
              : "border-input",
          )}
        />
      ))}
    </div>
  );
}
