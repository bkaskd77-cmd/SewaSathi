"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The hero input — the front door of the whole product.
 *
 * Deliberately one controlled value and one `submit(query)` path, with the
 * chips routed through the same function rather than their own handlers.
 * Phase 4 replaces the body of `submit` with a call to Claude triage; nothing
 * else about this component has to change.
 */

// Most common emergencies people actually call about, in their words.
const QUICK_PICKS = ["Water leak", "Power cut", "Need it today"] as const;

export function ProblemSearch() {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const submit = React.useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        inputRef.current?.focus();
        return;
      }
      // Phase 4: run Claude triage here and route to the classified result.
      router.push(`/services?q=${encodeURIComponent(trimmed)}`);
    },
    [router],
  );

  return (
    <div id="hero-search" className="scroll-mt-24">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit(query);
        }}
        className={cn(
          "flex flex-col gap-2 rounded-xl border border-input bg-card p-2 shadow-md focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background sm:flex-row sm:items-center",
        )}
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
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tap is leaking, AC not cooling, need someone to clean the flat…"
            autoComplete="off"
            className="h-12 w-full min-w-0 bg-transparent text-base outline-none placeholder:text-muted-foreground/80"
          />
        </div>
        <Button type="submit" variant="gold" size="lg" className="shrink-0">
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
              submit(pick);
            }}
            className="rounded-full border border-border bg-card px-3 py-1.5 text-caption font-medium transition-colors hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {pick}
          </button>
        ))}
      </div>
    </div>
  );
}
