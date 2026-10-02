/**
 * Types for the scope module, which is `.mjs` so the check scripts can import
 * it without a build step. The unit test is TypeScript, so it needs these.
 */
export type ReviewTier = "money" | "safety" | "legal" | "staff";

export type ScopeRule = {
  tier: ReviewTier;
  /** Dot-path prefix. Matched on the dot boundary, never as a substring. */
  prefix: string;
  why: string;
};

export type ProseDocument = {
  tier: ReviewTier;
  /** Repository-relative path to an `{ en, ne }` document. */
  path: string;
  why: string;
};

export type ScopeEntry = ScopeRule & {
  key: string;
  /** True once somebody has actually read it — from messages/ne-reviewed.json. */
  reviewed: boolean;
};

export declare const REVIEW_SCOPE: ScopeRule[];
export declare const PROSE_DOCUMENTS: ProseDocument[];
export declare function leaves(value: unknown, prefix?: string): string[];
export declare function inScope(
  catalogue: unknown,
  reviewed?: string[],
): ScopeEntry[];

export type ReviewedFile = {
  /** Keys a native speaker has read in place. */
  keys?: string[];
  /** Paths of long-form `{ en, ne }` documents a native speaker has read. */
  documents?: string[];
};

export type BacklogHalf = {
  keys: ScopeEntry[];
  documents: (ProseDocument & { reviewed: boolean })[];
  /** Everything in scope for this half, read or not — the denominator. */
  inScope: number;
};

export declare const BLOCKING_TIERS: ReviewTier[];
export declare function isBlockingTier(tier: string): boolean;
export declare function backlog(
  catalogue: unknown,
  reviewed?: ReviewedFile,
): {
  scope: ScopeEntry[];
  documents: (ProseDocument & { reviewed: boolean })[];
  /** money, safety and legal — refuses a launch build. */
  blocking: BacklogHalf;
  /** staff — counted and printed, never a launch failure. */
  waiting: BacklogHalf;
};
