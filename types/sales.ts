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

export const ORDER_STATUS_VALUES = [
  "em_conversao",
  "orcado",
  "pago",
  "modelando",
  "imprimindo",
  "entregue",
  "cancelado",
] as const;

export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

export interface StatusConfig {
  label: string;
  badgeClass: string;
}

export const STATUS_CONFIG: Record<OrderStatus, StatusConfig> = {
  em_conversao: {
    label: "Em conversão",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
  },
  orcado: {
    label: "Orçado",
    badgeClass: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
  },
  pago: {
    label: "Pago",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
  modelando: {
    label: "Modelando",
    badgeClass: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
  imprimindo: {
    label: "Imprimindo",
    badgeClass: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800",
  },
  entregue: {
    label: "Entregue",
    badgeClass: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800",
  },
  cancelado: {
    label: "Cancelado",
    badgeClass: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800",
  },
};

export interface ClosedSale {
  id: string;
  display_id?: number;
  cliente_nome: string;
  cliente_telefone: string | null;
  produto: string;
  tipo_produto: TipoProduto;
  preco_venda: number | null;
  custo: number | null;
  lucro: number | null;
  status: OrderStatus;
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
  "id" | "display_id" | "lucro" | "created_at" | "updated_at"
>;

export type UpdateClosedSaleInput = Partial<CreateClosedSaleInput>;
