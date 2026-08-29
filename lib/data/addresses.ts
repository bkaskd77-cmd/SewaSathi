import "server-only";

import { z } from "zod";

import { AREA_KEYS, findArea } from "@/lib/config/areas";
import { describeError } from "@/lib/data/source";
import { hasSupabaseConfig } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Customer addresses.
 *
 * Nepal addressing is landmark-based — there is no house number a stranger on
 * a motorbike can use — so `landmark` is required here and NOT NULL in the
 * table. The helper line in the form says why, because a required field with
 * no explanation reads as bureaucracy.
 *
 * `city` and `wardNumber` are written from the area key at save time rather
 * than joined. The ward list is a config file that will grow as we add cities,
 * and an address that silently re-points at a different ward when that file is
 * edited is worse than one that remembers where it was.
 */

export type Address = {
  id: string;
  label: string;
  areaKey: string;
  city: string;
  wardNumber: number;
  tole: string;
  landmark: string;
  directionsNote: string | null;
  isDefault: boolean;
};

export type AddressErrors = Partial<
  Record<"label" | "area" | "tole" | "landmark" | "directionsNote" | "form", string>
>;

export type AddressInput = {
  label?: string;
  area: string;
  tole: string;
  landmark: string;
  directionsNote?: string;
  saveForNextTime?: boolean;
};

const schema = z.object({
  label: z.string().trim().min(1).max(40).default("home"),
  area: z.string().refine((v) => AREA_KEYS.includes(v)),
  tole: z.string().trim().min(2).max(80),
  landmark: z.string().trim().min(2).max(120),
  directionsNote: z.string().trim().max(300).optional(),
});

export function validateAddress(input: AddressInput): {
  ok: boolean;
  errors: AddressErrors;
} {
  const errors: AddressErrors = {};
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === "label") errors.label = "labelLength";
      if (field === "area") errors.area = "pickArea";
      if (field === "tole") errors.tole = "toleTooShort";
      if (field === "landmark") errors.landmark = "landmarkRequired";
      if (field === "directionsNote") errors.directionsNote = "directionsTooLong";
    }
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

const COLUMNS =
  "id, label, area_key, city, ward_number, tole, landmark, directions_note, is_default";

function rowToAddress(row: Record<string, unknown>): Address {
  return {
    id: row.id as string,
    label: row.label as string,
    areaKey: row.area_key as string,
    city: row.city as string,
    wardNumber: row.ward_number as number,
    tole: row.tole as string,
    landmark: row.landmark as string,
    directionsNote: (row.directions_note as string | null) ?? null,
    isDefault: Boolean(row.is_default),
  };
}

/**
 * The signed-in customer's saved addresses, default first.
 *
 * No seed fallback. An empty list is a correct answer for a new customer, and
 * inventing somebody's home address would be a lie about their own life rather
 * than a gap in a catalogue.
 */
export async function listAddresses(): Promise<Address[]> {
  if (!hasSupabaseConfig()) return [];

  try {
    const { data, error } = await createClient()
      .from("addresses")
      .select(COLUMNS)
      .order("is_default", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(10);

    if (error) {
      console.error(`[addresses] list failed — ${describeError(error)}`);
      return [];
    }
    return (data ?? []).map((row) =>
      rowToAddress(row as Record<string, unknown>),
    );
  } catch (thrown) {
    console.error(`[addresses] list threw — ${describeError(thrown)}`);
    return [];
  }
}

export async function getAddress(id: string): Promise<Address | null> {
  if (!hasSupabaseConfig()) return null;
  try {
    const { data, error } = await createClient()
      .from("addresses")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return rowToAddress(data as Record<string, unknown>);
  } catch {
    return null;
  }
}

export type CreateAddressResult =
  | { ok: true; id: string }
  | { ok: false; errors: AddressErrors };

export async function createAddress(
  input: AddressInput,
  profileId: string,
): Promise<CreateAddressResult> {
  const check = validateAddress(input);
  if (!check.ok) return { ok: false, errors: check.errors };

  const parsed = schema.parse(input);
  const area = findArea(parsed.area);
  if (!area) return { ok: false, errors: { area: "pickArea" } };

  if (!hasSupabaseConfig()) {
    console.warn("[addresses] no Supabase config — address not stored");
    return { ok: true, id: "local-preview" };
  }

  const supabase = createClient();

  try {
    // The first address a customer saves is their default. A partial unique
    // index enforces one default per person, so this clears the old one first
    // rather than relying on the insert to win a race with itself.
    const makeDefault = input.saveForNextTime !== false;
    if (makeDefault) {
      await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("profile_id", profileId)
        .eq("is_default", true);
    }

    const { data, error } = await supabase
      .from("addresses")
      .insert({
        profile_id: profileId,
        label: parsed.label,
        area_key: area.key,
        city: area.city,
        ward_number: area.wardNumber,
        tole: parsed.tole,
        landmark: parsed.landmark,
        directions_note: parsed.directionsNote || null,
        is_default: makeDefault,
      })
      .select("id")
      .single();

    if (error || !data) {
      console.error(`[addresses] insert failed — ${describeError(error)}`);
      return { ok: false, errors: { form: "saveFailed" } };
    }
    return { ok: true, id: data.id as string };
  } catch (thrown) {
    console.error(`[addresses] insert threw — ${describeError(thrown)}`);
    return { ok: false, errors: { form: "saveFailed" } };
  }
}
