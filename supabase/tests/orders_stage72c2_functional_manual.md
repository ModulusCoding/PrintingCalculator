# C2a/C2b/C2c — matriz funcional manual (não executada)

## Estado e preparação

**PENDENTE em todos os casos abaixo.** PostgreSQL local indisponível; daemon Docker indisponível. Testes expressamente adiados, nenhum teste executado e nenhuma segurança/concorrência comprovada. A/B/B1/C1 foram informadas como aplicadas manualmente em dev, sem verificação remota nesta tarefa. C2 é contrato candidato, não presumir que as RPCs já implementem estes resultados. Não executar SQL remoto. Documento geral do projeto não encontrado.

Contrato: `docs/ETAPA_7_2C2_CONTRATO_RPC_PEDIDOS.md`. Usar ambiente local descartável futuro, nunca produção. Preparar via fixtures revisadas duas empresas A/B, owner A com `sales.write`, vendedor A com apenas `sales.write` (sem `inventory.write`), usuário sem vendas, anônimo e owner B. Preparar intermediate pago, Free e demais estados de plano; produtos ativos/inativos/excluídos/invisíveis, custom e catálogo, posições e pedidos independentes. Auth real de cada ator; chamada como postgres não prova ACL/RLS.

Registrar por caso: build/migrações e corpo efetivo, ator/empresa/plano, UUIDs e payload exatos, resultado/SQLSTATE real, snapshots antes/depois e discrepâncias. Usar tentativa nova para operação nova; guardar a tentativa e payload completos para replay. Falhas esperadas precisam de savepoint/transação independente para inspeção posterior. Corrupção e fixtures privilegiadas somente local descartável; nunca conceder DML/EXECUTE privados ao cliente para facilitar testes.

### Oráculo obrigatório

Antes/depois: pedidos/itens (IDs, modo, quantidade, snapshots, totais, versão/status), contador, posição (`balance`, `reserved_balance`, `version`), reservas (vínculos, quantidade, estado, ator), movimentos, settlements, eventos e recibos. Ao reservar `n` itens: delta reservado = soma das quantidades, delta versão inventário = número de reservas daquele produto; balance/ledger/settlements inalterados. Reconciliação sem discrepâncias, **por protocolo dos helpers**, não por suposto trigger agregado. Um erro deve deixar todo o snapshot igual; não basta conferir a resposta.

## C2a — criação

| ID | Preparação / ação | Resultado esperado |
| --- | --- | --- |
| A01 | Criar somente `untracked` com produto e custom sem produto | Comportamento C1: `created`, versão 0, finanças e snapshots corretos, evento `created`, um recibo `create`, sem reserva. |
| A02 | Intermediate pago, estoque disponível 10, uma linha `stock` q=4 | Item `stock`, uma reserva ativa q=4, reservado +4, inventário versão +1, pedido versão 0. |
| A03 | Disponível exatamente 4, `stock` q=4 | Reserva integral; disponível final 0, nunca negativo. |
| A04 | Disponível 3 para q=4; repetir com posição ausente | Criação bem-sucedida, item `make_to_order`, nenhuma reserva/movimento/posição artificial, inventário sem alteração. |
| A05 | Mesmo produto repetido: q=4 e q=4, disponível 6 | **Ambos** `make_to_order`, zero reservas. Proibido reservar só a primeira linha ou 6 unidades parciais. Inverter ordem das linhas: mesma decisão. |
| A06 | Mesmo produto q=4 e q=4, disponível 8 (depois 9) | Duas reservas integrais, reservado +8 e versão inventário +2, pedido versão 0; IDs de itens distintos. |
| A07 | Duas linhas `stock` q=2+2, uma explícita `make_to_order` q=100, disponível 4 | Reservar somente as duas `stock`; explícita continua `make_to_order` sem reserva. |
| A08 | Somente `make_to_order` explícito q=2, disponível 100 | Nenhuma auto-reserva; modo preservado, inventário versão inalterada. |
| A09 | Produtos P/Q: grupo P não cabe, Q cabe; misturar `untracked` | Fallback de todo P, reserva integral de Q; `untracked` nunca reserva. Sem dependência da ordem de linhas/produtos. |
| A10 | `balance=10`, `reserved_balance=7`, grupo `stock` q=4 | Disponível é 3: fallback, não usar balance bruto 10. |
| A11 | Catálogo e custom com produto; nomes de entrada diferentes do catálogo | Catálogo usa snapshots da linha de produto bloqueada; custom preserva valores custom. Cálculos/rounding/limites C1 preservados, sem renormalizar JSON no INSERT. |
| A12 | Produto de B, inexistente, inativo, excluído ou invisível; físico sem produto/custom sem produto | Rejeitar sem efeitos, não converter produto inválido em fallback. Produto estrangeiro não é revelado. Custom sem produto `untracked` segue permitido. |
| A13 | JSON não-array, 0/101 linhas, modo/origem inválidos, UUID ruim, q=0/negativa/fracionária/>1e9, NaN/expoente/excesso de escala, teto financeiro | Rejeitar pelas validações estritas; zero efeitos inclusive contador/recibo. Testar cada entrada isoladamente. |
| A14 | Free: criar até 3 históricos, cancelar/arquivar um, tentar quarto; repetir simultaneamente 3º/4º | Limite histórico 3 mantido; cancelamento/arquivo não libera cota. Só uma criação ocupa última vaga. Replay de criação existente não consome vaga. |
| A15 | Free/expired/cancelled/trial/seleção pendente/advanced, tentativa nova com modo físico | Rejeitar operação física: somente efetivo intermediate pago habilita. `untracked` preserva política comercial C1, sem ampliar planos por inferência. |
| A16 | Mesmo attempt e payload após sucesso; depois alterar quantidade na mesma chave | Replay devolve resposta histórica exata e zero novos efeitos; payload diferente gera `idempotency_conflict`/23505. |
| A17 | Criar com reserva; depois alocar outro item, elevando versão; repetir create original | Retorna versão 0 e totais históricos, sem exigir igualdade com versão atual ou reservar de novo. |
| A18 | Contador ausente em tenant vazio / ausente com histórico / drift / teto | Preservar bootstrap permitido somente vazio, erro de bootstrap com histórico e erro de drift/teto conforme C1; nenhuma reserva órfã em falha. |

## C2c — edição integral protegida

Todos pendentes. Para cada falha, comparar snapshot completo: IDs/modos/quantidades dos itens, cabeçalho/versão, inventário, reservas, eventos e recibos devem permanecer iguais.

| ID | Preparação / ação | Resultado esperado |
| --- | --- | --- |
| E01 | Pedido não terminal, inteiramente untracked, sem histórico; editar com versão correta | Comportamento comercial C1 preservado: totais exatos, itens substituídos, versão +1, um evento updated e recibo update. |
| E02 | Item stock persistido sem reserva (fixture privilegiada isolada), payload novo untracked | physical_order_edit_unsupported/P0001; não apagar/recriar item. |
| E03 | Item make_to_order, sem reserva; payload novo untracked | physical_order_edit_unsupported/P0001; protege inclusive demanda sem posição de estoque. |
| E04 | Pedido misto untracked + make_to_order | Mesma rejeição física; não basta o payload novo ser untracked. |
| E05 | Reserva ativa e modo stock, versão correta | active_reservation_edit_unsupported/P0001 antes do erro físico. |
| E06 | Somente reserva released ou consumed e item físico | reservation_history_edit_unsupported/P0001 antes do erro físico. Cada estado em fixture separada. |
| E07 | Fixture com pedido físico e terminal, versão divergente | version_conflict/40001; com versão correta, order_not_editable/P0001 antes de história/modo. |
| E08 | Concluir edição untracked antes de instalar C2c; repetir attempt/payload após instalação | Resposta histórica exata, sem nova escrita. Em fixture isolada, tornar pedido depois físico/terminal/versionado e repetir recibo: novas guardas não são executadas no replay. |
| E09 | Mesma tentativa de edição concluída, payload diferente ou JSON do recibo inválido | idempotency_conflict/23505 ou receipt_result_unavailable/P0002 conforme caso, sem reexecução. |
| E10 | ID de pedido de outra empresa, sem sales.write, sessão anônima | Erros de disponibilidade/autorização do contrato C1; nenhuma exposição ou escrita cruzada. |
| E11 | Duas edições untracked com mesmo expected_version, tentativas distintas | Uma confirma, outra version_conflict; tentativa idêntica recupera o mesmo recibo sem duplicação. |

## C2b — alocação

Chamada: `allocate_order_stock(attempt_uuid, order_uuid, item_uuid, expected_order_version)`; saída `(status text, order_id uuid, order_item_id uuid, reservation_id uuid, version bigint)`.

| ID | Preparação / ação | Resultado esperado |
| --- | --- | --- |
| B01 | Intermediate pago, item `make_to_order` q=3, disponível >=3, versão V | `allocated`, IDs exatos, reserva integral q=3, item `stock`, pedido V+1, reservado +3 e inventário versão +1; um evento `stock_allocated` na versão V+1 com from/to NULL e um recibo `allocate_stock`. Status operacional/finanças não mudam. |
| B02 | Mesmo pedido com duas linhas `make_to_order` do mesmo produto; alocar uma | Somente item escolhido reservado e convertido. Não reservar outro item/grupo automaticamente. |
| B03 | Disponível insuficiente ou posição ausente | `insufficient_stock`/P0003, sem fallback parcial, mudança de modo, versão, evento ou recibo. |
| B04 | Item `untracked`, já `stock`, ou já com reserva ativa | Rejeitar nova alocação; nenhuma duplicação. Replay de tentativa bem-sucedida é diferente e deve funcionar. |
| B05 | Item não pertence ao pedido, pedido/item de B, IDs inexistentes | Rejeitar sem acesso cruzado nem efeitos. |
| B06 | Pedido `entregue`/`cancelado`; versão esperada antiga; versão no teto | Rejeitar: pedido não elegível, `version_conflict`/40001 ou `version_limit_exceeded`/22003 conforme caso; sem efeitos. |
| B07 | NULL em cada parâmetro, expected_version negativo, UUID inválido na fronteira RPC | Erro de entrada/tipo, sem efeitos. |
| B08 | Produto desativado/excluído/invisível antes de nova tentativa | Rejeitar produto indisponível; nada reservado. |
| B09 | Repetir mesma tentativa e payload logo após B01 | Exatamente o mesmo `reservation_id` e versão histórica; sem delta em qualquer tabela. Não falhar por item agora `stock`. |
| B10 | Repetir após alocar outro item e elevar versão; após mudança comercial posterior permitida em fixture futura | Resposta histórica, não `version_conflict`; não exigir igualdade com totais/modo atuais. Não usar `update_order` C1 para contornar sua restrição de histórico. |
| B11 | Mesma chave, mudar pedido/item/expected_version individualmente | `idempotency_conflict`/23505, sem efeitos. Ator distinto tem chave própria e deve passar validações atuais, não recebe recibo do primeiro. |
| B12 | Owner aloca pago, depois downgrade para Free mantendo `sales.write` | Replay original funciona; tentativa nova de alocar outro item é negada por plano. Resolução de plano não pode barrar replay antes da leitura do recibo. |
| B13 | Após sucesso, produto fica indisponível ou reserva é finalizada por fluxo/fixture revisado | Replay histórico válido funciona, sem exigir produto atualmente elegível ou reserva ainda ativa. Não criar endpoint de finalização para testar. |
| B14 | Mesmo recibo, mas usuário perde `sales.write`, contexto/membership ou muda tenant | Replay negado pela autorização atual. Downgrade não é dispensa de autorização. |

## Permissões, rollback e recibos corrompidos

| ID | Ação | Resultado esperado |
| --- | --- | --- |
| S01 | Vendedor só `sales.write`, intermediate pago: criar stock e alocar; tentar movimento manual | RPCs de venda funcionam sem `inventory.write`; movimento manual continua negado. Nenhum grant novo de inventário. |
| S02 | Anônimo, sem sales.write, contexto incompleto; chamar helpers privados/DML direto | Acesso negado, sem efeitos. Confirmar ACL efetiva também para service_role; não interpretar bypass RLS como grant explícito de DML autorizado. |
| S03 | Falha induzida local depois da primeira reserva em criação multitem (p.ex. outro inventário no teto), ou após reserva antes de evento/recibo via harness descartável | Rollback total de reservas anteriores, agregado/versões, pedido/itens, contador, evento/recibo. Nenhum fallback disfarçando falha de integridade/teto. Não modificar arquivos/migrações existentes para injetar falha. |
| S04 | Falha na reserva após mudar modo para stock, ou falha de evento/recibo de alocação em harness local descartável | Item continua `make_to_order`, pedido/inventário versões antigas, sem reserva/evento/recibo parcial. |
| S05 | Fixture privilegiada: recibo com result NULL/não-objeto, chaves ausentes, tipo errado, UUID inválido, status errado, versão negativa/futura/overflow | `receipt_result_unavailable`/P0002, sem cast cru vazando como sucesso e sem nova operação. Testar cada mutação separada. Constraints podem impedir algumas corrupções: registrar bloqueio em vez de desabilitar segurança no ambiente compartilhado. |
| S06 | Result sintaticamente válido aponta item/reserva de outro pedido/tenant, quantidade divergente, reserva inexistente ou evidência histórica incompatível | Mesmo erro de recibo, zero efeitos; JSON válido não basta. Corrupção de hash que altera comparação pode produzir conflito, não classificar isso como teste de validator do result. |
| S07 | Recibo C1 após edição comercial permitida sem reservas | Mantém snapshot financeiro histórico; não exigir totais atuais. Recibos create/update continuam válidos e separados do validator allocate. |
| S09 | Pedido C2 inteiramente `make_to_order`, sem histórico: update após C2c com payload `make_to_order`, depois tentativa nova inteiramente `untracked` | Ambos falham `physical_order_edit_unsupported`/P0001. A verificação usa modos persistidos; IDs e demanda permanecem intactos. |
| S10 | Recibo create C1 com valores monetários adulterados mas dentro dos limites e aritmeticamente coerentes, em fixture local | Registrar limitação herdada: validator C1 não autentica valores históricos originais e pode aceitar. C2 não promete detectar essa corrupção. Allocation deve continuar vinculada ao evento e reserva históricos, não apenas à aritmética/forma JSON. |
| S08 | update_order C1 em pedido com reserva ativa, depois com somente liberada/consumida | `active_reservation_edit_unsupported`, depois `reservation_history_edit_unsupported`. Sem remover itens/histórico. A migration histórica C1 permanece inalterada; C2c mantém a precedência dos erros de reserva. |

## Concorrência — duas sessões reais, nunca “simular” com chamadas sequenciais

Abrir A/B em conexões distintas, transações explícitas e timeout de lock finito. Registrar início, bloqueio observado, commit/rollback e resultado final. Mutex global pode serializar antes de produto; não interpretar ausência de bloqueio no ponto imaginado como prova da hierarquia. Evitar barreiras de teste que esperem B chegar além de lock já retido por A.

| ID | Interleaving | Resultado esperado |
| --- | --- | --- |
| C01 | Duas criações stock disputam último disponível | Após primeira commit, segunda decide com saldo atualizado (fallback por grupo); soma reservada <= balance. Se primeira rollback, segunda pode reservar. |
| C02 | Duas alocações do mesmo pedido com V, attempts diferentes | Uma sucesso V+1; outra conflito de versão após esperar, sem segunda reserva. Mesma tentativa/payload nas duas sessões: uma execução e um replay idêntico. |
| C03 | Alocações em pedidos distintos disputam produto insuficiente para ambas | Uma integral; outra falta de estoque, nunca parcial/oversell. |
| C04 | Reserva ganha primeiro, movimento manual aguardando usa versão antiga do inventário | Movimento recebe `version_conflict` (versão aumentou por reserva mesmo sem mudar balance). Retry com versão nova que reduziria balance abaixo do reservado deve ser negado pelo guard B1. |
| C05 | Movimento manual ganha primeiro, reduz disponível e commit | Criação reavalia grupo e faz fallback; alocação reavalia e falha por insuficiência se não couber. Nada baseado em leitura anterior sem lock. |
| C06 | Produtos P/Q em ordens de payload opostas, criações/alocações versus movimento | Locks determinísticos e barreira de produto, sem ciclo introduzido pelo novo protocolo. Registrar qualquer deadlock real como falha a investigar; não alegar ausência de deadlocks sem executar. |
| C07 | Desativar/excluir produto concorre com reserva | Se reserva vence, guard B1 impede desativação/exclusão com reserva ativa; se mutação vence, nova reserva rejeita produto indisponível. |
| C08 | Downgrade/perda de permissão concorre com comando físico | Mutex global ordena contexto/plano; operação nova observa estado serializado correto. Replay permitido só com autorização atual válida. |
| C09 | update_order C2c versus alocação do mesmo pedido make_to_order | Lock de pedido serializa: edição primeiro falha pelo modo físico sem alterar versão; alocação pode prosseguir. Alocação primeiro cria histórico e edição é recusada por versão divergente ou reserva ativa conforme expected_version. Sem item órfão. |

Finalizar cada cenário com consulta de reconciliação e contagem de eventos/recibos. Resultado vazio de reconciliação em uma execução **não prova** segurança para todos os interleavings. Deixar status PENDENTE até existir evidência real reproduzível.
