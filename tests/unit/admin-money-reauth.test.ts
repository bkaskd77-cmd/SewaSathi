import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import {
  ADMIN_MONEY_WRITES,
  MONEY_MODULES,
  moneyWriteFor,
} from "@/lib/config/admin-money";

/**
 * An admin action that moves money asks for a fresh second factor first.
 *
 * THE HOLE THIS CLOSES WAS FOUND BY AUDIT, which is the slowest detector there
 * is and runs once. `/admin/payouts` has needed a fifteen-minute proof since it
 * shipped; six other actions moved real rupees behind the eight-hour
 * `STEP_UP_HOURS` window, `sendRefundToGateway` — which initiates a transfer —
 * among them. Nothing in the repository could see the difference, because
 * "this one moves money" was a fact about the product that lived only in
 * somebody's head.
 *
 * READ THROUGH THE TYPESCRIPT AST, NEVER A REGEX. `check:keys` is the precedent
 * and the reason is the same: three regex versions of that checker were written
 * first and each cried wolf, defeated in turn by a rebound name, by two
 * declarations binding the same identifier, and by a destructured
 * `Promise.all`. A checker that reports things that are fine gets skimmed, and
 * the one real entry goes with the noise.
 *
 * THE COVERAGE HALF IS WHAT KEEPS IT ALIVE. Asserting the eleven declared
 * writers are gated proves nothing about the twelfth. So any function an admin
 * action imports from one of `MONEY_MODULES` and nobody has declared is a
 * failure in itself — the question "does this move money?" is then asked while
 * the action is being written, which is the only time it is cheap.
 *
 * WHAT IT DOES NOT PROVE, said plainly: that the refusal is respected. A file
 * could call `freshAdminActor()` and ignore the answer. That is the same honest
 * limit `admin-gate-coverage.test.ts` states, and the failure that actually
 * happens is somebody writing an action without thinking about the window at
 * all.
 */

type Problem = { action: string; detail: string };

const ADMIN_DIR = "app/[locale]/(admin)";

/** The two helpers that satisfy a declaration, by the name the source calls. */
const FRESH_GATE = "freshAdminActor";
const THREADED_PROOF = "sessionAuthenticatedAt";

/**
 * Every problem one source file has, or an empty list.
 *
 * Exported shape rather than an inline loop so the self-test below can run the
 * identical analysis over a string. A scanner that has quietly stopped scanning
 * and a clean tree print the same tick, which is `check:secrets`' rule.
 */
function audit(fileName: string, text: string): Problem[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  /** Local name → the money module it came from. */
  const fromMoney = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!MONEY_MODULES.includes(specifier)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      /* The ORIGINAL name, not the local alias: `import { issueRefund as pay }`
         is still `issueRefund`, and a declaration keyed on the alias would be a
         rename away from being skipped. */
      const imported = (element.propertyName ?? element.name).text;
      fromMoney.set(element.name.text, imported);
    }
  }
  if (fromMoney.size === 0) return [];

  const problems: Problem[] = [];

  for (const fn of exportedFunctions(source)) {
    const called = calledNames(fn.body);
    for (const local of called) {
      const imported = fromMoney.get(local);
      if (!imported) continue;

      const write = moneyWriteFor(imported);
      if (!write) {
        problems.push({
          action: fn.name,
          detail: `calls ${imported}, which comes out of a money module and is not declared in lib/config/admin-money.ts. Say whether it moves money and how its proof arrives.`,
        });
        continue;
      }

      if (write.proof === "fresh-actor" && !called.has(FRESH_GATE)) {
        problems.push({
          action: fn.name,
          detail: `calls ${imported} without ${FRESH_GATE}() — the eight-hour admin window is not enough for this one. ${write.why}`,
        });
      }
      if (write.proof === "threaded" && !called.has(THREADED_PROOF)) {
        problems.push({
          action: fn.name,
          detail: `calls ${imported} without reading ${THREADED_PROOF}() — the data layer is expecting the proof to arrive as an argument.`,
        });
      }
    }
  }

  return problems;
}

describe("the money-moving admin actions are behind a fresh second factor", () => {
  const files = adminActionFiles();

  it("finds the action files at all", () => {
    /* The check that stops every assertion below passing over an empty list,
       which is how a glob that stopped matching reads as a clean tree. */
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((f) => f.endsWith("payouts/actions.ts"))).toBe(true);
  });

  it("gates every declared money write, and declares every one it reaches", () => {
    const problems = files.flatMap((file) =>
      audit(file, readFileSync(file, "utf8")).map(
        (p) => `${file} · ${p.action}: ${p.detail}`,
      ),
    );
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("still bites when an action drops the gate", () => {
    const problems = audit(
      "fake/actions.ts",
      `
        import { adminActor } from "@/lib/auth/admin-gate";
        import { issueRefund } from "@/lib/data/claims";

        export async function issueRefundAction(data: FormData) {
          const profile = await adminActor();
          if (!profile) return { ok: false };
          return issueRefund({ claimId: String(data.get("claimId")), actorId: profile.id });
        }
      `,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].action).toBe("issueRefundAction");
    expect(problems[0].detail).toContain(FRESH_GATE);
  });

  it("still bites when a money-module function nobody declared is reached", () => {
    const problems = audit(
      "fake/actions.ts",
      `
        import { freshAdminActor } from "@/lib/auth/admin-gate";
        import { payEverybodyTwice } from "@/lib/data/payouts";

        export async function generousAction() {
          const gate = await freshAdminActor();
          if (!gate.ok) return { ok: false };
          return payEverybodyTwice();
        }
      `,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("not declared");
  });

  it("is not fooled by an alias on the import", () => {
    /* The reason the original name is read rather than the local one. Keyed on
       the alias, this file would have no declaration to look up and the gate
       would silently stop applying. */
    const problems = audit(
      "fake/actions.ts",
      `
        import { adminActor } from "@/lib/auth/admin-gate";
        import { issueRefund as pay } from "@/lib/data/claims";

        export async function sneaky() {
          const profile = await adminActor();
          return pay({ actorId: profile?.id });
        }
      `,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0].detail).toContain("issueRefund");
  });

  it("asks nothing of an action that touches no money module", () => {
    expect(
      audit(
        "fake/actions.ts",
        `
          import { adminActor } from "@/lib/auth/admin-gate";
          import { setCategoryContent } from "@/lib/data/content";

          export async function editAction(data: FormData) {
            const profile = await adminActor();
            if (!profile) return { ok: false };
            return setCategoryContent({ slug: String(data.get("slug")) });
          }
        `,
      ),
    ).toEqual([]);
  });
});

describe("the declaration itself", () => {
  it("names a real money module for every write", () => {
    for (const write of ADMIN_MONEY_WRITES) {
      expect(
        MONEY_MODULES,
        `${write.fn} is declared against ${write.module}`,
      ).toContain(write.module);
    }
  });

  it("gives a reason for every one, including the ones that need no code", () => {
    /* `none` is the entry worth insisting on: it is a decision not to ask, and a
       decision with no reason beside it is indistinguishable from an omission —
       which is exactly what the six ungated actions looked like. */
    for (const write of ADMIN_MONEY_WRITES) {
      expect(
        write.why.length,
        `${write.fn} has no reason recorded`,
      ).toBeGreaterThan(40);
    }
  });

  it("declares each function once", () => {
    const names = ADMIN_MONEY_WRITES.map((w) => w.fn);
    expect(new Set(names).size).toBe(names.length);
  });

  it("describes functions that still exist", async () => {
    /* A declaration for a function somebody deleted is a rule guarding nothing,
       and it reads from the list exactly like a rule that bites. */
    for (const write of ADMIN_MONEY_WRITES) {
      const path = write.module.replace("@/", "") + ".ts";
      const source = readFileSync(
        new URL(`../../${path}`, import.meta.url),
        "utf8",
      );
      expect(
        source,
        `${write.fn} is declared and ${path} does not export it`,
      ).toContain(`export async function ${write.fn}`);
    }
  });
});

/* ------------------------------------------------------------------ */

function adminActionFiles(): string[] {
  const root = fileURLToPath(new URL(`../../${ADMIN_DIR}/`, import.meta.url));
  const out: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "actions.ts") out.push(path);
    }
  }

  walk(root);
  return out.sort();
}

/** Every exported function in a source file, however it is written. */
function exportedFunctions(
  source: ts.SourceFile,
): { name: string; body: ts.Node }[] {
  const out: { name: string; body: ts.Node }[] = [];

  for (const statement of source.statements) {
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;

    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name &&
      statement.body
    ) {
      out.push({ name: statement.name.text, body: statement.body });
      continue;
    }

    /* `export const x = async () => {}` — not the house style for an action
       today, and the one shape a reader would reach for next. */
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
          continue;
        const init = declaration.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          out.push({ name: declaration.name.text, body: init.body });
        }
      }
    }
  }

  return out;
}

/** The plain identifiers this body calls — `a()`, never `a.b()`. */
function calledNames(body: ts.Node): Set<string> {
  const out = new Set<string>();

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      out.add(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(body);
  return out;
}
