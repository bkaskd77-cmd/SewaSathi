import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Text input.
 *
 * Height matches Button's default so a field and its action line up when they
 * sit side by side — which they will constantly, from OTP entry in Phase 3 to
 * the address picker in Phase 6. `text-base` on mobile is deliberate: iOS
 * Safari zooms the viewport on focus for anything under 16px.
 */
const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-11 w-full rounded-md border border-input bg-background px-3.5 py-2 text-base ring-offset-background transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:text-body-sm",
      "file:border-0 file:bg-transparent file:text-body-sm file:font-medium",
      "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
