const messages: Record<string, string> = {
  session_expired: "Sua sessão expirou. Entre novamente.",
  permission_denied: "Você não tem permissão para esta operação.",
  product_unavailable: "Produto indisponível ou fora da janela de acesso do plano atual. Consulte os planos para ampliar o acesso.",
  version_conflict: "O produto foi alterado. Atualize a página antes de tentar novamente.",
  invalid_input: "Confira os dados informados.",
  selection_required: "Selecione um plano para continuar.",
  plan_limit_reached: "Você atingiu o limite de produtos do plano. A listagem e a edição continuam disponíveis.",
  plan_feature_unavailable: "Esta operação não está disponível no plano atual.",
  member_plan_blocked: "O acesso da equipe está bloqueado pelo plano. Peça ao responsável para regularizar.",
  team_regularization_required: "Regularize a equipe para continuar.",
  authorization_conflict: "O acesso mudou. Atualize a página e tente novamente.",
  idempotency_conflict: "Esta tentativa já foi usada com outros dados. Verifique a lista antes de tentar novamente.",
  technical: "Não foi possível concluir a operação. Tente novamente.",
};

export function productMessage(status: string, reference?: string) {
  const message = messages[status] || messages.technical;
  return reference ? `${message} Referência: ${reference}.` : message;
}

export function productPlanAction(status: string) {
  return ["selection_required", "plan_limit_reached", "plan_feature_unavailable", "product_unavailable"].includes(status);
}
