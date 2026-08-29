"use server";

import { createClient } from "@/lib/supabase/server";
import { closedSaleSchema } from "@/lib/validations";
import {
  rateLimitSaleCreate,
  rateLimitSaleUpdate,
  rateLimitSaleDelete,
} from "@/lib/rate-limit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

export interface SalesFilterOptions {
  search?: string;
  cliente?: string;
  tipo_produto?: string;
  canal_abordagem?: string;
  canal_fechamento?: string;
  status?: string | string[];
  sort?: "recent" | "oldest" | "highest_value" | "lowest_value";
}

export async function getSales(filters?: SalesFilterOptions) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { sales: [], error: "Não autorizado." };
    }

    let query = supabase.from("closed_sales").select("*");

    if (filters?.tipo_produto) {
      query = query.eq("tipo_produto", filters.tipo_produto);
    }
    if (filters?.canal_abordagem) {
      query = query.eq("canal_abordagem", filters.canal_abordagem);
    }
    if (filters?.canal_fechamento) {
      query = query.eq("canal_fechamento", filters.canal_fechamento);
    }
    if (filters?.status) {
      if (Array.isArray(filters.status) && filters.status.length > 0) {
        query = query.in("status", filters.status);
      } else if (typeof filters.status === "string" && filters.status.trim() !== "") {
        query = query.eq("status", filters.status);
      }
    }

    if (filters?.cliente && filters.cliente.trim() !== "") {
      const term = `%${filters.cliente.trim()}%`;
      query = query.ilike("cliente_nome", term);
    }

    if (filters?.search && filters.search.trim() !== "") {
      const term = `%${filters.search.trim()}%`;
      query = query.or(`cliente_nome.ilike.${term},produto.ilike.${term}`);
    }

    switch (filters?.sort) {
      case "oldest":
        query = query.order("data_fechamento", { ascending: true }).order("created_at", { ascending: true });
        break;
      case "highest_value":
        query = query.order("preco_venda", { ascending: false, nullsFirst: false });
        break;
      case "lowest_value":
        query = query.order("preco_venda", { ascending: true, nullsFirst: false });
        break;
      case "recent":
      default:
        query = query.order("data_fechamento", { ascending: false }).order("created_at", { ascending: false });
        break;
    }

    const { data, error } = await query;

    if (error) {
      return { sales: [], error: "Erro ao carregar os registros de vendas." };
    }

    const sales = (data || []).map((sale) => {
      const preco = sale.preco_venda !== null && sale.preco_venda !== undefined ? Number(sale.preco_venda) : null;
      const custo = sale.custo !== null && sale.custo !== undefined ? Number(sale.custo) : null;
      const lucro = preco !== null && custo !== null ? preco - custo : null;
      return {
        ...sale,
        preco_venda: preco,
        custo: custo,
        lucro: lucro,
        status: sale.status || "em_conversao",
      };
    });

    return { sales, error: null };
  } catch {
    return { sales: [], error: "Erro inesperado ao buscar registros de vendas." };
  }
}

export async function getSaleById(id: string) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return { sale: null, error: "Não autorizado." };
    }

    const { data, error } = await supabase
      .from("closed_sales")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return { sale: null, error: "Registro de venda não encontrado." };
    }

    const preco = data.preco_venda !== null && data.preco_venda !== undefined ? Number(data.preco_venda) : null;
    const custo = data.custo !== null && data.custo !== undefined ? Number(data.custo) : null;
    const lucro = preco !== null && custo !== null ? preco - custo : null;

    return {
      sale: {
        ...data,
        preco_venda: preco,
        custo: custo,
        lucro: lucro,
        status: data.status || "em_conversao",
      },
      error: null,
    };
  } catch {
    return { sale: null, error: "Erro ao buscar registro de venda." };
  }
}

async function getAuthorizedContext(type: "create" | "update" | "delete") {
  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for") || "127.0.0.1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Não autorizado. Faça login para continuar.", supabase: null };
  }

  const checks = {
    create: rateLimitSaleCreate,
    update: rateLimitSaleUpdate,
    delete: rateLimitSaleDelete,
  };

  if (!checks[type](ip, user.id).allowed) {
    return {
      error: "Muitas operações recentes. Por favor, aguarde alguns minutos.",
      supabase: null,
    };
  }

  return { supabase, error: null };
}

function refreshSalesPaths() {
  revalidatePath("/admin");
  revalidatePath("/admin/sales");
}

export async function createSaleAction(payload: unknown) {
  const context = await getAuthorizedContext("create");
  if (context.error || !context.supabase) return { error: context.error };

  const parsed = closedSaleSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Dados inválidos." };
  }

  const data = parsed.data;

  const { data: sale, error } = await context.supabase
    .from("closed_sales")
    .insert({
      cliente_nome: data.cliente_nome,
      cliente_telefone: data.cliente_telefone || null,
      produto: data.produto,
      tipo_produto: data.tipo_produto,
      preco_venda: data.preco_venda ?? null,
      custo: data.custo ?? null,
      status: data.status || "em_conversao",
      data_fechamento: data.data_fechamento,
      canal_abordagem: data.canal_abordagem,
      canal_fechamento: data.canal_fechamento,
      forma_pagamento: data.forma_pagamento,
      detalhes: data.detalhes || null,
    })
    .select()
    .single();

  if (error || !sale) {
    return { error: "Erro ao registrar o pedido." };
  }

  refreshSalesPaths();
  return { success: true, sale };
}

export async function updateSaleAction(id: string, payload: unknown) {
  const context = await getAuthorizedContext("update");
  if (context.error || !context.supabase) return { error: context.error };

  const parsed = closedSaleSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message || "Dados inválidos." };
  }

  const data = parsed.data;

  const { data: sale, error } = await context.supabase
    .from("closed_sales")
    .update({
      cliente_nome: data.cliente_nome,
      cliente_telefone: data.cliente_telefone || null,
      produto: data.produto,
      tipo_produto: data.tipo_produto,
      preco_venda: data.preco_venda ?? null,
      custo: data.custo ?? null,
      status: data.status || "em_conversao",
      data_fechamento: data.data_fechamento,
      canal_abordagem: data.canal_abordagem,
      canal_fechamento: data.canal_fechamento,
      forma_pagamento: data.forma_pagamento,
      detalhes: data.detalhes || null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error || !sale) {
    return { error: "Erro ao atualizar o registro do pedido." };
  }

  refreshSalesPaths();
  return { success: true, sale };
}

export async function deleteSaleAction(id: string) {
  const context = await getAuthorizedContext("delete");
  if (context.error || !context.supabase) return { error: context.error };

  const { error } = await context.supabase
    .from("closed_sales")
    .delete()
    .eq("id", id);

  if (error) {
    return { error: "Erro ao excluir o registro de venda." };
  }

  refreshSalesPaths();
  return { success: true };
}
