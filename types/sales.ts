export const TIPO_PRODUTO_OPTIONS = [
  "Produto padrão",
  "Produto personalizado",
  "Produto personalizado esotérico",
  "Encomenda",
] as const;

export type TipoProduto = (typeof TIPO_PRODUTO_OPTIONS)[number];

export const CANAL_ABORDAGEM_OPTIONS = [
  "Instagram",
  "WhatsApp",
  "Boca a boca",
  "Site",
  "Evento",
  "Outro",
] as const;

export type CanalAbordagem = (typeof CANAL_ABORDAGEM_OPTIONS)[number];

export const CANAL_FECHAMENTO_OPTIONS = [
  "WhatsApp",
  "Instagram",
  "Presencial",
  "Site",
  "Outro",
] as const;

export type CanalFechamento = (typeof CANAL_FECHAMENTO_OPTIONS)[number];

export const FORMA_PAGAMENTO_OPTIONS = [
  "PIX",
  "Cartão",
  "Dinheiro",
  "Transferência",
  "Outro",
] as const;

export type FormaPagamento = (typeof FORMA_PAGAMENTO_OPTIONS)[number];

export interface ClosedSale {
  id: string;
  cliente_nome: string;
  cliente_telefone: string | null;
  produto: string;
  tipo_produto: TipoProduto;
  preco_venda: number;
  custo: number;
  lucro: number;
  data_fechamento: string; // ISO format (YYYY-MM-DD)
  canal_abordagem: CanalAbordagem;
  canal_fechamento: CanalFechamento;
  forma_pagamento: FormaPagamento;
  detalhes: string | null;
  created_at: string;
  updated_at: string;
}

export type CreateClosedSaleInput = Omit<
  ClosedSale,
  "id" | "lucro" | "created_at" | "updated_at"
>;

export type UpdateClosedSaleInput = Partial<CreateClosedSaleInput>;
