import type { PlanErrorCode } from "../plans";

/** Client-safe messages for expected plan denials, including stale open forms. */
export const planActionMessages: Record<PlanErrorCode, string> = {
  selection_required: "Escolha um plano em Minha conta para continuar.",
  plan_feature_unavailable: "Seu plano atual não inclui este recurso. Confira as opções de plano em Minha conta.",
  plan_limit_reached: "O limite do seu plano foi atingido. Confira seu plano em Minha conta.",
  member_plan_blocked: "O plano da empresa não permite este acesso. Peça ao proprietário para verificar o plano.",
  team_regularization_required: "A equipe precisa ser regularizada para continuar. Peça ao proprietário para verificar o plano e a equipe.",
  authorization_conflict: "As condições de acesso mudaram. Atualize a página e verifique seu plano.",
  idempotency_conflict: "Esta tentativa já foi usada com dados diferentes. Atualize a página antes de iniciar outra operação.",
};

export function planActionMessage(code: string): string | null {
  return Object.prototype.hasOwnProperty.call(planActionMessages, code)
    ? planActionMessages[code as PlanErrorCode]
    : null;
}
