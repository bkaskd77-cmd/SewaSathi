import { cva, type VariantProps } from "class-variance-authority";

/**
 * The button's *styles*, with no React in them.
 *
 * Split out of button.tsx because that file is `"use client"` — it needs
 * Radix's Slot for `asChild`. A Server Component that only wants the look of a
 * button (a plain `<button type="submit">` in a GET form, a link styled as a
 * button) can take these classes without pulling Slot, cva's runtime and the
 * button module into that route's client bundle. Doing it the other way cost
 * /services 12 kB for one search box, and the bundle budget caught it.
 */
/**
 * `gold` is the brand accent and is deliberately scarce — one per screen, on
 * the action that commits the customer (book, confirm, pay). Everything else
 * uses `default` (jade) or a quieter variant, so the gold keeps meaning
 * something when it appears.
 */
export const buttonVariants = cva(
  [
    "relative isolate overflow-hidden",
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold ring-offset-background",
    /*
     * A sheen that sweeps across on hover. It is the difference between a
     * coloured rectangle and something that feels like a control — and it
     * costs one pseudo-element rather than a motion library. Filled variants
     * opt in with `before:via-white/20`; the quiet ones leave it transparent
     * so a ghost button does not shimmer.
     */
    "before:pointer-events-none before:absolute before:inset-0 before:-z-10",
    "before:-translate-x-[110%] before:bg-gradient-to-r before:from-transparent before:to-transparent",
    "before:transition-transform before:duration-700 before:ease-out",
    "hover:before:translate-x-[110%]",
    "motion-reduce:before:hidden",
    // The trailing arrow leans toward where it is taking you.
    "[&>svg:last-child]:transition-transform [&>svg:last-child]:duration-200",
    "hover:[&>svg:last-child]:translate-x-0.5 motion-reduce:hover:[&>svg:last-child]:translate-x-0",
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
        default: [
          "bg-primary text-primary-foreground shadow-sm before:via-white/20",
          "hover:bg-primary/92 hover:shadow-md hover:shadow-primary/20",
          "hover:-translate-y-px active:translate-y-0",
          "motion-reduce:hover:translate-y-0",
        ].join(" "),
        /*
         * The one that commits the customer, so it carries the most weight: a
         * gradient for dimension, a shadow that grows, and a lift that the
         * press cancels. Scarce by design — one per screen.
         */
        gold: [
          "bg-gold bg-gradient-to-b from-white/12 to-transparent text-gold-foreground",
          "shadow-sm before:via-white/30",
          "hover:bg-gold/95 hover:shadow-lg hover:shadow-gold/25",
          "hover:-translate-y-px active:translate-y-0",
          "motion-reduce:hover:translate-y-0",
        ].join(" "),
        outline:
          "border border-input bg-background hover:border-primary/40 hover:bg-accent hover:text-accent-foreground",
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

export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
