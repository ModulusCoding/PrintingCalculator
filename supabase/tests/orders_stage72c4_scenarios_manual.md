# M7.2-C.4 — roteiro de homologação (NÃO EXECUTADO)

Aplicação das migrations e execução de SQL somente pelo responsável em ambiente autorizado. Os testes de navegador dependem da futura integração Next.js; não há frontend C4 nesta entrega. Não usar conta service_role como substituto dos testes com usuário real.

## Preparação

Confirmar definições instaladas A/B/B1/C1/C2/C3 (inclusive event_uuid), auth/planos e C4 contra fontes locais: pg_get_functiondef, constraints, triggers, índices, RLS, ACL/owner/search_path. Usar empresas A/B, owners/admin/operator, Intermediate pago regular e Free. Guardar snapshots de pedidos/itens/pagamentos/eventos/recibos/inventário antes e depois. Não armazenar dados de cartão ou credenciais nas notas.

## Funcional pelo navegador após integração

1. Pedido total 100: receber 30 por pix; recebido bruto/líquido=30, estornado=0, pendente=70, estado parcial. Operacional e inventário iguais; versão +1, evento/payment/receipt únicos.
2. Receber 70 com outro método válido: líquido=100, pendente=0, financeiro pago; operacional não muda para pago automaticamente. Nova parcela 0.01 falha por excesso.
3. Valor zero/negativo/NaN/infinito/expoente/vírgula/escala >2/fora do teto e método desconhecido falham invalid_input. Datas efetivas NULL/infinita falham; datas finitas explícitas preservadas; recorded_at é servidor.
4. Pedido total zero: financeiro pago sem linha fictícia de pagamento; qualquer recebimento positivo falha por excesso.
5. Receber após entrega com saldo pendente: permitido. Receber em cancelado: recusado; não muda total/status/reservas.
6. Cancelar pedido com pagamento: saldo e ledger mantidos, nenhum refund automático. Consulta separa valor líquido ainda não estornado do saldo comercial; não exibir o saldo como cobrança ativa automática do cancelado.
7. Estornar a parcela 30 integralmente: original intacto, refund com mesma quantia/método e referência, ator/data/motivo, líquido reduzido. Não chamar provedor externo. Qualquer estado operacional pode estornar, inclusive cancelado/entregue.
8. Novo attempt para estornar a mesma parcela falha; alvo refund, inexistente ou de outra empresa não pode ser estornado. Motivo NULL/vazio/espaços/>1000 falha.
9. Correção manual: estorno integral e novo recebimento correto, nunca UPDATE/DELETE no original. Respeitar bloqueio de recebimento se pedido estiver cancelado (reabrir explicitamente se apropriado).
10. Edição comercial em pedido manual não terminal: total novo igual/maior que líquido funciona; menor que líquido falha atomicamente, incluindo rollback da substituição de itens. Após estorno suficiente, redução válida pode funcionar. Guardas físicas C2c continuam bloqueando edição física/histórica.
11. Transição para operacional pago sem recebimento: financeiro continua pendente. Recebimento integral sem transição: operacional permanece onde estava.
12. Consulta/histórico com paginação por recorded_at/id: página seguinte não duplica linhas mesmo com horários iguais; limite/cursor inválidos falham. Endpoints de leitura têm snapshots próprios; recarregar resumo após mutação.

## Replay e histórico

- Repetir mesmo attempt/payload de recebimento e de estorno: retornar resposta histórica idêntica sem versões/lançamentos/eventos novos.
- Alterar cada argumento válido mantendo attempt: idempotency_conflict. Texto bruto com espaços diferentes em nota/motivo faz parte do payload.
- Receber → editar total/operacional → estornar → repetir recebimento inicial: snapshot financeiro retornado é histórico, não o saldo atual.
- Receber → cancelar → repetir recebimento: replay original válido permanece permitido para ator ainda autorizado, apesar do bloqueio de recebimento novo em cancelado.
- Estornar → novas parcelas → repetir estorno: não repetir contrapartida, não exigir saldo atual igual ao histórico.
- Em fixture descartável de auditoria, adulterar tipo/UUID/valor/versão do resultado, evento ou referência do ledger: receipt_result_unavailable, nunca sucesso falso. Não desativar triggers de produção para criar corrupção; usar clone preparado para testes.

## Permissões e isolamento

- Owner/admin/operator Intermediate: leitura e recebimento segundo sales.read/write. Operator não estorna (sales.delete).
- Owner Free pode consultar/receber/estornar sem paid físico, sem quota nova, sem acesso adicional ao inventário. Admin/operator Free continuam bloqueados centralmente.
- Downgrade entre tentativas: owner autorizado conclui/replay sem gate físico; seleção pendente/regularização/empresa ou identidade inválida continuam bloqueadas.
- Empresa A não lê histórico/resumo nem lança/estorna no pedido B, inclusive com IDs conhecidos. Helpers privados e DML direto em pagamentos/recibos/eventos negados aos papéis API; anon não executa RPC.
- UPDATE/DELETE financeiro e eventos permanecem imutáveis. Alterações operacionais C3 não acionam a guarda de total_amount e não fazem consulta financeira como gate de estoque.

## Concorrência (duas conexões reais)

Usar transações explícitas e barreiras observáveis em ambiente descartável; registrar payloads/attempt/expected_version, tempos e SQLSTATE.

- Saldo 100, duas parcelas simultâneas 70 com mesma expected_version e attempts diferentes: só uma grava; outra conflito de versão. Repetir segunda com nova versão continua não podendo exceder saldo.
- Mesmo attempt/payload em duas sessões: mesmo sucesso histórico com efeito único.
- Dois estornos do mesmo original: apenas um refund, outro conflito/duplicado. UNIQUE parcial protege duplicação.
- Parcela × edição que reduz total: serialização pelo pedido, sem total menor que líquido após ambos commits.
- Parcela × cancelar/entregar: vencedor determina versão; perdedor deve refazer intenção, nunca escrever parcialmente. Entrega não significa quitação.
- Estorno × edição: total e líquido não ficam incompatíveis. Refund e total guard compartilham pedido como barreira.
- Plano/equipe × financeiro: global mutex adquirido antes de contexto e pedido; não bypass de autorização desatualizada. Medir throughput sem retirar mutex.

## Reconciliação e rollback

Para cada pedido: recebido_bruto=SUM(receipt.amount); estornado=SUM(refund.amount); líquido=bruto-estornado; 0<=líquido<=total; pendente=total-líquido. Cada refund aponta receipt do mesmo pedido/empresa, valor/método iguais e no máximo um; total zero é pago. Em cancelado valor ainda não estornado=líquido, nos demais=0. Conferir event_uuid/payment_id/ator/attempt/versão e snapshot do recibo. Valores brutos acumulados podem superar teto unitário depois de ciclos de correção; não truncar nem usar float.

Em clone descartável, injetar falha no último evento/recibo por trigger de teste; receber/estornar deve desfazer ledger, versão/updated_at, evento e recibo integralmente. Testar também ROLLBACK externo após sucesso e version ceiling 9007199254740991. Remover apenas instrumentação de teste ao final; não tocar triggers históricos compartilhados.

## Preflight da migration

Inspeção read-only de catálogo após aplicação manual: verificar pg_proc para quatro RPCs (assinaturas/RETURNS TABLE, prosecdef, owner postgres e proconfig search_path vazio); has_function_privilege para authenticated permitido e anon/service_role negados, aclexplode sem PUBLIC; helpers orders_c4 privados sem EXECUTE API; has_table_privilege/has_any_column_privilege sem INSERT/UPDATE/DELETE financeiro para API; RLS mantido; pg_get_triggerdef do guard BEFORE UPDATE OF total_amount e dos triggers imutáveis inalterados; pg_get_indexdef do UNIQUE parcial de refund e FK original preservada. Também inspecionar pg_get_functiondef inteiro, não só assinaturas. Não chamar RPC com privilégios de auditoria para substituir teste de auth.

Em clones separados, simular dados prévios válidos e inválidos (refund de refund, duplicidade, valor/método divergente, overpayment). Compatíveis passam; incompatíveis abortam sem reparo/deleção de histórico. Testar migration em transação para garantir falha sem objetos parciais. Estes são testes PostgreSQL pendentes, não evidências de execução.
