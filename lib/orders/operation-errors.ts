// Known failures are identified by BOTH SQLSTATE and stable domain message.
const groups: Record<string,string[]> = {
  "22023":["invalid_input"],
  "42501":["unauthorized","selection_required","plan_feature_unavailable","plan_limit_reached"],
  "P0002":["order_unavailable","order_item_unavailable","receipt_result_unavailable","payment_unavailable"],
  "40001":["version_conflict"],
  "23505":["idempotency_conflict","settlement_already_compensated","payment_already_reversed"],
  "22003":["version_limit_exceeded","inventory_balance_limit_exceeded"],
  "P0003":["insufficient_stock"],
  "P0001":["invalid_order_transition","order_already_delivered","order_already_cancelled","order_not_cancelled","order_not_editable","order_item_not_allocatable","order_item_already_allocated","order_item_stock_mismatch","product_unavailable","order_fulfillment_incomplete","delivery_reconciliation_required","reservation_balance_inconsistent","order_not_delivered","delivery_confirmation_unavailable","order_cancelled","active_reservation_edit_unsupported","reservation_history_edit_unsupported","physical_order_edit_unsupported","stock_integration_unavailable"],
  "23514":["delivery_reconciliation_required","reservation_balance_inconsistent","payment_exceeds_pending","total_below_net_received","payment_balance_inconsistent","payment_ledger_unavailable","payment_event_unavailable","delivery_manifest_inconsistent","delivery_receipt_inconsistent","delivery_inheritance_inconsistent","delivery_settlement_inconsistent","delivery_movement_chain_inconsistent","delivery_exit_inconsistent","delivery_compensation_inconsistent","delivery_compensation_chain_inconsistent","delivery_coverage_item_missing","delivery_coverage_mismatch","delivery_coverage_exit_missing","delivery_coverage_ambiguous","delivery_event_unavailable"],
};
export function knownOrderError(error:{code?:string;message?:string}) {
  return !!error.code && !!error.message && !!groups[error.code]?.includes(error.message);
}
export function orderErrorMessage(code:string) {
  const messages:Record<string,string> = {
    invalid_input:"Revise os campos, motivo, data e valores.",
    unauthorized:"Sessão inválida ou sem permissão para esta operação.",
    selection_required:"Selecione um plano para continuar.",
    plan_feature_unavailable:"Esta nova obrigação física exige plano elegível. A consulta histórica continua disponível.",
    version_conflict:"O pedido mudou. Atualize os dados e confirme novamente; a tentativa anterior não será alterada.",
    idempotency_conflict:"Conflito de identidade da tentativa. Não crie outra tentativa; solicite revisão.",
    receipt_result_unavailable:"Resultado histórico não recuperável. Solicite revisão da tentativa antes de outra operação.",
    insufficient_stock:"Saldo disponível insuficiente para a alocação integral.",
    payment_exceeds_pending:"O valor ultrapassa o saldo pendente atual.",
    payment_already_reversed:"Este recebimento já foi estornado integralmente.",
    order_fulfillment_incomplete:"Existem obrigações físicas sem alocação. Aloque cada item antes da entrega.",
  };
  return messages[code] || (code.includes("inconsistent") || code.includes("reconciliation") || code.includes("coverage")
    ? "A evidência física ou financeira exige revisão. Não force ajustes; consulte o responsável."
    : "Operação recusada pelo estado atual do pedido. Atualize os dados e revise a confirmação.");
}
