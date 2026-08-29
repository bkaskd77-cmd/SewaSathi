"use client";

import * as React from "react";

import { Link, useRouter } from "@/i18n/navigation";

/**
 * A link that morphs the thing you tapped into the page it opens.
 *
 * Tapping a professional's card and having their photo, name and rate jump to
 * a new position is a cut. Carrying those elements across is what makes the
 * profile read as the same person you were just looking at — the standing rule
 * asks for motion that makes a state change legible, and "this card became
 * this page" is the state change.
 *
 * Built on the browser's View Transitions API rather than a library: the whole
 * mechanism is a callback around the navigation plus a `view-transition-name`
 * on the elements that should morph (see `.vt-*` in styles/globals.css).
 *
 * Progressive enhancement, deliberately. Firefox has no support and older
 * Safari has none either; there, and under `prefers-reduced-motion`, this is
 * an ordinary `Link` and the navigation is exactly what it was before. Nothing
 * about reaching the page depends on the animation.
 */

type Props = React.ComponentPropsWithoutRef<typeof Link>;

function canTransition(): boolean {
  if (typeof document === "undefined") return false;
  if (!("startViewTransition" in document)) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Modified clicks are the browser's to handle — new tab, download, save. */
function isPlainLeftClick(event: React.MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function ViewTransitionLink({ href, onClick, ...props }: Props) {
  const router = useRouter();

  return (
    <Link
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (!isPlainLeftClick(event)) return;
        if (!canTransition()) return;

        event.preventDefault();
        document.startViewTransition(() => {
          router.push(href as string);
        });
      }}
      {...props}
    />
  );
}
