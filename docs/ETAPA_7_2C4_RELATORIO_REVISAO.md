# M7.2-C.4 — relatório de revisão manual

## Escopo autorizado

F1–F4 e convenções técnicas aprovadas explicitamente pelo responsável. Uma única migration transacional C4: `supabase/migrations/20261026184000_orders_stage72c4_payments.sql`. Nenhuma divisão C4a/b/c, tabela financeira paralela, redefinição histórica ou aplicação automática. A fonte permanece order_payments A; comandos/eventos financeiros já existem nas constraints A. Instalado A..C3 informado pelo responsável, não consultado independentemente nem homologado pelo agente.

## Contrato e complementos

- `docs/ETAPA_7_2C4_CONTRATO_PAGAMENTOS.md`: aprovação, políticas, assinaturas, derivação, segurança e compatibilidade.
- `supabase/tests/orders_stage72c4_source_checks.cjs`: verificações textuais sem parser/conexão PostgreSQL.
- `supabase/tests/orders_stage72c4_scenarios_manual.md`: testes futuros de navegador, replay, multi-tenant/roles/plano, total zero, cancelamento/entrega, edição, concorrência, preflight e rollback.

## Revisão de integração

- C2c update_order serializa pelo pedido mas não consultava pagamentos. Trigger incremental BEFORE UPDATE OF total_amount protege novo total sem redefinir a RPC, relaxar guardas físicas ou interferir em UPDATE operacional C3. Falha tardia desfaz toda substituição de itens pela mesma transação.
- Cancelamento C3 continua sem estorno automático. Resumo separado de cancelled_unreversed_amount não confunde saldo comercial com cobrança automática ativa.
- Métodos da A preservados; numeric exato e parser C1; total zero pago sem recebimento fictício. Refund integral único referencia receipt de mesma empresa/pedido e replica valor/método, sem provedor externo.
- Registro/estorno versionados, autorizados centralmente e idempotentes com evento UUID persistido e snapshot financeiro histórico. Replay não exige estado/saldo atuais iguais.
- Revisão independente dos writers históricos confirmou a compatibilidade do trigger estreito: UPDATE OF verifica toda atribuição de total (mesmo valor inalterado), C3 não atribui total e a ordem alfabética com orders_set_updated_at não cria dependência. INSERT financeiro e leitura do agregado após a escrita devem ser statements separados para enxergar as próprias alterações; não assumir visibilidade de CTE mutável no mesmo snapshot.
- Mesma ordem global e pedido como barreira de serialização; nenhuma posição/produto/reserva bloqueada ou alterada pelo financeiro. Headroom e erros não viram sucesso.
- Snapshot histórico é incluído no evento imutável e comparado exatamente no replay, além de validar tipos/arithmetic e identidade/valor/método/data/nota do ledger. Hash usa motivo bruto; persistência do motivo é aparada. UTC na representação do timestamp no hash evita divergência por TimeZone da sessão.
- Revoga explicitamente INSERT/UPDATE/DELETE/TRUNCATE de orders/order_payments/order_events/recibos para papéis API, incluindo service_role, cujo baseline hospedado não foi presumido. Isso fecha acesso direto, não amplia permissões globais. ACLs herdados ou grants por coluna remanescentes fazem assertions falharem em vez de ignorar risco. Revogar privilégio de tabela não apaga grant por coluna; por isso has_any_column_privilege é verificado explicitamente no fechamento. Helpers privados compartilhados de agregado, engine e leitura não são expostos como autoridade alternativa.
- SECURITY DEFINER postgres, search_path vazio, EXECUTE só authenticated, helpers revogados e sem DML API. Sem gate físico extra para Free/downgrade; autorização de vendas atual continua obrigatória.

Revisão cruzada independente da implementação (437 linhas antes do reforço adicional das assertions de grants por coluna) não encontrou bloqueios concretos de fonte: expressões CASE/IS DISTINCT FROM, wrappers jsonb_to_record, qualificações de nomes, snapshots entre statements, trigger, refund único, replay e instalação dinâmica de ACL foram inspecionados. Isso não é parsing/execução PostgreSQL.

## Validação efetiva e pendências

`node supabase/tests/orders_stage72c4_source_checks.cjs`: **PASS** após implementação e ajustes de revisão. Confere arquivo único, limites de escopo, APIs/segurança, trigger, refund único, snapshot/replay e cursor. Verificações são textuais, não execução PostgreSQL. Roteiro manual não executado.

Regressões de fonte executadas nesta continuação:

- C2 source checks: PASS.
- C3 source checks: PASS.
- `node --check supabase/tests/orders_stage72c4_source_checks.cjs`: PASS (sintaxe JavaScript do verificador, não do SQL).

`Get-Command psql,pg_config,pg_format` não encontrou ferramentas no PATH nesta execução. Nenhum parser/dependência foi instalado para contornar essa limitação.

Não executados: instalação/parsing PostgreSQL, catálogo/ACL efetivos, funções autenticadas, navegador, datas/limites reais, corrupção de replay, preflight com histórico, reconciliação, duas sessões e injeção de rollback. O backend não foi homologado. Migrations aplicadas com sucesso no desenvolvimento não substituem testes de fluxo e concorrência.

Antes da aplicação manual: confrontar pg_get_functiondef e constraints/triggers/ACL instalados com fontes; verificar histórico financeiro prévio compatível sem desativar imutabilidade; validar em clone descartável; registrar resultados reais e somente depois integrar interface. Não usar conta service_role como prova de autorização de usuário.

## Restrições preservadas

Nenhum SQL remoto, migration aplicada, mudança de frontend/gateway/planos/permissões globais, dependência instalada, commit/push/reset/deploy. Arquivos históricos e trabalho preexistente preservados. Não existe promessa de ausência provada de deadlock: mutex global preservado limita throughput e os testes concorrentes continuam necessários.
