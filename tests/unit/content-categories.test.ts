import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editing a category, and what the audit row can answer afterwards.
 *
 * WHY THESE AND NOT A FORM TEST. The screen is a client component and its fields are
 * uninteresting; what matters is the three answers `setCategoryContent` gives, because
 * each one decides what the only record of a category edit says. There is no revisions
 * table here — `categories` is already the live source — so the append-only
 * `security_events` row IS the history, and it is built from `changed`.
 *
 * `{}` AND `null` ARE DIFFERENT ANSWERS AND MUST STAY SO. `{}` is "somebody pressed Save
 * and altered nothing", which is ordinary; `null` is "we changed a category and cannot
 * say what it used to say". Rule 6 — and collapsing them would turn an unreadable
 * previous row into a confident "no change" in the audit trail.
 */

const maybeSingle = vi.fn();
const update = vi.fn();
const createAdminClient = vi.fn();
const hasSupabaseConfig = vi.fn(() => true);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createAdminClient(),
}));
vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => hasSupabaseConfig() }));
vi.mock("next/cache", () => ({ unstable_cache: <T,>(fn: T) => fn }));

const ROW = {
  name_en: "Plumbing",
  name_ne: "प्लम्बिङ",
  descriptor: "Leaks, blocked drains, fittings",
  descriptor_ne: "चुहावट, जाम, फिटिङ",
  description: "Taps, pipes, drains.",
  description_ne: "धारा, पाइप, ढल।",
  cta_label: "plumbing",
  cta_label_ne: "प्लम्बिङ",
  icon: "Wrench",
  sort_order: 1,
};

/** The same values as the stored row, as the form submits them. */
const unchangedInput = {
  slug: "plumbing",
  nameEn: ROW.name_en,
  nameNe: ROW.name_ne,
  descriptor: ROW.descriptor,
  descriptorNe: ROW.descriptor_ne,
  description: ROW.description,
  descriptionNe: ROW.description_ne,
  ctaLabel: ROW.cta_label,
  ctaLabelNe: ROW.cta_label_ne,
  icon: ROW.icon,
  sortOrder: ROW.sort_order,
  actorId: "admin-1",
};

/**
 * THE FAKE PROJECTS THE COLUMNS IT WAS ASKED FOR, and that is what makes these cases
 * able to see the column list at all. The first version returned the whole row whatever
 * the select said, so a case written to catch a column missing from the query passed with
 * the column removed — a test asserting against its own mock rather than against the
 * code. PostgREST returns only what you select, so this does too, and a column left out
 * of the list reads as `undefined` here exactly as it would in production.
 */
function projecting(columns: string) {
  const wanted = columns.split(",").map((c) => c.trim());
  const row = maybeSingle();
  if (!row || typeof row !== "object" || !("data" in row)) return row;
  const data = (row as { data: Record<string, unknown> | null }).data;
  if (!data) return row;
  return {
    ...row,
    data: Object.fromEntries(wanted.filter((c) => c in data).map((c) => [c, data[c]])),
  };
}

beforeEach(() => {
  vi.resetModules();
  maybeSingle.mockReset();
  update.mockReset();
  hasSupabaseConfig.mockReturnValue(true);
  update.mockResolvedValue({ error: null });
  createAdminClient.mockReturnValue({
    from: () => ({
      select: (columns: string) => ({
        eq: () => ({ maybeSingle: () => projecting(columns) }),
      }),
      update: (values: unknown) => ({ eq: () => update(values) }),
    }),
  });
});

describe("editing a category", () => {
  it("records every field that moved, with what it used to say", async () => {
    maybeSingle.mockReturnValue({ data: ROW, error: null });
    const { setCategoryContent } = await import("@/lib/data/content");

    const result = await setCategoryContent({
      ...unchangedInput,
      nameEn: "Plumbing and drains",
      icon: "Droplets",
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toEqual({
      name_en: { from: "Plumbing", to: "Plumbing and drains" },
      icon: { from: "Wrench", to: "Droplets" },
    });
  });

  /*
   * EVERY EDITABLE FIELD AT ONCE, which is what keeps the written-out select column list
   * honest. `check:columns` refuses a select built from `Object.keys(...)` — it cannot
   * read one statically — so the list in the query and the fields in the update are two
   * lists written separately. A column missing from the query reads as `undefined`, so it
   * reports as changed FROM nothing on every save, and an identical form would write. The
   * case below and the identical-form case below it are both red if the lists drift.
   */
  it("can report every field the form offers", async () => {
    maybeSingle.mockReturnValue({ data: ROW, error: null });
    const { setCategoryContent } = await import("@/lib/data/content");

    const result = await setCategoryContent({
      slug: "plumbing",
      nameEn: "a",
      nameNe: "ब",
      descriptor: "c",
      descriptorNe: "ड",
      description: "e",
      descriptionNe: "फ",
      ctaLabel: "g",
      ctaLabelNe: "ह",
      icon: "Droplets",
      sortOrder: 9,
      actorId: "admin-1",
    });

    expect(Object.keys(result.changed ?? {}).sort()).toEqual(
      [
        "cta_label",
        "cta_label_ne",
        "description",
        "description_ne",
        "descriptor",
        "descriptor_ne",
        "icon",
        "name_en",
        "name_ne",
        "sort_order",
      ].sort(),
    );
  });

  /*
   * NOTHING CHANGED MEANS NOTHING WRITTEN. An UPDATE here would be harmless on its own;
   * the cost is the audit row behind it, which would claim an edit that did not happen
   * and make every real one harder to find in the timeline.
   */
  it("writes nothing when the form comes back identical", async () => {
    maybeSingle.mockReturnValue({ data: ROW, error: null });
    const { setCategoryContent } = await import("@/lib/data/content");

    const result = await setCategoryContent(unchangedInput);

    expect(result.ok).toBe(true);
    expect(result.changed).toEqual({});
    expect(update).not.toHaveBeenCalled();
  });

  it("says it could not tell rather than saying nothing changed", async () => {
    maybeSingle.mockReturnValue({ data: null, error: { message: "timeout" } });
    const { setCategoryContent } = await import("@/lib/data/content");

    const result = await setCategoryContent({ ...unchangedInput, nameEn: "Drains" });

    expect(result.ok).toBe(true);
    // Null, never {} — an unreadable previous row is not a quiet "no change".
    expect(result.changed).toBeNull();
    expect(update).toHaveBeenCalled();
  });

  /*
   * THE ICON IS REFUSED BEFORE ANYTHING IS READ OR WRITTEN. The check constraint is what
   * actually stops a blank tile on the landing grid, and this is what turns the refusal
   * into a sentence instead of a lost save.
   */
  it("refuses an icon no card can draw, without touching the table", async () => {
    const { setCategoryContent } = await import("@/lib/data/content");

    const result = await setCategoryContent({ ...unchangedInput, icon: "NotAnIcon" });

    expect(result).toEqual({ ok: false, reason: "badIcon" });
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses an empty name in either language", async () => {
    maybeSingle.mockReturnValue({ data: ROW, error: null });
    const { setCategoryContent } = await import("@/lib/data/content");

    expect(await setCategoryContent({ ...unchangedInput, nameEn: "   " })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(await setCategoryContent({ ...unchangedInput, nameNe: "" })).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(update).not.toHaveBeenCalled();
  });
});
