"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";

import {
  buttonVariants,
  type ButtonVariantProps,
} from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/**
 * SajiloKaam button.
 *
 * The styles live in ./button-variants, which has no React in it, so a Server
 * Component can wear the button's look without pulling Slot and this module
 * into its client bundle. Use this component when you need `asChild` or a
 * handler; use `buttonVariants` directly on a native element when you do not.
 */
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    ButtonVariantProps {
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
