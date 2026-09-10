"use client";

import * as React from "react";

/**
 * How long this review screen has been open.
 *
 * NOT A GATE, AND IT MUST NEVER BECOME ONE. Nothing refuses a decision for
 * being fast: a reviewer who has seen this applicant twice, or who opened the
 * file this morning and is deciding after lunch, is not doing anything wrong.
 * A threshold here would be a threshold on being efficient.
 *
 * WHAT IT IS FOR IS THE PATTERN, AFTERWARDS. Nothing can make somebody
 * actually look at a photograph — that was true when the confirm checkbox was
 * built and it is still true. What CAN be done is to make a run of two-second
 * approvals visible to whoever reads the audit trail later, which is a smaller
 * and more honest claim than pretending the interface enforces attention.
 *
 * MEASURED FROM THE PAGE OPENING, in the browser, and read at submit time
 * rather than on a timer — a state update every second would re-render the
 * whole review screen for no reason. Somebody who wanted to defeat this could;
 * the answer to that is that they would have to do it deliberately, every
 * single time, which is itself the signal.
 */
export function useSecondsOnEvidence(): () => number {
  const openedAt = React.useRef<number>(Date.now());

  return React.useCallback(
    () => Math.max(0, Math.round((Date.now() - openedAt.current) / 1000)),
    [],
  );
}
