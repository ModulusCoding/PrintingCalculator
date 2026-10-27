# C.3 — homologação manual pendente

Nenhum cenário abaixo foi executado pelo agente. Aplicar migrations é responsabilidade do revisor; não representa aprovação funcional. Não executar fixtures/injeções no ambiente produtivo. Usar banco descartável de desenvolvimento e atores reais isolados. Interface Next.js ainda não integra estas RPCs: o roteiro de navegador fica condicionado a essa integração.

## Preparação e evidências

Conferir funções instaladas via pg_get_functiondef contra os arquivos locais, owners/ACL/search_path, A/B/B1/C1/C2 e triggers. Executar separadamente `orders_stage72c3_structure_manual.sql` com conta de auditoria. Criar empresas A/B, owner/admin/operator, planos Free e Intermediate pago e produtos com posições conhecidas. Registrar IDs, attempt_id, expected_version e resposta/SQLSTATE de cada chamada. Capturar antes/depois: orders, order_items, eventos, receipts, reservas, product_inventory, movimentos, settlements e pagamentos. Dados monetários, snapshots, itens e pagamentos devem permanecer iguais.

## Backfill de event_uuid (PostgreSQL, pendente)

Em clone descartável anterior à compatibilidade, capturar todas as colunas originais dos eventos, PK bigint/identity, FKs, ACLs e definição/estado dos triggers. Aplicar manualmente somente a compatibilidade; confirmar contagem igual, event_uuid nunca NULL, COUNT(DISTINCT event_uuid)=COUNT(*), tipo UUID e todas as colunas originais byte-for-byte iguais. Inserir um evento válido de fixture omitindo event_uuid e obter por RETURNING: default deve gerar UUID novo. UPDATE/DELETE do evento continuam falhando order_events_immutable; nenhuma desativação de trigger. Testar também tabela vazia, rollback externo da DDL e plano de lock/tempo/espaço em volume representativo. A comparação depende de fixtures e não foi executada pelo agente.

## Navegador após integração

| Cenário | Ação | Resultado esperado |
| --- | --- | --- |
| Matriz | Exercitar cada aresta aprovada e cada par proibido | Só arestas contratuais; versão +1 e evento correspondente |
| Motivo | Retornos e orcado→modelando sem motivo, vazio, espaços, >1000; demais com NULL | Obrigatórios inválidos falham; opcional NULL funciona |
| Operacional | orcado→pago | Nenhum recebimento financeiro criado |
| Versão | Alterar em aba A; salvar expected_version antigo em B | version_conflict; nenhuma escrita de B |
| Cancelar manual | Pedido untracked | cancelado + timestamp, sem estoque/movimento |
| Cancelar físico | Várias linhas e produtos reservados | Tudo released; físico igual; reservado reduz por soma; versão inventário por reserva |
| Novo cancelamento | Novo attempt no cancelado com versão atual | order_already_cancelled |
| Reabrir manual Free | Pedido cancelado untracked, owner | em_conversao; cancelled_at NULL; sem cota/número novo |
| Reabrir físico | Saldo suficiente em todos produtos | Novas reservas por item stock; antigas released intactas |
| Falta em um produto | Reabrir dois produtos com um insuficiente | insufficient_stock, permanece cancelado; nenhuma reserva nova |
| Demanda explícita | Reabrir make_to_order nunca alocado | Continua demanda; entrega bloqueada até alocar |
| Downgrade | Owner cancelar/entregar reservas anteriores inclusive produto fora janela Free | Permitido sem inventory.write; reabrir físico bloqueado |
| Atores downgrade | Admin/operator Free ou ator sem sales atual | unauthorized, inclusive replay |
| Entrega manual | untracked em em_conversao | entregue sem ledger físico |
| Entrega física | Tudo stock com reservas integrais; repetir produto em duas linhas | Uma saída e settlement por reserva; versões sequenciais por produto |
| Incompleto | make_to_order pendente ou stock sem reserva | order_fulfillment_incomplete; nenhum efeito |
| Terminal | Cancelar entregue; entregar cancelado/entregue | Erro sem nova escrita |
| Tenant | Ator A fornece order_id B | order_unavailable; nenhuma exposição ou mudança B |
| Permissão | Operator cancela; ator só sales.write entrega | Cancelamento recusado; entrega segue autorização central |

## Replay (mesmo payload e attempt_id)

1. Repetir cada sucesso: resposta histórica idêntica, nenhuma versão/evento/reserva/movimento adicional.
2. Alterar cada argumento mantendo attempt: idempotency_conflict para argumentos válidos diferentes.
3. transition→cancel→reopen→deliver e repetir tentativas históricas de cada etapa: status/versão históricos, não atuais. Reabertura replay não exige que suas reservas ainda estejam ativas.
4. Downgrade após sucesso: replay válido deve funcionar para owner ainda autorizado; não concede nova capacidade física.
5. Em fixture isolada de auditoria, corromper um campo por vez no recibo (tipo, UUID, versão, event_id, status, tenant/ator/comando/order) e simular ausência/divergência do evento: receipt_result_unavailable, jamais sucesso falso. A edição de evento exige ambiente descartável e bypass de auditoria deliberado; nunca remover triggers no ambiente compartilhado.
6. Para entrega, adulterar fixture de cadeia consumed→settlement→exit (quantidade, sinal, ator, produto, vínculo, versão/balanço, identificador comum, falta/extra). Replay deve falhar semanticamente. Não usar o endpoint público para criar corrupção.

## Duas sessões concorrentes

Usar conexões SQL distintas autenticadas em fixture descartável, transações explícitas; navegador sozinho pode não controlar as barreiras. Não executar testes via service_role como substituto de auth real.

- Mesmo attempt/payload: duas chamadas simultâneas, ambas retornam o mesmo resultado; efeito único.
- Attempts distintos, mesmo expected_version: cancelar×entregar, transição×cancelar, alocar×cancelar. Uma grava, outra version_conflict/estado incompatível sem efeito parcial.
- Reabrir×criar/reservar mesmo produto: saldo livre não negativo; sem reserva parcial.
- Entregar×saída manual: saída manual só usa saldo livre; nenhum saldo abaixo de reservado.
- Gestão/plano/downgrade concorrente: serialização pelo mutex global preservada; autorização não usa dados desatualizados após aquisição.
- Dois produtos em ordem de itens invertida: sem inversão produto/posição/reserva; medir espera e observar pg_locks/logs. Ausência de deadlock em uma rodada não é prova geral.

## Reconciliação

Após cada commit e replay comparar por enterprise/product: reserved_balance = SUM(quantity WHERE state='active'), 0 <= reserved_balance <= balance; comparar com view privada B. Cancelamento altera reservado e versão, não físico nem ledger. Reabertura altera reservado e versão sem físico. Entrega altera ambos pelo total das reservas, movimentos negativos exatos, um settlement por consumed e um movimento por settlement; nenhuma reserva consumida sem settlement. Verificar saldo inicial + deltas oficiais = saldo final, considerando fixtures de abertura e todas as operações no intervalo. Versão do pedido sobe uma única vez, inventário uma por reserva processada.

## Rollback integral e limites

Em banco descartável, configurar falha controlada na última reserva/movimento/settlement/evento/recibo (trigger de teste que levante exceção); chamar RPC autenticada; remover somente a instrumentação de teste ao final. Comparar snapshots antes/depois: nenhum saldo/versão/status/timestamp/evento/recibo parcial. Reabrir com falta no último produto é teste natural de atomicidade; não substitui falha tardia após escritas. Testar teto 9007199254740991 de pedido e headroom por produto com duas reservas; limites e corrupção de agregado devem falhar sem reparo automático. ROLLBACK externo após RPC bem-sucedida também deve desfazer todos os efeitos. Registrar execução real e resultados antes de homologar.
