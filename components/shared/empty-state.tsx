import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * What a list looks like before it has anything in it.
 *
 * An empty list is a normal state, not an error, so this is quiet: no warning
 * colour, no illustration to download. It always carries an action — a screen
 * that says "nothing here" and offers no way forward is a dead end, and people
 * leave rather than work out what to do next.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "flex flex-col items-center px-6 py-14 text-center sm:py-18",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-14 place-items-center rounded-full bg-primary/[0.08] text-primary"
      >
        <Icon className="size-6" />
      </span>

      <h2 className="mt-5 font-display text-display-sm">{title}</h2>
      <p className="mt-2 max-w-sm text-pretty text-body-sm text-muted-foreground">
        {description}
      </p>

      {action ? <div className="mt-6">{action}</div> : null}
    </Card>
  );
}
