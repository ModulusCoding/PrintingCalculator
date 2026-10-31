import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { requireBusinessContext } from "@/lib/auth/context";
import { createLogger } from "@/lib/general-materials/logger";
import { safeErrorDiagnostic } from "@/lib/diagnostics/safe-error";
import type { PlanAccessState } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { dashboardSchema, inventorySchema, spoolsSchema, type ReadResult, type StockResult } from "./schema";

const safeCount = z.union([z.number(), z.string().regex(/^\d+$/)]).transform(Number).pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));

// Log only sanitized diagnostics, never arguments, rows, credentials or response payloads.
async function diagnose<T>(operation: string, stage: "context" | "rpc" | "interpretation", load: () => T | Promise<T>): Promise<T> {
  try { return await load(); }
  catch (error) {
    unstable_rethrow(error);
    createLogger("dashboard", operation).error({ stage, ...safeErrorDiagnostic(error) });
    throw error;
  }
}

async function read<T>(operation: string, schema: z.ZodType<T>, load: () => Promise<unknown>, message: string): Promise<ReadResult<T>> {
  try {
    const data = await load();
    return { status: "ready", data: await diagnose(operation, "interpretation", () => schema.parse(data)) };
  }
  catch (error) { unstable_rethrow(error); return { status: "error", message }; }
}

export async function loadHomeDashboard(plan: PlanAccessState) {
  const context = await diagnose("sales.read", "context", () => requireBusinessContext("sales.read"));
  const client = await diagnose("create_session_client", "context", () => createClient());
  async function rpc(name: string, args = {}) {
    return diagnose(name, "rpc", async () => {
      const { data, error } = await client.rpc(name, args);
      if (error) throw error;
      return data as unknown;
    });
  }
  function tenant<T extends { enterprise_id: string }>(data: T): T {
    if (data.enterprise_id !== context.enterpriseId) throw new Error("dashboard_tenant_mismatch");
    return data;
  }
  const financePromise = read("get_home_dashboard", dashboardSchema, async () => {
    const data = await rpc("get_home_dashboard");
    return diagnose("get_home_dashboard", "interpretation", () => tenant(dashboardSchema.parse(data)));
  }, "Não foi possível carregar vendas, recebimentos e pedidos. Tente atualizar a página. Se o problema persistir, solicite a verificação das consultas do dashboard.");
  async function stock(): Promise<StockResult> {
    // Never start a physical-stock query for Aprendiz. RPCs independently revalidate plan/permission.
    if (plan.effective_plan !== "intermediate" || plan.access_state !== "paid") return { status: "free" };
    const inventory = read("get_home_inventory", inventorySchema, async () => {
      const authorized = await diagnose("inventory.read", "context", () => requireBusinessContext("inventory.read"));
      await diagnose("inventory_tenant", "interpretation", () => {
        if (authorized.enterpriseId !== context.enterpriseId) throw new Error("dashboard_tenant_mismatch");
      });
      const payload = await rpc("get_home_inventory");
      return diagnose("get_home_inventory", "interpretation", () => tenant(inventorySchema.parse(payload)));
    }, "Não foi possível ler os saldos de produtos prontos.");
    const spools = read("home_spools", spoolsSchema, async () => {
      const authorized = await diagnose("spools.read", "context", () => requireBusinessContext("spools.read"));
      await diagnose("spools_tenant", "interpretation", () => {
        if (authorized.enterpriseId !== context.enterpriseId) throw new Error("dashboard_tenant_mismatch");
      });
      const [low, empty, config] = await Promise.all([
        rpc("count_filament_spools", { p_search: "", p_status: "low" }),
        rpc("count_filament_spools", { p_search: "", p_status: "empty" }),
        rpc("get_my_spool_config"),
      ]);
      return diagnose("home_spools", "interpretation", () => {
        const configuration = z.array(z.object({ low_spool_threshold_percent: z.union([z.number(), z.string()]).transform(Number).pipe(z.number().finite().min(0).max(100)), version: safeCount }).strict()).length(1).parse(config)[0];
        return { enterprise_id: context.enterpriseId, low_count: safeCount.parse(low), empty_count: safeCount.parse(empty), threshold_percent: configuration.low_spool_threshold_percent };
      });
    }, "Não foi possível ler os alertas de carretéis.");
    const [inventoryResult, spoolsResult] = await Promise.all([inventory, spools]);
    return { status: "paid", inventory: inventoryResult, spools: spoolsResult };
  }
  const [finance, stockResult] = await Promise.all([financePromise, stock()]);
  return { finance, stock: stockResult };
}
