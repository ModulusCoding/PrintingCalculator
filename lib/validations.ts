import { z } from "zod";

export const slugSchema = z
  .string()
  .min(2, "O slug deve ter pelo menos 2 caracteres.")
  .max(100, "O slug deve ter no máximo 100 caracteres.")
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "O slug deve conter apenas letras minúsculas, números e hífens (ex: deuses-gregos)."
  );

export const catalogSchema = z.object({
  name: z
    .string()
    .min(2, "O nome deve ter pelo menos 2 caracteres.")
    .max(255, "O nome deve ter no máximo 255 caracteres.")
    .trim(),
  slug: slugSchema,
  description: z.string().max(2000, "A descrição deve ter no máximo 2000 caracteres.").optional().nullable(),
  logo_url: z.string().url("URL de logo inválida.").optional().nullable().or(z.literal("")),
  banner_url: z.string().url("URL de banner inválida.").optional().nullable().or(z.literal("")),
  whatsapp: z
    .string()
    .max(50, "WhatsApp deve ter no máximo 50 caracteres.")
    .optional()
    .nullable()
    .or(z.literal("")),
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  name: z
    .string()
    .min(2, "O nome deve ter pelo menos 2 caracteres.")
    .max(255, "O nome deve ter no máximo 255 caracteres.")
    .trim(),
  slug: slugSchema,
  description: z.string().max(3000, "A descrição deve ter no máximo 3000 caracteres.").optional().nullable(),
  price: z
    .number({ error: "Preço deve ser um número válido." })
    .min(0, "O preço não pode ser negativo.")
    .max(1000000, "O preço excede o limite máximo permitido.")
    .optional()
    .nullable(),
  image_url: z.string().url("URL de imagem inválida.").optional().nullable().or(z.literal("")),
  images: z
    .array(z.string().url("URL de imagem inválida."))
    .max(3, "O produto pode ter no máximo 3 imagens.")
    .optional()
    .default([]),
  active: z.boolean().default(true),
  catalog_ids: z.array(z.string().uuid("ID de catálogo inválido.")).optional().default([]),
});

export const catalogFilterSchema = z.object({
  name: z
    .string()
    .min(2, "O nome deve ter pelo menos 2 caracteres.")
    .max(100, "O nome deve ter no máximo 100 caracteres.")
    .trim(),
  slug: slugSchema,
  description: z.string().max(2000, "A descrição deve ter no máximo 2000 caracteres.").optional().nullable().or(z.literal("")),
  display_order: z.number().int().min(0).optional().default(0),
});

export const closedSaleSchema = z.object({
  cliente_nome: z
    .string()
    .min(2, "O nome do cliente deve ter pelo menos 2 caracteres.")
    .max(255, "O nome do cliente deve ter no máximo 255 caracteres.")
    .trim(),
  cliente_telefone: z
    .string()
    .regex(/^\d{10,15}$/, "O telefone deve conter apenas números entre 10 e 15 dígitos.")
    .optional()
    .nullable()
    .or(z.literal("")),
  produto: z
    .string()
    .min(2, "O nome do produto deve ter pelo menos 2 caracteres.")
    .max(255, "O nome do produto deve ter no máximo 255 caracteres.")
    .trim(),
  tipo_produto: z.enum(
    [
      "Produto padrão",
      "Produto personalizado",
      "Produto personalizado esotérico",
      "Encomenda",
    ],
    { error: "Tipo de produto inválido." }
  ),
  preco_venda: z
    .number({ error: "Preço de venda deve ser um número válido." })
    .finite("Preço de venda deve ser um número finito.")
    .min(0, "O preço de venda não pode ser negativo.")
    .max(10000000, "O preço de venda excede o limite máximo permitido.")
    .optional()
    .nullable(),
  custo: z
    .number({ error: "Custo deve ser um número válido." })
    .finite("Custo deve ser um número finito.")
    .min(0, "O custo não pode ser negativo.")
    .max(10000000, "O custo excede o limite máximo permitido.")
    .optional()
    .nullable(),
  status: z.enum(
    [
      "em_conversao",
      "orcado",
      "pago",
      "modelando",
      "imprimindo",
      "entregue",
      "cancelado",
      "carrinho_perdido",
    ],
    { error: "Status de pedido inválido." }
  ).default("em_conversao"),
  data_fechamento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de fechamento inválida (formato AAAA-MM-DD).")
    .refine((value) => {
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
      );
    }, "Data de fechamento inválida."),
  canal_abordagem: z.enum(
    ["Instagram", "WhatsApp", "Boca a boca", "Site", "Evento", "Outro"],
    { error: "Canal de abordagem inválido." }
  ),
  canal_fechamento: z.enum(
    ["WhatsApp", "Instagram", "Presencial", "Site", "Outro"],
    { error: "Canal de fechamento inválido." }
  ),
  forma_pagamento: z.enum(
    ["PIX", "Cartão", "Dinheiro", "Transferência", "Outro"],
    { error: "Forma de pagamento inválida." }
  ),
  detalhes: z
    .string()
    .max(2000, "Os detalhes devem ter no máximo 2000 caracteres.")
    .optional()
    .nullable()
    .or(z.literal("")),
});
