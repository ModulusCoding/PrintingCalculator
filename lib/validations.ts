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
    .max(1000000, "O preço excede o limite máximo permitido."),
  image_url: z.string().url("URL de imagem inválida.").optional().nullable().or(z.literal("")),
  active: z.boolean().default(true),
  catalog_ids: z.array(z.string().uuid("ID de catálogo inválido.")).optional().default([]),
});
