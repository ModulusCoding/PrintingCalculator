"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resolveMinimalIdentity } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

export type SelectFreePlanResult = {
  status: "selected" | "no_change" | "conflict" | "error" | "uncertain";
  message: string;
};

const selectionResponse = z.array(z.object({
  status: z.enum(["selected", "no_change", "conflict"]),
}).strict()).length(1);

export async function selectInitialFreePlan(): Promise<SelectFreePlanResult> {
  // Deliberately use the identity guard, not the operational plan guard:
  // selecting the first plan must work before operational access is granted.
  try {
    const identity = await resolveMinimalIdentity();
    if (identity.state !== "business_ready") {
      return { status: "error", message: "Sua sessão precisa ser validada. Acesse Minha conta ou entre novamente." };
    }
    if (identity.role !== "owner") {
      return { status: "error", message: "Somente o proprietário pode escolher o plano da empresa." };
    }
  } catch {
    return { status: "error", message: "Não foi possível validar sua sessão. Nenhuma solicitação de escolha foi enviada. Tente novamente." };
  }

  const uncertain: SelectFreePlanResult = {
    status: "uncertain",
    message: "Não foi possível confirmar o resultado. Consulte Meu plano ou tente novamente: a repetição desta escolha é segura e não gera cobrança.",
  };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("select_initial_free_plan");
    if (error) {
      // SQL exceptions are explicit rejections; transport/gateway failures may
      // arrive after the transaction committed and must not imply rollback.
      if (/^(22|23|28|42|P0)/.test(error.code ?? "")) {
        return { status: "error", message: "A escolha não foi aceita. Atualize a página e verifique sua conta antes de tentar novamente." };
      }
      return uncertain;
    }
    const parsed = selectionResponse.safeParse(data);
    if (!parsed.success) return uncertain;
    const status = parsed.data[0].status;
    if (status === "conflict") {
      return { status, message: "O plano mudou enquanto você fazia a escolha. Atualizamos os dados; consulte Meu plano antes de continuar." };
    }
    revalidatePath("/", "layout");
    return {
      status,
      message: status === "selected"
        ? "Plano Aprendiz escolhido com sucesso. Você já pode acessar o início."
        : "Sua escolha já estava registrada. Nenhuma alteração foi feita. Consulte Meu plano ou acesse o início.",
    };
  } catch {
    return uncertain;
  }
}
