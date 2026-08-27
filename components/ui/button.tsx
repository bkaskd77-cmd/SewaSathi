"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * SajiloKaam button.
 *
 * `gold` is the brand accent and is deliberately scarce — one per screen,
 * on the action that commits the customer (book, confirm, pay). Everything
 * else uses `default` (jade) or a quieter variant, so the red keeps meaning
 * something when it appears.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold ring-offset-background",
    // Transform is in the transition list for the press below. `.btn-tactile`
    // overrides both with its own curve where a button needs the lift too.
    "transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
    // Every button acknowledges the press. Faster on the way down than the
    // way back, which is what makes it read as pressed rather than animated.
    "active:scale-[0.98] active:duration-75 motion-reduce:active:scale-100",
    "disabled:pointer-events-none disabled:border-transparent disabled:bg-muted disabled:text-muted-foreground/70 disabled:shadow-none",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        gold: "bg-gold text-gold-foreground hover:bg-gold/90",
        outline:
          "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-9 px-3.5 text-body-sm",
        default: "h-11 px-5 text-body-sm",
        // Emergency bookings are tapped in a hurry, often one-handed.
        lg: "h-13 px-7 text-body-md",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
