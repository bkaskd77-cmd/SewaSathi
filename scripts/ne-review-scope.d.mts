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
