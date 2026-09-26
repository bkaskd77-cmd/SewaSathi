/**
 * Types for the route module, which is `.mjs` so the check script can import it
 * without a build step. The unit test is TypeScript, so it needs these.
 */
export type Verdict = {
  ok: boolean;
  /** Short, for the run's own output line. */
  detail: string;
  /** The sentence a human reads at the end. Null when ok. */
  failure: string | null;
};

export type CoverageGap = { route: string; file: string };

export declare const OPEN_ROUTES: string[];
export declare const GUARDED_ROUTES: string[];
export declare const GONE_ROUTES: string[];
export declare const LOCALE_PREFIXES: string[];
export declare const NOT_WALKABLE: { route: string; covered: string }[];

export declare function loginPathFor(prefix: string): string;
export declare function redirectPath(
  location: string | null | undefined,
  origin?: string,
): string | null;
export declare function judgeGuarded(input: {
  route: string;
  prefix?: string;
  status: number | string;
  location?: string | null;
}): Verdict;
export declare function judgeOpen(input: {
  route: string;
  status: number | string;
}): Verdict;
export declare function judgeGone(input: {
  route: string;
  status: number | string;
}): Verdict;
export declare function cronPaths(vercelJsonText: string): string[] | null;
export declare function judgeCron(input: {
  path: string;
  status: number | string;
}): Verdict;
export declare function routeForPageFile(file: string): string | null;
export declare function coverageGaps(pageFiles: readonly string[]): CoverageGap[];
