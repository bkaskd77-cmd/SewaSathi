import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Status and trust markers.
 *
 * `verified` and `rate` carry the trust signals customers actually scan for;
 * `urgent` is turmeric, reserved for emergency jobs; `info` is indigo for
 * neutral facts like a scheduled window.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-caption font-semibold transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        verified: "border-primary/20 bg-primary/10 text-primary",
        urgent:
          "border-warning/30 bg-warning/15 text-warning-foreground dark:text-warning",
        info: "border-info/25 bg-info/10 text-info",
        sindoor: "border-transparent bg-sindoor text-sindoor-foreground",
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
