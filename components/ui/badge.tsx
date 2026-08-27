import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status and trust markers.
 *
 * `verified` carries the trust signal customers actually scan for; `urgent` is
 * burnt orange, pushed off gold's hue so it never reads as brand decoration;
 * `info` is slate-blue for neutral facts like a scheduled window.
 *
 * Tinted variants take their ink from a `-ink` token, never from the fill
 * hue — a light hue can be a fill or it can be text, not both.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-semibold transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        verified: "border-primary/25 bg-primary/10 text-primary",
        urgent: "border-warning/30 bg-warning/15 text-warning-ink",
        info: "border-info/25 bg-info/10 text-info-ink",
        gold: "border-transparent bg-gold text-gold-foreground",
        "gold-subtle": "border-gold/40 bg-gold/15 text-gold-ink",
        outline: "border-border text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
