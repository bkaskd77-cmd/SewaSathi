"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";

type FadeInProps = {
  children: React.ReactNode;
  /** Seconds to wait before animating — used to stagger a group. */
  delay?: number;
  className?: string;
};

/**
 * Entrance animation used across the app. Honours `prefers-reduced-motion`,
 * which matters here: a lot of Nepal browses on low-end Android where motion
 * is both a comfort and a performance question.
 */
export function FadeIn({ children, delay = 0, className }: FadeInProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
