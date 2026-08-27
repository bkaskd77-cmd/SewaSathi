"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";

import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { OtpInput } from "@/components/ui/otp-input";
import { sendOtp, verifyOtp } from "@/lib/auth/otp";
import { formatE164ForDisplay } from "@/lib/auth/phone";

const RESEND_SECONDS = 60;

// Long enough to read "Verified", short enough that nobody wonders whether the
// tap landed. The session already exists by this point — this holds the screen,
// not the sign-in.
const SUCCESS_HOLD_MS = 700;

export function VerifyForm({ phone, next }: { phone: string; next: string }) {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  // Bumped on every failed attempt so the shake re-fires; a boolean would only
  // animate the first time, because the class never leaves the DOM in between.
  const [errorNonce, setErrorNonce] = React.useState(0);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<"idle" | "checking" | "success">(
    "idle",
  );
  const [secondsLeft, setSecondsLeft] = React.useState(RESEND_SECONDS);
  const [showHelp, setShowHelp] = React.useState(false);

  const busy = status !== "idle";
  const succeeded = status === "success";

  React.useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = window.setInterval(
      () => setSecondsLeft((s) => Math.max(0, s - 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [secondsLeft]);

  // The "didn't get it?" route opens itself once the wait is over, so nobody
  // has to work out that the code is not coming.
  React.useEffect(() => {
    if (secondsLeft === 0) setShowHelp(true);
  }, [secondsLeft]);

  const submit = React.useCallback(
    async (value: string) => {
      if (value.length !== 6 || busy) return;
      setStatus("checking");
      setError(null);
      setNotice(null);

      const outcome = await verifyOtp(phone, value);

      if (!outcome.ok) {
        setStatus("idle");
        setCode("");
        setError(outcome.message);
        setErrorNonce((n) => n + 1);
        return;
      }

      // New accounts need a name before anyone is sent to their door.
      const destination = outcome.isNewUser
        ? `/onboarding?next=${encodeURIComponent(next)}`
        : next;

      // Land on "verified" first. Jumping straight to the next screen the
      // instant the API returns reads as if something else happened.
      setStatus("success");
      window.setTimeout(() => {
        router.replace(destination);
        router.refresh();
      }, SUCCESS_HOLD_MS);
    },
    [busy, next, phone, router],
  );

  async function resend() {
    setStatus("checking");
    setError(null);
    const outcome = await sendOtp(phone);
    setStatus("idle");

    if (!outcome.ok) {
      setError(outcome.message);
      setErrorNonce((n) => n + 1);
      setSecondsLeft(outcome.retryAfterSeconds ?? RESEND_SECONDS);
      return;
    }
    setCode("");
    setNotice("New code sent.");
    setSecondsLeft(RESEND_SECONDS);
  }

  return (
    <div>
      <OtpInput
        value={code}
        onChange={(next) => {
          setCode(next);
          if (error) setError(null);
        }}
        onComplete={submit}
        disabled={busy}
        invalid={Boolean(error)}
        errorNonce={errorNonce}
        success={succeeded}
        autoFocus
      />

      <FieldError
        id="otp-error"
        message={error}
        lines={2}
        className="mt-3 text-center"
      />

      <div aria-live="polite" className="min-h-[1.35rem] text-center">
        {notice ? (
          <p className="text-caption text-success-ink">{notice}</p>
        ) : null}
      </div>

      {succeeded ? (
        // Not a button: there is nothing left to press. Same box as the button
        // it replaces, so the layout does not move underneath the swap.
        <div
          role="status"
          className="animate-pop-in mt-2 flex h-13 w-full items-center justify-center gap-2 rounded-md bg-success px-7 text-body-md font-semibold text-success-foreground"
        >
          <Check aria-hidden="true" className="size-5" />
          Verified — taking you in…
        </div>
      ) : (
        <Button
          type="button"
          variant="gold"
          size="lg"
          className="btn-tactile mt-2 w-full"
          disabled={code.length !== 6 || busy}
          onClick={() => submit(code)}
        >
          {status === "checking" ? "Checking…" : "Verify and continue"}
        </Button>
      )}

      <div className="mt-5 flex flex-col items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={secondsLeft > 0 || busy}
          onClick={resend}
        >
          {secondsLeft > 0
            ? `Resend code in ${secondsLeft}s`
            : "Resend the code"}
        </Button>

        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="rounded-sm text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Wrong number? Change it
        </Link>
      </div>

      {/* Never a dead end: if the SMS does not arrive there is somewhere to go. */}
      <div className="mt-8 rounded-lg border border-border bg-muted/50 p-4">
        <button
          type="button"
          aria-expanded={showHelp}
          onClick={() => setShowHelp((open) => !open)}
          className="w-full rounded-sm text-left text-body-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Didn&rsquo;t get the code?
        </button>
        {showHelp ? (
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-caption text-muted-foreground">
            <li>
              Delivery to NTC and Ncell can take up to a minute in poor
              coverage. Move somewhere with signal and wait a little.
            </li>
            <li>
              Check the number above is right — one wrong digit is enough.
            </li>
            <li>
              Still nothing? Call us on{" "}
              <a
                href="tel:+9779800000000"
                className="text-foreground underline underline-offset-2"
              >
                +977 9800 000 000
              </a>{" "}
              and we&rsquo;ll book it for you over the phone.
            </li>
          </ul>
        ) : null}
      </div>

      <p className="mt-6 text-center text-caption text-muted-foreground">
        Code sent to {formatE164ForDisplay(phone)}
      </p>
    </div>
  );
}
