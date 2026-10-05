/**
 * A line diff, for showing what a publish would change.
 *
 * WHY THIS EXISTS. A document version is append-only and `bookings.terms_version` points
 * at the one a customer agreed to, so publishing is the one content action that cannot be
 * taken back. "Are you sure" is not a safeguard; showing the actual change is. The
 * rendered preview says what the new text looks like, and this says what moved.
 *
 * WRITTEN RATHER THAN INSTALLED. No diff library is in this project and one line-level
 * comparison does not earn a dependency on a money-and-legal path — the same call
 * `lib/security/image.ts` made for its EXIF reader. It is forty lines and it is tested.
 *
 * IT DIFFS THE TEXT IN THE BOX. The editor's working copy is already text, and the live
 * version is serialised by the same `documentLines` the editor fills its fields from — so
 * the diff cannot disagree with what the admin typed. Nothing re-derives anything.
 */

export type DiffLine = { kind: "same" | "added" | "removed"; text: string };

/**
 * `before` and `after` as a line-by-line comparison, longest common subsequence.
 *
 * An unchanged line appears once as `same`; a changed line appears as `removed` then
 * `added`, which is what makes a reworded sentence readable rather than reported as a
 * whole section replaced.
 */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;

  /* lcs[i][j] — the longest common subsequence of before[i…] and after[j…]. */
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: "same", text: before[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: before[i] });
      i += 1;
    } else {
      out.push({ kind: "added", text: after[j] });
      j += 1;
    }
  }
  while (i < n) out.push({ kind: "removed", text: before[i++] });
  while (j < m) out.push({ kind: "added", text: after[j++] });

  return out;
}

/**
 * Only the lines that moved, with one line of context either side.
 *
 * A four-hundred-line legal document diffed in full is a screen nobody reads, and a
 * screen nobody reads is the same safeguard as no screen at all.
 *
 * AN UNCHANGED DOCUMENT RETURNS AN EMPTY ARRAY, which the screen says out loud rather
 * than rendering as an empty box — "nothing would change" and "we could not compare" must
 * not look alike.
 */
export function changedLines(diff: DiffLine[], context = 1): DiffLine[] {
  const keep = new Set<number>();
  diff.forEach((line, index) => {
    if (line.kind === "same") return;
    for (let k = index - context; k <= index + context; k += 1) {
      if (k >= 0 && k < diff.length) keep.add(k);
    }
  });
  return [...keep].sort((a, b) => a - b).map((index) => diff[index]);
}

/** How many lines were added and removed. Shown beside the diff, so the size is legible. */
export function diffCount(diff: DiffLine[]): { added: number; removed: number } {
  return {
    added: diff.filter((l) => l.kind === "added").length,
    removed: diff.filter((l) => l.kind === "removed").length,
  };
}
