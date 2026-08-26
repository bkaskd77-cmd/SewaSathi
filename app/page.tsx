import { Check, Minus } from "lucide-react";

import { FadeIn } from "@/components/shared/fade-in";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { hasAnthropicConfig } from "@/lib/ai";
import { hasSupabaseConfig } from "@/lib/env";
import { cn } from "@/lib/utils";

/**
 * Foundation placeholder.
 *
 * Deliberately not a marketing page — that is Phase 2. Everything on it exists
 * to prove one of the Phase 0 deliverables is genuinely wired: the type scale,
 * the colour tokens in both themes, the theme switch, Framer Motion, and
 * whether Supabase and Anthropic keys reached the deployment.
 */

const TOKENS = [
  { name: "primary", className: "bg-primary" },
  { name: "sindoor", className: "bg-sindoor" },
  { name: "success", className: "bg-success" },
  { name: "warning", className: "bg-warning" },
  { name: "info", className: "bg-info" },
  { name: "destructive", className: "bg-destructive" },
  { name: "muted", className: "bg-muted" },
  { name: "accent", className: "bg-accent" },
];

function EnvRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
          ready
            ? "bg-success text-success-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {ready ? (
          <Check className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Minus className="h-3 w-3" aria-hidden="true" />
        )}
      </span>
      <span className="text-body-sm">{label}</span>
      <span
        className={cn(
          "ml-auto text-caption font-medium",
          ready ? "text-success" : "text-muted-foreground",
        )}
      >
        {ready ? "connected" : "awaiting keys"}
      </span>
    </li>
  );
}

export default function Home() {
  const supabaseReady = hasSupabaseConfig();
  const anthropicReady = hasAnthropicConfig();

  return (
    <main className="relative min-h-dvh overflow-hidden">
      {/* Ambient wash — pure token colour, so it re-tints with the theme. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-gradient-to-b from-primary/10 to-transparent"
      />

      <div className="container relative py-16 sm:py-22">
        <div className="mx-auto max-w-2xl">
          <FadeIn className="mb-12 flex items-center justify-between">
            <span className="text-overline uppercase text-muted-foreground">
              Phase 0
            </span>
            <ThemeToggle />
          </FadeIn>

          <FadeIn delay={0.05}>
            <h1 className="text-balance font-display text-display-lg sm:text-display-xl">
              Sewa<span className="text-sindoor">[X]</span>
            </h1>
            <p className="mt-4 text-pretty text-body-lg text-muted-foreground">
              Foundation live. Design tokens, Supabase wiring and the deploy
              pipeline are in place — the first real screen lands in Phase 1.
            </p>
            <p className="mt-2 text-body-md text-muted-foreground" lang="ne">
              नेपालका लागि घरायसी सेवा।
            </p>
          </FadeIn>

          <FadeIn delay={0.12} className="mt-12">
            <h2 className="mb-3 text-overline uppercase text-muted-foreground">
              Colour tokens
            </h2>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              {TOKENS.map((token) => (
                <div key={token.name} className="space-y-1.5">
                  <div
                    className={cn(
                      "h-12 rounded-md border border-border",
                      token.className,
                    )}
                  />
                  <p className="text-[10px] leading-tight text-muted-foreground">
                    {token.name}
                  </p>
                </div>
              ))}
            </div>
          </FadeIn>

          <FadeIn delay={0.18} className="mt-12">
            <h2 className="mb-3 text-overline uppercase text-muted-foreground">
              Type scale
            </h2>
            <div className="space-y-3 rounded-lg border border-border bg-card p-6 shadow-md">
              <p className="font-display text-display-sm">
                Display — Sora, tightened
              </p>
              <p className="text-body-md">
                Body — Plus Jakarta Sans at a comfortable reading measure.
              </p>
              <p className="text-caption text-muted-foreground">
                Caption — metadata, timestamps, helper text.
              </p>
            </div>
          </FadeIn>

          <FadeIn delay={0.24} className="mt-12">
            <h2 className="mb-3 text-overline uppercase text-muted-foreground">
              Service wiring
            </h2>
            <ul className="divide-y divide-border rounded-lg border border-border bg-card px-6 py-2 shadow-md">
              <EnvRow label="Supabase (URL + anon key)" ready={supabaseReady} />
              <EnvRow
                label="Anthropic (Claude API key)"
                ready={anthropicReady}
              />
            </ul>
            <p className="mt-3 text-caption text-muted-foreground">
              Add the missing values in Vercel → Settings → Environment
              Variables, then redeploy. See README.md for the full checklist.
            </p>
          </FadeIn>
        </div>
      </div>
    </main>
  );
}
