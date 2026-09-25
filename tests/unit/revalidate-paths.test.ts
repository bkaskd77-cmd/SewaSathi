import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `revalidatePath` that names a route nobody serves refreshes nothing.
 *
 * WHAT WENT WRONG. The five admin queues were written under `(app)` and later
 * moved into their own `(admin)` route group, and every one of their actions
 * kept revalidating `"/[locale]/(app)/admin/…"`. That path stopped existing
 * the moment the pages moved. `revalidatePath` does not throw on a path it
 * cannot match — it returns quietly — so a reviewer deciding an appeal got no
 * error and no refreshed list, and the sixth queue was about to be written by
 * copying the same line.
 *
 * WHY THIS IS A TEST AND NOT CARE. The failure is silent by construction, it
 * survived a whole route-group migration, and the next person to move a page
 * has no reason to think about it. The filesystem is the answer: a path with a
 * route group in it names a directory, and that directory either holds a page
 * or the call is dead.
 *
 * SCOPE, DELIBERATELY NARROW. Only literals beginning `/[locale]/(` are
 * checked — those are the app-router forms that carry a route group and are
 * therefore checkable against disk. A concrete URL like `/provider/jobs` is a
 * different thing Next resolves at runtime, and guessing at it is how a
 * checker starts crying wolf.
 */

const APP = path.join(process.cwd(), "app");

function actionFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) actionFiles(full, found);
    else if (entry === "actions.ts") found.push(full);
  }
  return found;
}

/** Every `revalidatePath("…")` string literal that carries a route group. */
function groupedPaths(source: string): string[] {
  const pattern = /revalidatePath\(\s*"([^"]+)"/g;
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    if (match[1].startsWith("/[locale]/(")) found.push(match[1]);
  }
  return found;
}

describe("revalidatePath names a route that exists", () => {
  const files = actionFiles(APP);

  it("finds the action files at all", () => {
    // A walker that silently stopped walking would pass every case below.
    expect(files.length).toBeGreaterThan(0);
  });

  it("points every grouped path at a directory holding a page", () => {
    const dead: string[] = [];

    for (const file of files) {
      for (const routePath of groupedPaths(readFileSync(file, "utf8"))) {
        const onDisk = path.join(APP, routePath.replace(/^\//, ""));
        const hasPage = ["page.tsx", "page.ts"].some((name) => {
          try {
            return statSync(path.join(onDisk, name)).isFile();
          } catch {
            return false;
          }
        });
        if (!hasPage) {
          dead.push(`${path.relative(process.cwd(), file)} → ${routePath}`);
        }
      }
    }

    expect(dead).toEqual([]);
  });
});
