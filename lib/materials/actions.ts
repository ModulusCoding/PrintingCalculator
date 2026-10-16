"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AuthContextError, requireBusinessContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { calculateCostPerGram } from "./format";
import { escapePostgrestIlike, fieldErrors, parsePtBrDecimal } from "./validation";

export type MaterialRecord = {
  id: string;
  name: string;
  material_type: string;
  brand: string | null;
  color: string | null;
  reference_weight_grams: string;
  reference_price: string;
  cost_per_gram: string;
  active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
};

export type MaterialResult =
  | { status: "success"; materialId: string; version: number }
  | { status: "invalid_input"; message: string; fieldErrors: Record<string, string[]> }
  | {
      status:
        | "session_expired"
        | "permission_denied"
        | "material_unavailable"
        | "version_conflict"
        | "technical"
        | "unknown_result";
      message: string;
      fieldErrors: Record<string, string[]>;
    };

const inputSchema = z
  .object({
    name: z.string().trim().min(2, "O nome deve ter entre 2 e 120 caracteres.").max(120, "O nome deve ter entre 2 e 120 caracteres."),
    materialType: z.string().trim().min(1, "O tipo do material é obrigatório.").max(80, "O tipo deve ter até 80 caracteres."),
    brand: z.string().trim().max(120, "A marca deve ter até 120 caracteres.").optional().default(""),
    color: z.string().trim().max(80, "A cor deve ter até 80 caracteres.").optional().default(""),
    referenceWeightGrams: z.string(),
    referencePrice: z.string(),
  })
  .strict();

const uuid = z.string().uuid();
const version = z.number().int().nonnegative().safe();
const numeric = z.union([
  z.string().regex(/^\d+(?:\.\d+)?$/),
  z.number().finite().nonnegative(),
]);

const recordSchema = z
  .object({
    id: uuid,
    name: z.string(),
    material_type: z.string(),
    brand: z.string().nullable(),
    color: z.string().nullable(),
    reference_weight_grams: numeric,
    reference_price: numeric,
    active: z.boolean(),
    version: version,
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();

const rpcRowSchema = z
  .object({
    status: z.enum([
      "success",
      "invalid_input",
      "session_expired",
      "permission_denied",
      "material_unavailable",
      "version_conflict",
    ]),
    material_id: uuid.nullable(),
    version: version.nullable(),
  })
  .strict();

const normalize = (row: z.infer<typeof recordSchema>): MaterialRecord => {
  const priceStr = String(row.reference_price);
  const weightStr = String(row.reference_weight_grams);
  return {
    ...row,
    reference_price: priceStr,
    reference_weight_grams: weightStr,
    cost_per_gram: calculateCostPerGram(priceStr, weightStr),
  };
};

function validate(payload: unknown): { errors: Record<string, string[]> } | { data: { name: string; materialType: string; brand: string | null; color: string | null; referenceWeightGrams: string; referencePrice: string } } {
  const parsed = inputSchema.safeParse(payload);
  if (!parsed.success) {
    return { errors: fieldErrors(parsed.error) };
  }

  const weightResult = parsePtBrDecimal(parsed.data.referenceWeightGrams, 0.001, 100000, 3);
  if ("error" in weightResult) {
    return { errors: { referenceWeightGrams: [weightResult.error ?? "Valor inválido."] } };
  }

  const priceResult = parsePtBrDecimal(parsed.data.referencePrice, 0, 1000000, 2);
  if ("error" in priceResult) {
    return { errors: { referencePrice: [priceResult.error ?? "Valor inválido."] } };
  }

  return {
    data: {
      name: parsed.data.name,
      materialType: parsed.data.materialType,
      brand: parsed.data.brand || null,
      color: parsed.data.color || null,
      referenceWeightGrams: weightResult.value,
      referencePrice: priceResult.value,
    },
  };
}

const messages = {
  session_expired: "Sua sessão expirou. Entre novamente.",
  permission_denied: "Você não tem permissão para realizar esta operação.",
  material_unavailable: "Material não encontrado ou indisponível.",
  version_conflict: "O material foi alterado por outra pessoa. Recarregue a página.",
  technical: "Erro técnico. Tente novamente.",
  unknown_result: "Não foi possível confirmar o resultado da operação.",
} as const;

function resultFailure(status: keyof typeof messages): MaterialResult {
  return { status, message: messages[status], fieldErrors: {} };
}

function failure(error: unknown): MaterialResult {
  if (error instanceof AuthContextError) {
    if (error.code === "AUTH_UNAUTHENTICATED") return resultFailure("session_expired");
    if (error.code === "AUTH_ACCESS_BLOCKED" || error.code === "AUTH_PERMISSION_DENIED") {
      return resultFailure("permission_denied");
    }
  }
  return resultFailure("technical");
}

function refresh(id?: string) {
  try {
    revalidatePath("/materiais");
    if (id) revalidatePath(`/materiais/${id}`);
  } catch {
    // The committed RPC result remains successful.
  }
}

const listParamsSchema = z
  .object({
    search: z.string().trim().max(200).optional().default(""),
    status: z.enum(["active", "archived", "all"]).optional().default("active"),
    page: z.string().regex(/^[1-9]\d{0,3}$/).optional().default("1"),
  })
  .strict();

export async function listMaterials(params: Record<string, string | undefined> = {}) {
  const checkedParams = listParamsSchema.safeParse(params);
  if (!checkedParams.success) {
    return {
      materials: [], total: 0, page: 1, status: "active", search: "",
      error: "invalid_input",
    };
  }

  try {
    const c = await requireBusinessContext("materials.read");
    const { search, status } = checkedParams.data;
    const requested = Number(checkedParams.data.page);
    const s = await createClient();

    let countQuery = s
      .from("materials")
      .select("id", { count: "exact", head: true })
      .eq("enterprise_id", c.enterpriseId);

    if (status === "active") countQuery = countQuery.eq("active", true);
    if (status === "archived") countQuery = countQuery.eq("active", false);

    const term = search ? JSON.stringify(`%${escapePostgrestIlike(search)}%`) : "";
    if (term) {
      countQuery = countQuery.or(
        `name.ilike.${term},material_type.ilike.${term},brand.ilike.${term},color.ilike.${term}`
      );
    }

    const { count, error: countError } = await countQuery;
    if (countError) throw countError;

    const total = count || 0;
    const page = Math.min(requested, Math.max(1, Math.ceil(total / 20)));

    let rowsQuery = s
      .from("materials")
      .select(
        "id,name,material_type,brand,color,reference_weight_grams,reference_price,active,version,created_at,updated_at"
      )
      .eq("enterprise_id", c.enterpriseId);

    if (status === "active") rowsQuery = rowsQuery.eq("active", true);
    if (status === "archived") rowsQuery = rowsQuery.eq("active", false);
    if (term) {
      rowsQuery = rowsQuery.or(
        `name.ilike.${term},material_type.ilike.${term},brand.ilike.${term},color.ilike.${term}`
      );
    }

    const { data, error } = await rowsQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * 20, page * 20 - 1);

    if (error) throw error;

    return {
      materials: (data || []).map((row: unknown) => normalize(recordSchema.parse(row))),
      total,
      page,
      status,
      search,
      error: null,
    };
  } catch (e) {
    return {
      materials: [],
      total: 0,
      page: 1,
      status: "active",
      search: "",
      error: failure(e).status,
    };
  }
}

export async function getMaterial(id: string) {
  if (!uuid.safeParse(id).success) return { material: null, error: "material_unavailable" };
  try {
    const c = await requireBusinessContext("materials.read");
    const { data, error } = await (await createClient())
      .from("materials")
      .select(
        "id,name,material_type,brand,color,reference_weight_grams,reference_price,active,version,created_at,updated_at"
      )
      .eq("enterprise_id", c.enterpriseId)
      .eq("id", id)
      .maybeSingle();

    if (error || !data) {
      return { material: null, error: error ? "technical" : "material_unavailable" };
    }
    return { material: normalize(recordSchema.parse(data)), error: null };
  } catch (e) {
    return { material: null, error: failure(e).status };
  }
}

async function mutate(
  method: string,
  args: Record<string, unknown>,
  permission: "materials.write" | "materials.archive",
  id?: string
): Promise<MaterialResult> {
  let client: Awaited<ReturnType<typeof createClient>>;
  try {
    await requireBusinessContext(permission);
    client = await createClient();
  } catch (error) {
    return failure(error);
  }

  try {
    const { data, error } = await client.rpc(method, args);
    if (error) return resultFailure("unknown_result");
    if (!Array.isArray(data) || data.length !== 1) return resultFailure("unknown_result");
    const parsed = rpcRowSchema.safeParse(data[0]);
    if (!parsed.success) return resultFailure("unknown_result");
    const row = parsed.data;

    if (row.status === "success") {
      if (row.material_id === null || row.version === null || (id !== undefined && row.material_id !== id)) {
        return resultFailure("unknown_result");
      }
      refresh(row.material_id);
      return { status: "success", materialId: row.material_id, version: row.version };
    }

    if (row.material_id !== null || row.version !== null) {
      return resultFailure("unknown_result");
    }
    if (row.status === "invalid_input") {
      return { status: "invalid_input", message: "Confira os campos indicados.", fieldErrors: {} };
    }
    return resultFailure(row.status);
  } catch {
    return resultFailure("unknown_result");
  }
}

export async function createMaterial(payload: unknown): Promise<MaterialResult> {
  const v = validate(payload);
  if ("errors" in v) return { status: "invalid_input", message: "Confira os campos indicados.", fieldErrors: v.errors ?? {} };
  return mutate(
    "create_my_material",
    {
      p_name: v.data.name,
      p_material_type: v.data.materialType,
      p_brand: v.data.brand,
      p_color: v.data.color,
      p_reference_weight_grams: v.data.referenceWeightGrams,
      p_reference_price: v.data.referencePrice,
    },
    "materials.write"
  );
}

export async function updateMaterial(id: string, expectedVersion: number, payload: unknown): Promise<MaterialResult> {
  if (!uuid.safeParse(id).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
    return resultFailure("material_unavailable");
  }
  const v = validate(payload);
  if ("errors" in v) return { status: "invalid_input", message: "Confira os campos indicados.", fieldErrors: v.errors ?? {} };
  return mutate(
    "update_my_material",
    {
      p_id: id,
      p_expected_version: expectedVersion,
      p_name: v.data.name,
      p_material_type: v.data.materialType,
      p_brand: v.data.brand,
      p_color: v.data.color,
      p_reference_weight_grams: v.data.referenceWeightGrams,
      p_reference_price: v.data.referencePrice,
    },
    "materials.write",
    id
  );
}

export async function setMaterialActive(id: string, expectedVersion: number, active: boolean): Promise<MaterialResult> {
  if (!uuid.safeParse(id).success || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || typeof active !== "boolean") {
    return resultFailure("material_unavailable");
  }
  return mutate(
    "set_my_material_active",
    {
      p_id: id,
      p_expected_version: expectedVersion,
      p_active: active,
    },
    "materials.archive",
    id
  );
}
