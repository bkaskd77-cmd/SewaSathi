"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Search, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  categoryName,
  triageProblem,
  type TriageResult,
} from "@/lib/ai/mockTriage";
import { cn, formatNpr } from "@/lib/utils";

/**
 * The hero input — the front door of the whole product.
 *
 * One controlled value and one `runTriage(query)` path; the chips and the
 * debounced typing handler both go through it rather than having their own
 * logic. Phase 4 swaps `triageProblem` for a real Claude call (same signature,
 * see lib/ai/mockTriage.ts) and nothing in this component changes except that
 * the thinking state becomes real latency instead of a simulated one.
 */

const QUICK_PICKS = ["Water leak", "Power cut", "Need it today"] as const;

const TYPING_DEBOUNCE_MS = 600;
/** Long enough to read as "working", short enough not to feel broken. */
const THINKING_MS = 750;

const URGENCY_META = {
  emergency: { label: "Emergency", variant: "urgent" as const },
  soon: { label: "Needed soon", variant: "info" as const },
  routine: { label: "Routine", variant: "verified" as const },
};

export function ProblemSearch() {
  const [query, setQuery] = React.useState("");
  const [thinking, setThinking] = React.useState(false);
  const [result, setResult] = React.useState<TriageResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debounceRef = React.useRef<number | undefined>(undefined);
  const thinkingRef = React.useRef<number | undefined>(undefined);
  // Guards against an earlier, slower triage overwriting a newer one.
  const runIdRef = React.useRef(0);

  React.useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current);
      window.clearTimeout(thinkingRef.current);
    },
    [],
  );

  const runTriage = React.useCallback((value: string) => {
    const trimmed = value.trim();
    window.clearTimeout(debounceRef.current);
    window.clearTimeout(thinkingRef.current);

    if (!trimmed) {
      setThinking(false);
      setResult(null);
      return;
    }

    const runId = ++runIdRef.current;
    setThinking(true);

    thinkingRef.current = window.setTimeout(() => {
      if (runId !== runIdRef.current) return;
      // Phase 4: `await triageProblem(trimmed)` against the Claude API.
      setResult(triageProblem(trimmed));
      setThinking(false);
    }, THINKING_MS);
  }, []);

  const onChange = (value: string) => {
    setQuery(value);
    window.clearTimeout(debounceRef.current);
    if (!value.trim()) {
      runIdRef.current++;
      setThinking(false);
      setResult(null);
      return;
    }
    debounceRef.current = window.setTimeout(
      () => runTriage(value),
      TYPING_DEBOUNCE_MS,
    );
  };

  return (
    <div id="hero-search" className="scroll-mt-24">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!query.trim()) {
            inputRef.current?.focus();
            return;
          }
          runTriage(query);
        }}
        className="flex flex-col gap-2 rounded-xl border border-input bg-card p-2 shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background sm:flex-row sm:items-center"
      >
        <label htmlFor="problem" className="sr-only">
          What&rsquo;s broken today?
        </label>
        <div className="flex flex-1 items-center gap-2.5 px-3">
          <Search
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <input
            id="problem"
            ref={inputRef}
            value={query}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Tap is leaking, AC not cooling, need someone to clean the flat…"
            autoComplete="off"
            className="h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/80"
          />
        </div>
        <Button
          type="submit"
          variant="gold"
          size="lg"
          className="btn-tactile shrink-0"
        >
          Find help
          <ArrowRight aria-hidden="true" />
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-caption text-muted-foreground">Common:</span>
        {QUICK_PICKS.map((pick) => (
          <button
            key={pick}
            type="button"
            onClick={() => {
              setQuery(pick);
              runTriage(pick);
            }}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-caption font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {pick}
          </button>
        ))}
      </div>

      {/* Result area. Announced politely so the outcome reaches screen
          readers once, rather than every frame of the thinking state. */}
      <div aria-live="polite" aria-atomic="true">
        {thinking ? <TriageSkeleton /> : null}
        {!thinking && result ? <TriageCard result={result} /> : null}
      </div>
    </div>
  );
}

function TriageSkeleton() {
  return (
    <div className="animate-rise mt-4 rounded-xl border border-border bg-card p-5">
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <Sparkles aria-hidden="true" className="size-3.5 text-gold-ink" />
        Reading your description…
      </p>
      <div aria-hidden="true" className="mt-3 flex flex-col gap-2.5">
        <div className="flex gap-2">
          <span className="animate-skeleton h-6 w-28 rounded-full bg-muted" />
          <span className="animate-skeleton h-6 w-24 rounded-full bg-muted [animation-delay:120ms]" />
        </div>
        <span className="animate-skeleton h-5 w-40 rounded bg-muted [animation-delay:60ms]" />
        <span className="animate-skeleton h-4 w-full max-w-md rounded bg-muted [animation-delay:180ms]" />
      </div>
    </div>
  );
}

function TriageCard({ result }: { result: TriageResult }) {
  const urgency = URGENCY_META[result.urgency];
  const name = categoryName(result.category);
  const [low, high] = result.priceRangeNPR;

  return (
    <div className="animate-rise mt-4 rounded-xl border border-border bg-card p-5 shadow-md">
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <Sparkles aria-hidden="true" className="size-3.5 text-gold-ink" />
        Here&rsquo;s what we think you need
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant="verified">{name}</Badge>
        <Badge variant={urgency.variant}>{urgency.label}</Badge>
      </div>

      <p className="mt-3 font-display text-lg font-bold tabular-nums">
        {formatNpr(low)} – {formatNpr(high)}
        <span className="ml-2 text-caption font-normal text-muted-foreground">
          typical range
        </span>
      </p>

      <p className="mt-2 text-pretty text-body-sm text-muted-foreground">
        {result.explanation}
      </p>

      <Button variant="gold" className={cn("btn-tactile mt-4")} asChild>
        <Link href={`/services/${result.category}?urgency=${result.urgency}`}>
          Find {name.toLowerCase()} professionals
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </div>
  );
}
