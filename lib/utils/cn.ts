import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's stock scales. Our type scale replaces
 * it wholesale (`text-body-sm`, `text-display-lg`, …), and without this
 * declaration those get mistaken for text *colours* — so a component that
 * sets both a size and a colour silently loses the colour to whichever came
 * last. That is how `text-gold-foreground` would silently disappear off
 * the booking button, leaving unreadable ink on Warm Gold.
 *
 * Every custom step in tailwind.config.ts `fontSize` must be listed here.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display-2xl",
            "display-xl",
            "display-lg",
            "display-md",
            "display-sm",
            "body-lg",
            "body-md",
            "body-sm",
            "caption",
            "overline",
          ],
        },
      ],
    },
  },
});

/**
 * Merge Tailwind classes with later classes winning conflicts.
 * shadcn/ui components import this from `@/lib/utils`.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
