# Etapa 7.1 — Auditoria técnica e planejamento de Pedidos

**Projeto:** Modulus Hub  
**Data:** 26/10/2026  
**Natureza:** análise do repositório e proposta para discussão; não constitui aprovação de arquitetura.  
**Entrega desta execução:** exclusivamente este documento. Nenhuma funcionalidade, migration, policy ou código existente foi alterado para a etapa 7.1.

## 1. Resumo executivo

Há fundamentos reutilizáveis de produtos, preços, precificação persistida, inventário, autenticação, permissões e planos. **Não há um agregado de Pedidos multi-tenant implementado**, com itens, reservas, pagamentos manuais e entrega transacional. Existe um CRUD substancial de vendas legadas (`closed_sales`), mas ele não pode ser promovido implicitamente a esse novo domínio.

Principais conclusões:

1. **Produtos e precificações são referências, não dependências obrigatórias da venda.** O preço atual do produto é opcional e diretamente editável. O pedido deve preservar descrição e preço negociado em snapshots próprios, sem recálculo retroativo.
2. **Inventário de produtos acabados controla saldo físico e movimentações, não reservas.** Não existem saldo reservado, disponibilidade líquida, atendimento de encomendas ou baixa vinculada à entrega de pedido.
3. **Aprendiz declara 3 pedidos; Visionário declara pedidos ilimitados.** Não existe contrato executável de contagem, período, exclusão, cancelamento ou janela de pedidos após downgrade. A janela dos três produtos mais recentes pertence a Produtos, não a Pedidos.
4. **Há um conflito de entitlement a decidir:** Pedidos é previsto para o Aprendiz, enquanto `inventory.*` exige Visionário. Não se deve contornar esse gate usando uma RPC de pedidos nem tornar Pedidos integralmente pago por associação.
5. **Vendas legadas apresentam lacuna de segurança confirmada nas fontes:** tabela sem `enterprise_id`, policy permissiva para autenticados e actions sem contexto empresarial. A exposição real no ambiente depende dos grants/policies implantados, não inspecionados aqui. Essa constatação não autoriza correção nesta etapa.
6. **Reserva, edição, cancelamento e entrega precisam de transações no PostgreSQL.** Várias chamadas independentes a RPCs de estoque não formam uma transação de pedido.
7. **Estado operacional e estado financeiro devem ser independentes.** Não reutilizar a lista de status legada como máquina de estados validada.

### Limites da evidência

A classificação abaixo significa implementação encontrada no código/migrations locais, não homologação em ambiente implantado. Não houve consulta ao banco remoto, inspeção de navegador, execução de SQL, testes, build ou migrations nesta auditoria. Comentários históricos como “NEW / UNAPPLIED” não comprovam o estado atual do banco. A existência de testes também não comprova sua execução.

As correções anteriores de equipe, provisionamento e autorização de pricing são consumidas como contratos atuais; **não são reabertas**. Nenhuma regressão desses escopos foi demonstrada aqui. Alterações preexistentes no workspace não pertencem à etapa 7.1.

## 2. Inventário dos módulos e contratos existentes

### 2.1 Legenda de maturidade

- **Implementada/utilizável no código:** fluxo, validação e persistência encontrados; implantação não verificada.
- **Parcial:** parte funcional, mas insuficiente para o requisito analisado.
- **Somente estrutural:** vocabulário, tipo ou configuração sem fluxo/enforcement completo.
- **Inexistente:** não encontrado no domínio necessário; não inferir existência por nome de permissão ou rota.

### 2.2 Estrutura e fronteiras

- `app/(authenticated)/`: shell autenticado, áreas `admin`, `empresa`, `estoque`, `impressoras`, `materiais`, `precificadora`.
- `lib/<domínio>/`: Server Actions, contratos e validações por domínio; exemplos: `products`, `inventory`, `spools`, `general-materials`, `pricing`, `plans`, `auth`.
- `components/<domínio>/`: interfaces especializadas e padrões locais de formulários/listas.
- `supabase/migrations/`: tabelas, RLS, RPCs, helpers privados e evolução dos contratos. Deve-se ler a última redefinição de cada função, não apenas sua primeira migration.
- `tests/sql/` e `supabase/tests/`: artefatos de validação; não são prova de comportamento implantado.
- Não foi encontrada camada de serviços/hook de pedidos pronta para reaproveitar. `hooks/` contém `useLanguage.ts`, não hooks de negócios para pedidos/clientes.

### 2.3 Matriz de capacidades reais

| Capacidade | Classificação | Evidência e contrato |
|---|---|---|
| Catálogo interno e preço atual | Implementada | `lib/products/actions.ts`: `ProductRecord`, `listInternalProducts`, `getInternalProduct`, `createInternalProduct`, `updateInternalProduct`, `setInternalProductActive`, `deleteInternalProduct`; mutações via RPC e controle de versão |
| Cadastro/edição manual de preço | Implementada | `components/admin/ProductForm.tsx`; preço vazio pode resultar em `null`; não exige cálculo vinculado |
| Precificação FDM persistida | Implementada | `lib/pricing/persistence-actions.ts`: `saveFdmPricingAction`, `saveManualFdmPricingAction`, `applyFdmPricingPriceAction`, consulta/detalhe/histórico |
| Snapshots e recibos de aplicação de preço | Implementada | `20261016000000_backend_pricing_persistence.sql`: `pricing_calculations`, `pricing_price_applications`, imutabilidade; evolução V2/V3 e autorização posterior |
| Status saved/applied/reviewed no histórico | Parcial/estrutural | `PricingHistoryItem.status` existe, mas queries do histórico/detalhe não obtêm esse ciclo a partir dos recibos e usam default `saved`; não é histórico completo de alterações manuais de preço |
| Estoque físico de acabados | Implementada | `20261020000000_finished_product_inventory.sql`: `product_inventory`, `product_inventory_movements`, `move_product_inventory` e RPCs de leitura |
| Carretéis físicos | Implementada | `20261017000000_fdm_filament_spools.sql` e `20261021000000_complete_filament_spools.sql`; saldo em gramas, movimentos e perfil próprio |
| Materiais gerais/componentes avulsos | Implementada como inventário | `20261022000000_general_materials_inventory.sql`; unidades/conversões, saldo, movimentos, histórico de custo e recibos. Não estabelece composição de produto |
| Reserva, saldo disponível e atendimento por pedido | Inexistente | Inventários têm saldo físico e movimentos; não há reserva nem vínculo transacional com pedido |
| BOM, ordem de produção e consumo automático de insumos | Inexistente | Linhas de custo da precificadora não constituem ficha técnica executável |
| CRUD de vendas legadas | Parcial para o novo requisito | `lib/sales/actions.ts`, rota `/admin/sales`, `closed_sales`; funcional como legado, sem agregado tenant-aware de pedidos |
| Pedidos com itens e entrega integral | Inexistente | Não encontrados pedidos/itens/reservas/fulfillment com o contrato requerido |
| Pagamentos manuais parciais e estornos auditáveis | Inexistente no novo domínio | Legado tem forma de pagamento e status, não ledger financeiro de pedido |
| Clientes/CRM | Inexistente | Nome/telefone de comprador no legado não são cadastro de clientes |
| Permissões `sales.*` | Somente estrutural para Pedidos | Matriz real de autorização existe, mas não implementa o domínio novo e não é chamada pelas actions legadas |
| Limites comerciais de pedidos/clientes | Somente estrutural | `lib/plans.ts`, `modulus_plan_limits`; sem enforcement de pedidos/clientes |
| Janela de três produtos no Free | Implementada, apenas Produtos | `private.stage6b_product_visible` e enforcement das RPCs de produto/imagem |
| Kanban | Inexistente | Não encontrado componente Kanban ou fluxo drag-and-drop; ícone `FolderKanban` não implementa essa capacidade |

Todos os nomes de migrations desta análise referem-se a `supabase/migrations/`.

### 2.4 Produtos e precificação: contratos que importam

`ProductRecord` em `lib/products/actions.ts:11–20` usa `price: string | null`, `version`, `active` e timestamps. A interface antiga `types/product.ts` não é o contrato de concorrência do produto interno.

`lib/pricing/persistence-actions.ts` oferece `searchProductsAction` com produto/preço/versão, salvamento separado da aplicação e consultas de snapshots. O seletor é referência de comportamento, não uma API de pedidos a reutilizar sem verificar suas permissões.

- Snapshots integrados V2 preservam fontes, entradas e resultado; V3 manual preserva entradas e fontes manuais, sem impor inventário.
- Aplicar preço é operação explícita. `20261026140000_apply_pricing_price_qualified_version.sql` e a redefinição em `20261026150000_pricing_actor_authorization.sql` aplicam a sugestão arredondada a duas casas e registram recibo.
- Salvar/aplicar cálculo não reserva nem consome estoque.
- Histórico de cálculos não é histórico integral de todas as edições do preço do produto.
- Linhas repetidas de fontes podem existir no snapshot V2; não se pode consumi-las automaticamente como BOM.

### 2.5 Inventário: contratos concretos

**Produtos acabados — `20261020000000_finished_product_inventory.sql`:**

- `product_inventory`: saldo `bigint` entre 0 e 1.000.000.000, versão, unique `(enterprise_id, product_id)`, FK composta para produto da mesma empresa.
- `product_inventory_movements`: `entry`, `exit`, `adjustment`; quantidade assinada, saldo anterior/posterior, motivo, ator, tentativa, versões e checks aritméticos. Histórico imutável; unique `(enterprise_id, actor_id, attempt_id)`.
- `move_product_inventory`: valida unidades inteiras, autoriza contexto, recupera tentativa antes de validar a versão atual, bloqueia produto e posição, atualiza saldo e ledger atomicamente.
- Posição ausente equivale a saldo/versão zero. Ajuste sem alteração não persiste recibo; não copiar essa limitação para operações de pedidos.
- Leitura via `list_product_inventory`, `count_product_inventory`, `get_product_inventory_detail`, `list_product_inventory_movements`, `count_product_inventory_movements`. As chamadas independentes não garantem um único snapshot consistente.
- `lib/inventory/actions.ts` distingue resultado incerto após despacho. `components/inventory/MovementForm.tsx` mantém payload/tentativa em estado React, não em recuperação durável após reload.

**Carretéis:** `filament_spools` e `filament_spool_movements`; gramas `numeric(12,3)`, preço de aquisição `numeric(12,2)`, custo por grama e custo da movimentação com escalas próprias. Reposição mantém a base original de custo; não representa nova compra com custo independente. Há movimentos imutáveis, controle de versão e tentativas, mas não reservas. `public.materials` legado não é o estoque físico canônico de carretéis.

**Materiais gerais:** `general_materials`, `general_material_movements`, `general_material_cost_history`, `private.general_material_receipts`. Quantidade/saldo `numeric(18,6)`, conversões m/cm e kg/g, custo histórico e movimentos. A unidade `unidade` permite frações no contrato atual. Os recibos de movimentos incluem operação sem delta; não pressupor que todos os inventários tenham a mesma semântica de retry ou custo.

**Bloqueios:** helpers existentes seguem lock global `modulus:enterprise-management:all-members`, lock do ator, linhas de identidade/usuário/membership/empresa e depois entidades. O lock global serializa operações participantes entre empresas: é conservador e limita throughput. Não se propõe removê-lo nesta etapa. Novas transações precisam respeitar essa hierarquia e ordenar produtos consistentemente.

### 2.6 Vendas legadas: o que existe e por que não equivale a Pedidos

Fontes: `20260826000000_create_closed_sales.sql`, `20260829000000_update_closed_sales_orders.sql`, `20260907000000_add_carrinho_perdido_status.sql`, `lib/sales/actions.ts`, `types/sales.ts`, `lib/validations.ts`.

- Actions reais: `getSales`, `getSaleById`, `createSaleAction`, `updateSaleAction`, `deleteSaleAction`; autenticação de sessão, rate limit nas mutações e `closedSaleSchema`.
- Dados de comprador, produto em texto, preço/custo, canais, data, forma de pagamento, detalhes e número de exibição legado. Alteração posterior permite preço/custo nulos.
- Status `em_conversao`, `orcado`, `pago`, `modelando`, `imprimindo`, `entregue`, `cancelado`, `carrinho_perdido`; misturam negociação, operação e financeiro. Não há validação transacional de transições com inventário.
- Sem `enterprise_id`, FK de produto, itens, versão, recibos idempotentes, reserva ou exclusão lógica. Delete é físico.
- Rota `app/(authenticated)/admin/sales/page.tsx` verifica `isLegacyEnabled()`; `lib/legacy-gate.ts` usa `MODULUS_LEGACY_FEATURES_ENABLED`. As actions não verificam esse gate nem `requireBusinessContext`/`sales.*`. Guard de layout/página não substitui autorização de action/banco.
- Policy declarada é `FOR ALL TO authenticated USING (true) WITH CHECK (true)`. Não foi encontrada migration posterior tornando essa tabela tenant-aware.

**Conclusão:** aproveitar padrões visuais, não persistência/autorização. Não migrar, incorporar, apagar ou alterar legado automaticamente. Eventual contenção de segurança e eventual importação exigem escopo aprovado e diagnóstico do ambiente; não fazem parte desta entrega.

## 3. Componentes e padrões reutilizáveis

| Fonte | Reaproveitamento proposto | Cuidado |
|---|---|---|
| `components/admin/ProductForm.tsx` | Labels, mensagens de campo, pending, formulário estreito e botões responsivos | Itens múltiplos exigem novo contrato de formulário |
| `components/admin/SalesListClient.tsx` | Filtros na URL, chips, busca/ordenação, estados vazio/erro, coordenação de detalhes | Tabela legada, sem Kanban ou segurança de Pedidos |
| `components/admin/SaleFormModal.tsx` e `SaleDetailModal.tsx` | Agrupamento visual, modal com rolagem e ações | Não reutilizar payload/estado financeiro legado |
| `components/admin/DeleteSaleModal.tsx` | Confirmação explícita e feedback | Não copiar hard delete |
| `components/admin/ProductArchiveButton.tsx` e `ProductDeleteButton.tsx` | Confirmações de ações distintas | Arquivar, cancelar e excluir pedido terão semânticas próprias |
| `components/plans/CreationLimitNotice.tsx` | Aviso de capacidade e CTA | UI não faz enforcement; capacidade de pedidos ainda não existe |
| `components/plans/PlanAccessNotice.tsx` | Mensagens de plano/acesso | Diferenciar papel, entitlement, regularização, seleção e cota |
| `components/inventory/MovementForm.tsx` | Versão esperada, tentativa congelada, resultado incerto | Exigir recuperação durável para entrega/pagamento |
| `ProductInventoryFilters.tsx` e `ProductInventoryTable.tsx` | Filtros e apresentação de saldo/histórico | Disponível e reservado são informações novas |
| `components/pricing/PricingSnapshotSources.tsx` | Apresentação de fontes congeladas | Não estabelece vínculo obrigatório com precificação |

Padrões existentes usam grid responsivo, tabelas com `overflow-x-auto`, modais limitados em altura e estado local com transições React. Não há base de DnD pronta em `package.json`. No MVP, troca de etapa por botão/menu acessível pode preceder arrastar cartões; Kanban não deve depender de gesto para funcionar.

## 4. Requisitos já definidos

São requisitos do produto, não constatações de implementação:

- Cadastro, consulta, edição e acompanhamento de pedidos, com múltiplos itens e Kanban principal.
- Desktop com operações completas; mobile com consulta e atualização rápida, sem impedir ações essenciais.
- Item de catálogo ou personalizado sem produto fictício; quantidade e preço unitário negociado.
- Desconto no pedido, frete/entrega e total calculado.
- Histórico operacional, pagamentos manuais pendente/parcial/pago e entrega apenas integral.
- Aprendiz com 3 pedidos, Visionário ilimitado no lançamento, Magnata não ativável.
- Downgrade preserva dados. Não define, por si só, quais dados ficam operáveis/visíveis.
- Comprador pode ser identificado sem cadastro de cliente. CRM é opcional e não será criado aqui.
- Intenção de reservar produto no pedido, liberar no cancelamento e baixar definitivamente na entrega; detalhes de encomendas e entitlement ainda exigem aprovação.
- Preservar matriz de permissões, isolamento empresarial, histórico financeiro/descritivo e integridade transacional.
- Sem integração Asaas; pagamentos são registros manuais. Sem mudança no motor FDM.

## 5. Lacunas identificadas

### Bloqueadoras antes de implementar

1. Definir o significado de “3 pedidos”: entidade contada, período, estados incluídos e tratamento de cancelamento/arquivamento/exclusão.
2. Resolver divergência entre autoridade por empresa e rótulo “Pedidos (por usuário, recurso futuro)” em `app/(plans)/meu-plano/page.tsx:94`.
3. Aprovar visibilidade e operações após downgrade, principalmente para pedidos com estoque reservado e pagamento pendente.
4. Resolver Pedidos no Aprendiz versus inventário pago, sem bypass de autorização.
5. Aprovar modelo de reserva, momento da alocação e encomenda sem saldo físico.
6. Aprovar transições, cancelamento, pagamentos/estornos e papéis responsáveis.

### Lacunas técnicas para implementação posterior

Agregado de pedido e itens; snapshots; ledger financeiro; histórico de eventos; reserva e disponibilidade; recibos por operação; RPCs transacionais; cotas concorrentes; regras de archive/delete de fontes reservadas; leitura consistente do detalhe; Kanban; validação de entradas/retornos; testes de isolamento, concorrência e falha pós-commit.

A precificadora não resolve manufatura, disponibilidade ou consumo. Não incluir BOM/produção de insumos disfarçada de integração com pedidos.

## 6. Proposta de arquitetura

**Tudo nesta seção é proposta sujeita à aprovação. Nomes de tabelas, RPCs e rotas não existem por força deste documento.**

### 6.1 Fronteiras e camadas

- Novo domínio `orders`, separado de `closed_sales`; manter `sales.*` como candidato à autorização, sem reaproveitar o CRUD legado.
- Futuro `lib/orders/`: contratos discriminados, validação Zod de entrada/retorno, Server Actions finas, consultas e tradução de erros.
- Futuro `components/orders/` e rota candidata `/pedidos`: interface específica, com padrões visuais existentes.
- PostgreSQL como autoridade de estado, totais, capacidade, reserva, pagamentos e entrega.
- Server Action deriva contexto, valida formato, chama **uma RPC por comando de negócio** e revalida a interface após confirmação. Nunca encadeia baixa de cada item como se fosse transação única.
- Reaproveitar a autorização central vigente. Não criar autorização alternativa do tipo “ator informado pelo browser”. SQL pode receber IDs de alvo, mas resolve empresa/ator pelo contexto autenticado e valida todos os relacionamentos.

### 6.2 Comandos candidatos e suas responsabilidades

| Comando/RPC proposto | Responsabilidade atômica |
|---|---|
| `create_order` | Autorizar, resolver plano, bloquear cota, validar itens/fontes, congelar snapshots, calcular total, criar pedido/itens, reservar quando aplicável, registrar evento e recibo |
| `update_order` | Validar versão/estado, recalcular finanças e diferença de reservas, substituir itens permitidos e auditar alteração sem apagar história |
| `transition_order` | Validar transição e pré-condições; ajustar alocações previstas para essa transição, evento e versão |
| `allocate_order_stock` | Alocar saldo físico já existente a itens sob encomenda; nunca criar saldo físico fictício |
| `cancel_order` | Validar papel/versão, liberar todas as reservas ativas e registrar motivo; não apagar pagamentos nem presumir devolução financeira |
| `deliver_order` | Validar pedido completo, todas as alocações exigidas e autorização; consumir reservas, baixar físicos, inserir movimentos e evento de entrega e recibo, tudo ou nada |
| `record_order_payment` / `reverse_order_payment` | Registrar recebimento ou contrapartida manual validada, recalcular saldo financeiro, evento/recibo e versão |
| Consultas de lista/detalhe/capacidade | Aplicar mesmo tenant, papel e política de acesso; detalhe agregado consistente, sem mascarar falha do histórico como histórico vazio |

Os nomes podem mudar. Funções internas de estoque chamadas por esses comandos devem operar na mesma transação e manter as checagens centrais. Não conceder à aplicação um caminho genérico para escrever ledgers ou alterar saldos.

### 6.3 Invariantes obrigatórias no PostgreSQL

1. Todos os dados e referências pertencem à mesma empresa, inclusive itens, produto, reserva, movimento, pagamento e ator resolvido.
2. Pelo menos um item válido em pedido confirmado; quantidades positivas, limites explícitos de itens/textos/valores e números finitos.
3. Totais calculados pelo servidor, com política monetária única. O cliente pode enviar intenção, nunca total autoritativo.
4. `fisico >= 0`, `reservado >= 0`, `reservado <= fisico`, `disponivel = fisico - reservado` para estoque controlado.
5. Reserva ativa por item não excede quantidade pendente de entrega; alocações agregadas por produto não excedem saldo. Cancelado/entregue não mantém reserva ativa.
6. Entrega é única, integral e indivisível. Sem baixa parcial observável caso algum item falhe.
7. Edição não elimina fato financeiro/operacional nem permite total menor que o líquido recebido sem tratamento explicitamente aprovado.
8. Pagamentos e estornos têm valores positivos e direção explícita; contrapartidas não excedem valores reversíveis; não aceitar recebimento excedente no MVP sem contrato de crédito/troco.
9. Versão esperada para toda mutação concorrente; histórico, reservas/movimentos financeiros e recibos preservados contra UPDATE/DELETE indevidos.
10. Uma tentativa idempotente, mesmo payload, devolve resultado persistido; payload diferente conflita. Não duplicar pedido, reserva, pagamento ou baixa.
11. Cota validada sob lock na transação de criação; chamadas diretas e concorrentes não escapam por contagem feita na UI.
12. Archive/delete de produto ou saída/ajuste manual de estoque não pode invalidar reservas ativas.

CHECK/FK/UNIQUE cobrem invariantes locais; agregados entre linhas exigem comandos exclusivos, locks, triggers/guards quando necessários e privilégios restritos. Não prometer que um CHECK isolado possa validar soma de pagamentos/reservas.

### 6.4 Concorrência, idempotência e falhas

- Manter ordem de autorização existente; após locks de contexto/empresa/cota, adotar ordem documentada entre pedido, produtos e posições. Ordenar produtos por UUID e agrupar linhas repetidas do mesmo produto antes de bloquear/reservar.
- Comparar essa ordem com todos os escritores existentes de produto/estoque/delete antes de implementar. O lock global atual não substitui uma hierarquia coerente nem deve ser removido incidentalmente.
- Bloquear pedido e posições; usar posição única por empresa/produto e inserção protegida para saldo antes inexistente. Não confiar em um `SELECT` de saldo sem lock.
- Persistir recibo privado por empresa/ator/tentativa, comando, hash de payload canônico, alvo e resultado. Incluir resultados sem alteração que sejam aceitos como sucesso.
- Autorizar acesso ao recibo antes do replay; recuperar tentativa confirmada antes de rejeitar a versão agora obsoleta. Replay não deve executar novamente a mutação nem permitir acesso empresarial revogado. Downgrade/recuperação precisa de regra explícita, não de bypass.
- Timeout após envio significa **resultado incerto**, não falha segura. UI conserva a mesma tentativa/payload e consulta ou repete o comando. Não gerar novo UUID automaticamente.
- Reconsulta após conflito exige nova intenção/versão e nova tentativa. Testar perdas de resposta e tentativas simultâneas com o mesmo ID.
- Uma transação malsucedida reverte pedido, reservas, saldo, pagamentos e eventos daquele comando. Não compensar no JavaScript operações que deveriam ser atômicas.

## 7. Proposta de entidades e relacionamentos

### 7.1 Convenções propostas

UUID como identidade; `enterprise_id NOT NULL`; `created_at`/`updated_at` em `timestamptz`; ator interno validado; uniques `(enterprise_id, id)` para FKs compostas. Números de exibição, se adotados, são por empresa, sem servir de autorização. Índices começam pelo tenant nas consultas empresariais. UUID ou número não protege registro de outra empresa.

| Entidade proposta | Responsabilidade e campos essenciais | Integridade, índices e retenção |
|---|---|---|
| `orders` | Empresa, ID/número, status operacional, versão, comprador snapshot, observações, prazo, subtotal, desconto, frete, total, moeda, datas de entrega/cancelamento, autor, arquivamento | Unique de número por empresa; índices `(enterprise_id,status,created_at,id)`, prazo e histórico de criação; total coerente; sem hard delete no fluxo normal |
| `order_items` | Empresa/pedido, posição, tipo `catalog/custom`, produto opcional, nome/descrição snapshot, quantidade inteira, preço unitário, total da linha, modo de atendimento, procedência opcional de preço/cálculo | FK composta para pedido/produto; unique posição por pedido; CHECK catálogo exige produto e personalizado não exige cadastro; quantidade/preço limitados; sem exclusão em cascata de histórico |
| `order_events` | Empresa/pedido, sequência, tipo, status anterior/novo quando aplicável, ator, data, motivo, versão e metadados limitados da mudança | Append-only; índice `(enterprise_id,order_id,sequence)` unique; evento de criação, edição relevante, transição, cancelamento, entrega e ação financeira; não copiar PII desnecessária para metadados |
| `order_payments` | Empresa/pedido, tipo recebimento/estorno, valor, moeda, método manual, data efetiva/data de registro, ator, nota/referência, pagamento original no estorno | Append-only; FKs compostas; valor positivo; estorno limitado sob lock; índices por pedido/data e origem; financeiro não some ao cancelar |
| `order_stock_reservations` | Empresa, pedido/item, produto/posição, quantidade, estado `active/released/consumed`, timestamps, motivo/ator da finalização | FKs compostas garantem produto do item/posição; quantidade positiva; unique parcial para reserva ativa por item quando modelo usar uma alocação ativa; índice por produto/estado e pedido; histórico preservado |
| Posição de estoque existente ampliada | `product_inventory.balance` continua físico; avaliar `reserved_balance` agregado para checks e consulta eficiente | CHECK reservado entre zero e físico; soma de reservas e agregado atualizados sob os mesmos locks; não manter dois escritores independentes |
| Recibos privados de comando | Empresa/ator/tentativa, comando, payload/hash, resultado e criação | Unique da chave; escrita somente interna; replay autorizado; não expor recibos de outro ator/tenant |
| Vínculo de fulfillment com ledger existente | Referência inequívoca pedido/item/entrega/movimento para rastrear baixa | FK composta e unicidade que impeçam segunda baixa; pode ser tabela de ligação se não couber ampliar ledger sem quebrar contrato |

### 7.2 Comprador sem CRM

Proposta MVP: snapshot no pedido com nome de exibição obrigatório (aceitar “Consumidor não identificado” explicitamente), telefone e e-mail opcionais, endereço/instrução de entrega opcional e somente quando necessários. Sem CPF/CNPJ obrigatório. Validar comprimento e formato sem tornar telefone obrigatório.

Não criar `customers`, nem contar cada comprador como cliente na cota futura. Futuro `customer_id` opcional não substitui o snapshot histórico. Retenção, anonimização e acesso a PII exigem política posterior; arquivar não equivale a anonimizar, e retenção financeira não justifica coleta ilimitada.

### 7.3 Estratégia de exclusão e acesso

- Recomenda-se **cancelamento + arquivamento**, sem exclusão física de pedido, pagamentos, entrega ou histórico.
- Arquivar afeta organização visual, não o fato financeiro nem, automaticamente, a cota. Política de contagem depende da decisão D1.
- Itens podem mudar antes do congelamento acordado, com evento de alteração; após entrega/cancelamento, ficam imutáveis. Não apagar snapshots quando produto for alterado/arquivado/excluído logicamente.
- RLS para leitura de todas as entidades deve usar tenant, permissão e política de acesso de pedido pai. Uma janela não pode proteger só `orders` e deixar itens/pagamentos acessíveis por ID.
- Revogar DML direto dos agregados/ledgers onde necessário e conceder comandos estreitos. `SECURITY DEFINER` exige `search_path` fixo/vazio, referências qualificadas, grants mínimos e autorização explícita no corpo; RLS não substitui essa validação.
- Entidades privadas e helpers não recebem execute público. Não ampliar caminhos de service role para comandos comuns de Pedidos.

## 8. Ciclo de vida dos pedidos

### 8.1 Estados candidatos

| Estado | Significado | Edição proposta |
|---|---|---|
| Novo | Pedido real criado, ainda não iniciado; não é orçamento/carrinho | Itens, comprador e valores editáveis com versão e realocação atômica |
| Aguardando produção | Há trabalho/encomenda pendente | Edição comercial controlada; mudanças refazem alocação e invalidam prontidão |
| Em produção | Trabalho iniciado, sem implicar consumo automático de insumos | Comprador/notas/prazo; itens/valores exigem retorno explícito à etapa anterior e motivo |
| Pronto | Checklist completo; estoque exigido integralmente reservado | Notas/contato; não alterar itens/valores sem voltar à etapa apropriada |
| Entregue | Pedido inteiro entregue; baixa definitiva concluída quando controlada | Sem alteração de itens/total/status; financeiro permite recebimento/estorno conforme política |
| Cancelado | Operação encerrada e reservas liberadas | Sem reabertura no MVP; acerto financeiro manual auditável permanece possível |

### 8.2 Transições candidatas

- `Novo → Aguardando produção`, quando houver encomenda; `Novo → Pronto`, quando todos os requisitos estiverem atendidos.
- `Aguardando produção → Em produção → Pronto`.
- Retornos `Em produção → Aguardando produção`, `Pronto → Em produção` ou `Pronto → Novo`, conforme origem e motivo obrigatório. Retorno não libera reserva automaticamente sem comando que ajuste os itens/modo de atendimento.
- `Pronto → Entregue` somente por `deliver_order`, nunca por simples update do campo status.
- Qualquer estado não terminal pode ir para `Cancelado` com permissão/motivo e liberação atômica. Produção já executada não é desfeita pelo cancelamento.
- `Entregue` e `Cancelado` são terminais operacionalmente no MVP. Devolução física, reentrega e reabertura exigiriam contratos adicionais.

Não assumir que essas transições já estão aprovadas. Orçamento/rascunho, se necessário, deve ter regra própria de contagem e reserva, não um “Novo” ambíguo.

### 8.3 Gatilhos de estoque e financeiro

- Ao criar pedido com item de estoque: reservar a quantidade física exigida ou rejeitar atomicamente; não criar pedido parcialmente reservado sem modo explícito de encomenda.
- Item sob encomenda: registrar demanda sem confundi-la com reserva. Após produção/entrada física, alocar por comando explícito; bloquear `Pronto` enquanto faltar estoque exigido.
- Cancelar: liberar reserva; não gerar entrada física porque a peça ainda não foi baixada.
- Entregar: consumir reserva e baixar físico no mesmo comando para todos os itens controlados. Para itens sem controle, exigir checklist/atesto de atendimento, sem inventar posição de estoque.
- Estado financeiro derivado: líquido recebido zero = pendente; entre zero e total = parcial; igual ao total = pago. Pedido de total zero é pago/sem valor a receber por convenção explícita, sem gerar pagamento fictício.
- Proposta: pagamento não bloqueia entrega no MVP; exibir alerta/confirmação para saldo pendente. Se o negócio exigir quitação, a condição deve ser imposta no banco, não só na UI.
- Cancelamento com recebimento não é estorno automático. Mostrar saldo a devolver e exigir lançamento manual de contrapartida; decidir se cancelamento pode preceder o acerto (D7).

### 8.4 Quem executa

Consulta e histórico: `sales.read`. Criação, edição e transições normais: candidato `sales.write`. Cancelamento: recomendação `sales.delete`, mantendo bloqueio para operator. Pagamento/estorno e encerramento precisam de ratificação na seção 10; não são permissões novas automaticamente concedidas. Todas as transições exigem papel **e** acesso empresarial/plano válidos.

## 9. Integração com produtos, preços e inventário

### 9.1 Preço e memória histórica

1. Selecionar produto interno autorizado e ativo, usando consulta específica do domínio. Exibir seu preço atual como referência, com preço negociado editável e confirmação de preço ausente.
2. Congelar nome, descrição relevante, quantidade, preço unitário e origem `catalog/custom`. Preservar `product_id` para rastreabilidade, sem depender de sua disponibilidade futura para mostrar o pedido.
3. Se registrar cálculo de origem, usar referência opcional e snapshot mínimo autorizado, não leitura viva que recalcule o pedido. Preço de catálogo, sugestão de cálculo e preço negociado são conceitos distintos.
4. Produto arquivado/deletado logicamente não altera valores nem apaga itens históricos. Não permitir adicioná-lo como novo item sem regra de seleção apropriada.
5. Edição de produto ou nova aplicação de preço jamais propaga para pedido existente. “Atualizar preço do item” deve ser ação comercial explícita, versionada e auditada, quando permitida.

### 9.2 Contrato monetário candidato

MVP em BRL: quantidade inteira de peças; valores de venda com duas casas; transporte como string decimal canônica ou centavos inteiros dentro de faixa segura. Banco usa tipo exato e valida escala/limites. Evitar `Number`/float como autoridade de soma.

- `subtotal = soma(quantidade × preço_unitário)`.
- `total = subtotal − desconto_valor + frete_valor`.
- Desconto/frete não negativos; desconto limitado ao subtotal; total não negativo e dentro do limite aprovado.
- Recomenda-se desconto absoluto no MVP. Se percentual for aceito, congelar base, percentual e valor derivado, com regra única de arredondamento.
- Com preço de duas casas e quantidade inteira, a linha não precisa de arredondamento adicional. Taxas/impostos, rateio contábil de desconto por item e moedas múltiplas ficam fora do MVP.
- Recusar valores com escala excessiva ou arredondar apenas em ponto explicitamente definido e exibido; nunca arredondar silenciosamente de maneiras diferentes no cliente e no SQL.

### 9.3 Reserva e disponibilidade

**Recomendação técnica condicional ao entitlement aprovado:** reserva explícita por item, agregado reservado na posição de estoque, físico preservado até entrega.

Exemplo: físico 10, reservado 6, disponível 4. Pedido novo de 5 unidades de estoque falha; dois pedidos simultâneos de 3 não podem ambos reservar. Na entrega de uma reserva de 3: físico passa a 7, reservado a 3, disponível continua 4. No cancelamento dessa reserva, físico não muda e disponível aumenta 3.

- Linhas repetidas do mesmo produto são agregadas na validação/locks, mantendo rastreabilidade por item.
- Alterar quantidade de 2 para 4 reserva somente diferença; reduzir libera diferença; trocar produto libera/aloca em uma única transação. Se nova alocação falhar, preservar tudo como estava.
- Saída ou ajuste manual não pode reduzir físico abaixo do reservado. É necessário incluir guarda nos escritores atuais de estoque; integrar apenas a nova RPC deixaria um bypass de integridade.
- Produto com reserva ativa não pode ser excluído logicamente ou arquivado de forma que impeça sua conclusão. Recomendação: bloquear archive/delete enquanto houver reserva, pois hoje arquivo impede mutações de estoque. Alternativa de permitir atendimento de reservas antigas exige exceção estreita aprovada.
- Produto fora de janela após downgrade não deve impedir consultar snapshot do pedido nem liberar reserva. Operações sobre a referência física precisam de contrato específico, não leitura arbitrária de catálogo oculto.

### 9.4 Itens sob encomenda e personalizados

Separar **origem do item** (catálogo/personalizado) de **modo de atendimento**:

- `stock`: produto registrado, reserva física integral ao confirmar pedido.
- `make_to_order`: demanda a produzir; nenhuma reserva sobre saldo inexistente. Entrada de produto acabado é explícita, seguida de alocação antes de prontidão/entrega.
- `untracked`: personalizado ou venda sem controle físico, atendida por confirmação operacional. Não altera saldo de produto/insumo.

Esses modos são proposta, não autorização para Aprendiz usar inventário pago. Um personalizado não exige produto fictício; no MVP pode ser `untracked`. Rastrear estoque específico de personalizado, lotes e ordens de fabricação seria expansão de domínio.

Alternativas para catálogo sem saldo: rejeitar venda; aceitar encomenda sem reserva e alocar depois; ou reservar parcialmente o disponível e manter faltante. Recomenda-se encomenda explícita sem saldo negativo, com alocação posterior. Reserva parcial por item pode ser adiada para reduzir complexidade, mantendo entrega sempre integral.

Não consumir automaticamente filamento/embalagens a partir de cálculo. Produção pode continuar registrando entrada de acabados e consumo manual de insumos nos módulos existentes, sem afirmar que estão integrados a uma ordem de produção.

### 9.5 Rastreabilidade e correção

- Cada baixa deve apontar para a entrega/pedido e suas reservas; cada liberação deve registrar motivo e ator.
- Conferência compara soma das reservas ativas com agregado reservado, ledger físico com posição e entrega com movimentos vinculados.
- Inconsistência bloqueia conclusão sensível e gera diagnóstico. Não “corrigir” apagando histórico ou liberando reserva silenciosamente.
- Ajuste físico exige saldo contado compatível com reservas ou resolução explícita das alocações afetadas, com motivo. Reservas não devem expirar automaticamente sem contrato de prazo.
- Eventual comando de reconciliação será privilegiado, idempotente e auditável, não ferramenta de edição livre de saldo.

## 10. Estratégia de permissões e cotas

### 10.1 Contrato de autorização encontrado

Fontes: `lib/auth/context.ts`, `lib/plans/permission-capabilities.ts`, `20261026060000_plan_business_regularization.sql` e **última autoridade SQL** `20261026150000_pricing_actor_authorization.sql`.

- `private.can_access_enterprise_for_user`: avaliador interno central da matriz.
- `private.can_access_enterprise`: wrapper autenticado por JWT.
- `private.plan_permission_allowed`: predicado adicional de plano/estado empresarial.
- Papel não basta: identidade, usuário, membership e empresa válidos, contexto unívoco, senha e acesso comercial também são exigidos.
- No plano efetivo gratuito, acesso operacional é owner-only. Admin/operator não ganham acesso gratuito porque têm `sales.write` na matriz de papéis.

| Permissão existente | owner | admin legado | operator |
|---|---:|---:|---:|
| `sales.read` | Sim | Sim | Sim |
| `sales.write` | Sim | Sim | Sim |
| `sales.delete` | Sim | Sim | Não |

Mapeamento **proposto**, sem mudança da matriz: criar/editar/transicionar normalmente em `sales.write`, ler histórico em `sales.read`, cancelar em `sales.delete`. Receber manualmente pode usar `sales.write`; estornar recomenda-se `sales.delete` como operação destrutiva financeira. Se granularidade específica for necessária, submeter novas permissões e impacto na matriz antes da migration. Não equiparar automaticamente “delete” a cancelamento/estorno sem aprovação.

`inventory.*` é explicitamente pago no mapa de capacidades. Uma operação `sales.write` não deve implicitamente conceder estoque a todos os papéis ou planos. Também é necessário decidir a autorização composta de entrega quando houver item controlado, e quem poderá somente concluir/liberar reservas antigas após downgrade.

### 10.2 O que a etapa 6 realmente define

`20261025000000_stage6_plans_entitlements.sql:75–85` e `lib/plans.ts:16–20` declaram Aprendiz `orders=3`, Visionário ilimitado e Magnata indisponível para ativação no lançamento.

Não definem enforcement de pedido. `private.lock_plan_quota` contempla criação de produtos, materiais compartilhados e impressoras, não pedidos. `get_my_creation_capacity` de `20261026090000_creation_capacity.sql` aceita produtos/materiais compartilhados, não pedidos.

**Referência de Produtos, não contrato de Pedidos:**

- Criação conta todos os produtos não excluídos da empresa, inclusive arquivados.
- Janela gratuita usa três produtos não excluídos mais recentes por `(created_at DESC, id DESC)`, antes de filtros; arquivo não sai do ranking.
- `20261026000000_stage6b_access_restrictions.sql` cobre leitura; `20261026080000_product_window_rpc_enforcement.sql` cobre mutações definer, inclusive tratamento de recibos após exclusão.
- Não foi encontrado equivalente para pedidos. Notas antigas com outras quantidades ou suposições de janela não substituem o contrato atual executável.

### 10.3 Proposta de enforcement, após decidir semântica

- Resolver plano efetivo da empresa, não plano enviado pelo cliente.
- Serializar criação por empresa/feature no banco, contar pela regra aprovada e inserir na mesma transação. Revalidar acesso/plano sob os locks existentes.
- Replay de criação recupera recibo sem gastar uma segunda vaga, respeitando autorização atual. Não usar chave nova em retry incerto.
- Expor capacidade autorizada para feedback de UI, sem torná-la autoridade de criação.
- Se houver janela, aplicá-la também a detalhe, itens, eventos, pagamentos, exportações, totais e comandos SECURITY DEFINER, com ranking determinístico e independente dos filtros.
- Preservar dados no downgrade; jamais apagar ou cancelar automaticamente para satisfazer a cota.
- Recomenda-se manter leitura histórica e permitir resolução de pedidos ativos anteriores, bloquear novas criações quando exceder e impedir novas alocações não autorizadas. Isso **não é o modelo atual de Produtos** e depende de aprovação comercial e de acesso estreito para acerto de reservas.

## 11. Proposta de telas e fluxos

### 11.1 Central `/pedidos`

Kanban principal por estado operacional, com alternância para lista. Cartão limpo: número, comprador, resumo de itens, total, badge financeiro e prazo; estoque pendente aparece como alerta discreto. Entregues/cancelados podem ficar recolhidos/filtrados sem mudar regra de contagem. Contadores refletem filtros e permissões, com semântica explícita.

Busca por número/comprador/descrição snapshot, filtros operacionais, financeiros e prazo; ordenação e paginação/carga por coluna. Não carregar todos os pedidos ilimitados no browser. Contagem e paginação não alteram ranking de eventual janela contratual.

### 11.2 Criar/editar

Comprador básico → itens → desconto/frete → revisão. Item de catálogo mostra referência de preço e disponibilidade autorizada; personalizado pede descrição/preço sem criar produto. Mostrar modo de atendimento e quando haverá reserva. Total calculado na UI é prévia; confirmação usa retorno do banco.

Conflito de versão ou saldo informa quais dados precisam ser recarregados sem perder intenção do formulário. Cota atingida desabilita criação com explicação, mas tentativa direta continua barrada no banco.

### 11.3 Detalhe

Resumo operacional/financeiro; itens e snapshots; atendimento/reservas quando autorizado; comprador/entrega; histórico; lançamentos manuais; ações de edição/transição/cancelamento/entrega. Distinguir pagamento pendente de produção pendente.

A entrega exige confirmação do pedido completo. Cancelamento mostra reservas a liberar e eventual saldo a devolver. Pagamento pede valor, método, data e nota; estorno aponta o lançamento original. A interface não elimina pagamentos para “corrigir” um erro.

### 11.4 Mobile e acessibilidade

Lista de cartões/uma coluna selecionada no mobile; ações rápidas explícitas para status/pagamento conforme permissão. Não exigir rolagem horizontal de seis colunas nem drag-and-drop. Desktop pode adicionar DnD depois, chamando os mesmos comandos e revertendo visualmente após rejeição. Foco, teclado, labels e confirmação de ações irreversíveis fazem parte do aceite.

Estados distintos: vazio real, filtro sem resultado, falha de leitura, acesso restrito, cota, conflito e resultado incerto. Não converter erro de histórico em lista vazia.

## 12. Riscos técnicos e operacionais

| Risco | Natureza/evidência | Severidade | Resposta proposta |
|---|---|---|---|
| Legado sem isolamento empresarial | Confirmado nas fontes de `closed_sales`/actions/policy; exposição remota não verificada | Crítica se acessível no ambiente | Não reutilizar; encaminhar diagnóstico/contenção separados antes do lançamento |
| Supor que 3 pedidos já tem enforcement | Lacuna confirmada: apenas declaração comercial | Alta | Aprovar contrato e criar enforcement transacional |
| Pedidos Aprendiz × inventário pago | Conflito confirmado entre requisitos e capacidades existentes | Alta | Decisão D3 antes de implementar integração |
| Reserva duplicada/overselling | Potencial do novo módulo | Alta | Locks, agregado reservado, uniques, idempotência e testes concorrentes |
| Saída manual consumir saldo reservado | Potencial após introduzir reserva; escritores atuais só conhecem físico | Alta | Atualizar guards de todos os escritores na mesma entrega de schema |
| Entrega parcialmente concluída | Potencial se usar múltiplas RPCs | Crítica | Um comando/uma transação com rollback integral |
| Alteração simultânea de itens/status/pagamento | Potencial | Alta | Lock do pedido + expected version + evento/recibo |
| Retry após commit duplicar baixa/recebimento | Potencial; resultado incerto já tratado no inventário | Alta | Recibo durável e tentativa estável recuperável |
| Preço retroativo/precisão monetária | Potencial se usar produto vivo/float | Alta | Snapshot, decimal exato e regra de escala única |
| Cancelamento com recebimento | Potencial, regra ainda não definida | Alta | Estado operacional separado, saldo a devolver e estorno auditável |
| Downgrade aprisionar reservas/pagamentos | Potencial | Alta | Acesso de resolução aprovado; não copiar janela de produto sem análise |
| Definer ignorar tenant/janela | Potencial no novo domínio | Crítica | Autorização explícita e FKs compostas; testes negativos via RPC direta |
| Archive/delete de fonte reservada | Gap confirmado nas regras atuais para reservas futuras | Alta | Guarda transacional; snapshots não resolvem estoque pendente |
| Serialização global de estoque | Confirmada nos helpers | Média para escala | Medir depois; preservar segurança e não refatorar equipe incidentalmente |
| Leitura de posição/histórico em chamadas separadas | Confirmada no inventário atual | Média | Detalhe agregado consistente; sinalizar falhas por seção |
| Sem recibo em ajuste sem delta de acabados/carretéis | Confirmado no código | Média | Não herdar padrão nos comandos novos; não corrigir fora de escopo |
| Usar snapshot de custo como BOM | Ausência de BOM confirmada; consumo incorreto é potencial | Alta | Sem consumo automático; produção fora do MVP |
| PII copiada excessivamente em eventos | Potencial | Média | Minimização, acesso por tenant e política de retenção |

Riscos confirmados não significam incidente confirmado. Riscos potenciais não são defeitos já demonstrados em um módulo de Pedidos que ainda não existe.

## 13. Decisões arquiteturais pendentes

**Nenhuma recomendação abaixo está aprovada por este documento. D1–D7 bloqueiam partes centrais da modelagem.**

| ID / decisão | Alternativas, vantagens e desvantagens | Recomendação para discussão |
|---|---|---|
| **D1 — Significado de 3 pedidos** | (A) Total histórico: simples e impede reciclagem, mas plano gratuito esgota definitivamente. (B) Não excluídos: próximo a Produtos, mas requer exclusão e permite reciclagem. (C) Simultâneos não terminais: útil no dia a dia, mas muda “3 pedidos” para “3 em andamento”. (D) Por período: renovável, exige janela temporal/timezone e contrato comercial novo | Confirmar limite **por empresa**. Não escolher silenciosamente contagem. C é atraente para uso contínuo, mas só pode substituir limite histórico se o produto aprovar explicitamente. Definir cancelados/arquivados e rascunhos junto |
| **D2 — Downgrade e histórico** | (A) Só últimos 3 visíveis: simetria com Produtos, mas oculta obrigações. (B) Todo histórico legível, novas criações limitadas, resolução de ativos antigos: preserva operação, exige exceções estreitas. (C) Tudo só leitura excedente: simples, mas aprisiona reserva/pagamento | B, com escopo de resolução explícito no banco, sem liberar todo o inventário. Se escolher A, definir janela e mecanismo de regularização antes de lançar |
| **D3 — Aprendiz e estoque pago** | (A) Pedidos gratuitos sem integração física; reserva só no pago: preserva entitlement, mas não oferece reserva universal. (B) Reserva/baixa limitada ao pedido inclusive no Free: fluxo uniforme, mas amplia capacidade comercial e exige autorização específica. (C) Pedidos somente pagos: simplifica estoque, contradiz requisito vigente | A como menor mudança de planos, sujeita a aceitar que intenção de reserva se aplica somente a pedidos controlados. Se reserva universal for obrigatória, aprovar B expressamente. Definir downgrade de reservas antigas em qualquer caso |
| **D4 — Momento e forma de reserva** | (A) Na criação de pedido real: protege promessa, ocupa saldo cedo. (B) Na confirmação posterior: admite rascunho, exige estado/ação adicional e não garante disponibilidade até lá. (C) Só quando pronto: simples, mas arrisca prometer duas vezes | A para item `stock`; se precisar orçamento, separar rascunho de pedido e cotas. Não reservar saldo inexistente |
| **D5 — Encomenda sem saldo** | (A) Rejeitar: menor implementação, limita negócios sob encomenda. (B) Demanda sem reserva até entrada/alocação: fiel ao físico, requer pendência explícita. (C) Reserva parcial/backorder: maior flexibilidade e complexidade. (D) Saldo negativo: simples aparência, quebra invariantes | B; adiar parcial por item e rejeitar D. Personalizado sem produto pode ser atendimento não controlado, sem estoque fictício |
| **D6 — Máquina de estados e edição** | (A) Estados operacionais propostos com congelamento progressivo: claro, requer retornos auditados. (B) Status livre: flexível, sem garantias de entrega/estoque. Reabrir terminais simplifica correção visual, mas exige reversão de todos os efeitos | A, terminais sem reabertura no MVP; aprovar retornos e limites de edição da seção 8 |
| **D7 — Papéis financeiros/cancelamento** | (A) Tudo em `sales.write`: sem novas permissões, mas operator poderia cancelar/estornar. (B) Escrita comum e recebimento em write; cancelamento/estorno em delete: preserva restrição destrutiva. (C) Novas permissões: mais granular, amplia matriz. Cancelar antes de devolver permite encerrar operação, mas exige saldo de devolução visível | B, após ratificação explícita da semântica. Permitir cancelar antes de devolver, mantendo obrigação financeira e registro manual posterior; não excluir pagamentos |
| **D8 — Entrega com saldo a receber** | (A) Permitir com alerta: adequado a venda a prazo. (B) Exigir quitação: reduz inadimplência, limita operação | A no MVP; aprovação comercial necessária. Sem entregas parciais em qualquer opção |
| **D9 — Desconto e precisão** | (A) Valor absoluto em BRL: simples e exato. (B) Percentual: comum, exige base e arredondamento congelados. Quantidade inteira combina com estoque acabado; fracionária amplia contrato | A, duas casas monetárias e peças inteiras, limites máximos aprovados; rejeitar excesso de escala |
| **D10 — Persistência de reservado** | (A) Somar reservas sob lock da posição: evita agregado duplicado, maior custo de consulta. (B) Agregado na posição + reservas: check local e leitura rápida, exige consistência transacional/reconciliação | B, com escritor único e teste de igualdade agregado/soma; revisar impacto nos contratos existentes de estoque |
| **D11 — Produto arquivado com reserva** | (A) Bloquear archive/delete: previsível, exige resolver pendências primeiro. (B) Arquivar e permitir somente fulfillment antigo: flexível, exige exceção de mutação que hoje não existe | A no MVP; exclusão lógica não apaga snapshot, mas deve respeitar reserva |
| **D12 — Relação com pricing e legado** | (A) Novo domínio e snapshot independente com proveniência opcional: respeita contratos. (B) Migrar legado/exigir cálculo: reúne dados, mas cria risco de tenant, histórico e restrição nova | A; eventual importação do legado é projeto separado, nunca backfill implícito |
| **D13 — Comprador e retenção** | (A) Snapshot básico: sem CRM e implantação menor. (B) Cliente obrigatório: melhora cadastro, bloqueia lançamento e exige cotas/PII próprias | A; definir retenção/anonimização antes de ampliar dados pessoais |

A aprovação deve registrar escolhas, exemplos de borda e impacto na matriz comercial. Não basta aprovar apenas nomes de tabelas.

## 14. Plano incremental de implementação

A divisão sugerida é mantida, mas **as fundações de reserva precisam estar em 7.2**. Não publicar um fluxo que promete estoque em 7.3 e só aprende a protegê-lo em 7.5.

### 7.2 — Contratos aprovados, banco, segurança e fundações de estoque

- **Objetivo:** transformar decisões aprovadas em invariantes executáveis.
- **Escopo:** entidades/constraints/FKs/RLS/grants, autorização reaproveitada, cota por empresa, snapshots monetários, máquina de estados, recibos, reserva/posição disponível e guards de estoque/archive/delete quando modo controlado fizer parte do MVP. Especificar hierarquia de locks.
- **Dependências:** D1–D7 aprovadas; D9–D11 fechadas para contratos correspondentes; confirmação dos contratos implantados antes de planejar migration incremental.
- **Entregáveis:** migrations novas revisadas, contratos de RPC, fixtures/asserções e documentação de decisão; sem edição retrospectiva de migrations históricas.
- **Aceite:** duas criações concorrentes para última vaga não excedem cota; reserva concorrente não excede físico; todos os vínculos rejeitam cross-tenant; grants/RLS e definer testados diretamente; saída manual não invade reserva; retry não duplica efeitos.
- **Riscos:** alteração de estoque afetar fluxos existentes, deadlock e acessos de downgrade. Mitigar com testes de contrato e transações pequenas.
- **Fora:** CRM, BOM, FDM, refatoração de equipe/planos, migração de vendas legadas e novas integrações financeiras.

### 7.3 — Cadastro, itens, comprador e financeiro básico

- **Objetivo:** criar/consultar/editar pedidos reais com valores históricos confiáveis.
- **Escopo:** Server Actions/validações, formulário multi-item, catálogo/personalizado, desconto/frete, detalhe, edição versionada, capacidade e registros manuais de pagamento/estorno conforme decisão. Criar/editar reserva na mesma transação desde o primeiro fluxo controlado.
- **Dependências:** 7.2 validada em banco de desenvolvimento; contratos de erro e recuperação de tentativa.
- **Entregáveis:** UI desktop/mobile básica, comandos de criação/edição/pagamento, snapshots e consultas autorizadas.
- **Aceite:** preço atual não altera pedido antigo; personalizado dispensa produto; total exato; edição concorrente conflita; pagamentos parciais/integrais e correções não duplicam; falha de reserva reverte criação/edição inteira; cota não pode ser burlada por action/RPC direta.
- **Riscos:** formulário perder intenção em conflito, origem de preço ambígua, financeiro divergente do total.
- **Fora:** automação de produção, relatórios contábeis, parcelamento/agendamento financeiro complexo e Asaas.

### 7.4 — Kanban, estados e acompanhamento

- **Objetivo:** acompanhamento operacional com histórico confiável.
- **Escopo:** Kanban/lista, filtros, pesquisa, transições autorizadas, retornos com motivo, cancelamento/liberação, histórico, checklist de prontidão e ações rápidas mobile. Drag-and-drop opcional, não pré-requisito.
- **Dependências:** transações e máquina de estados de 7.2/7.3; contrato de cancelamento e acerto financeiro.
- **Entregáveis:** central de pedidos e detalhe operacional responsivos.
- **Aceite:** transição inválida rejeitada no banco; duas ações concorrentes não criam estado impossível; cancelamento libera uma única vez; histórico identifica ator/antes/depois; filtros não burlam janela/cota; operador não acessa ação não autorizada.
- **Riscos:** mudança otimista de cartão mentir sobre resultado, status financeiro confundido com operacional.
- **Fora:** workflows configuráveis, automações e reabertura de terminais.

### 7.5 — Conclusão do fluxo de estoque, entrega e rastreabilidade

- **Objetivo:** fechar atendimento e baixa integral, sem adiar proteção de reservas já usada.
- **Escopo:** UX de disponibilidade/alocação de encomendas, entrega atômica de todos os itens, vínculos com ledger, diagnóstico de divergências, guardas finais de fonte e comportamento de reservas antigas no downgrade conforme aprovação.
- **Dependências:** fundações de estoque já presentes em 7.2, cadastro/transições validados, D3/D5/D8/D10/D11 fechadas.
- **Entregáveis:** fluxo completo reserva → liberação ou consumo, consultas de rastreabilidade e procedimentos de conferência.
- **Aceite:** exemplo físico/reservado/disponível confere; falha no último item reverte toda entrega; retry pós-commit recupera mesma baixa; cancelado não mantém reserva; entregue tem movimentos únicos correspondentes; ajuste manual respeita reservado; encomenda não entrega com alocação física faltante.
- **Riscos:** RPCs separadas produzirem conclusão parcial, writer antigo desconhecer reserva, downgrade impedir liberação.
- **Fora:** entregas parciais, devolução física completa, lotes/serialização, consumo automático de insumos e ordens de produção.

Se recursos de entrega ainda não estiverem disponíveis, versões intermediárias devem permanecer em homologação/feature gate claramente definido; não se apresentar como MVP operacional concluído.

### 7.6 — Validação funcional, segurança, concorrência e fechamento

- **Objetivo:** comprovar o fluxo aprovado no ambiente de desenvolvimento/homologação e registrar limitações.
- **Escopo:** testes unitários de validação/monetário, SQL transacional, múltiplas sessões concorrentes, chamadas diretas não autorizadas, E2E desktop/mobile, perda de resposta pós-commit, downgrade e regressão dos contratos integrados.
- **Dependências:** 7.2–7.5 completas; fixtures isoladas e autorização para executar os testes nos ambientes escolhidos.
- **Entregáveis:** matriz de evidências com ambiente/data/comando/resultado, guia operacional e pendências explícitas. Preparação de teste é distinguida de execução real.
- **Aceite:** critérios da seção 15 comprovados e decisões rastreáveis; sem bypass por UI/action/RPC/Data API.
- **Riscos:** confundir sucesso de TypeScript com validação de RLS/locks, teste sequencial passar sem testar concorrência.
- **Fora:** produção/deploy automático, revisão geral de equipe/provisionamento sem regressão evidenciada e mudanças comerciais não aprovadas.

## 15. Critérios para encerrar a etapa 7

### 15.1 Encerramento de 7.1 — esta análise

- [x] Mapear funcionalidades reais e separar implementado, parcial, estrutural e ausente.
- [x] Identificar o legado e sua lacuna de segurança nas fontes sem tratá-lo como Pedidos.
- [x] Demonstrar que a semântica detalhada de cota/janela de pedidos não existe no código.
- [x] Apresentar arquitetura, entidades, estados, snapshots, pagamentos e estoque como propostas.
- [x] Explicitar conflitos de entitlement e decisões de produto antes de escrever migrations.
- [x] Propor plano incremental sem postergar invariantes de reserva.
- [ ] Discutir e registrar aprovação/revisão das decisões com o responsável pelo produto. **Não realizado por esta entrega.**

A etapa 7.1 fornece material para aprovação; **não autoriza iniciar implementação automaticamente**.

### 15.2 Encerramento futuro da etapa 7 completa

- Decisões comerciais e arquiteturais aprovadas e refletidas nos contratos.
- Pedido com itens de catálogo e personalizados, edição controlada, desconto/frete e total exato, snapshots preservados após alteração/archive/delete de fontes.
- Kanban e lista com consulta/detalhe/histórico, mobile utilizável e nenhuma dependência exclusiva de DnD.
- Máquina de estados imposta pelo banco; operacional e financeiro independentes.
- Pagamentos pendente/parcial/pago e estornos manuais rastreáveis, inclusive cancelamento com saldo a devolver; sem Asaas.
- Reserva/disponibilidade conforme plano e modo aprovado; liberação e entrega integral atômicas, sem saldo negativo nem baixa duplicada.
- Saídas manuais, archive/delete e alocações não rompem reservas.
- Cota gratuita correta sob concorrência; Visionário ilimitado; Magnata não ativável; downgrade preserva dados e permite somente as operações aprovadas.
- Isolamento por empresa comprovado em tabelas filhas, consultas, RPCs definer e tentativas com IDs de outra empresa; matriz de papéis preservada.
- Retry com payload igual recupera resultado; diferente conflita; perda de resposta não duplica criação, recebimento ou entrega.
- Cenários concorrentes testados: última vaga, último saldo, mesmo pedido editado/transicionado, duas entregas, cancelamento versus entrega, pagamento versus edição/cancelamento e saída manual versus reserva.
- Falha injetada antes de concluir último item não deixa pedido, estoque, ledger ou histórico parcialmente alterados.
- Evidências reais de banco/homologação documentadas separadamente de testes locais de aplicação e de scripts somente preparados.
- Risco do legado encaminhado ao responsável e resolvido ou formalmente tratado para o lançamento; não escondido pela nova rota.
- Sem regressão demonstrada nos contratos de produtos, preço, precificação e inventários; sem ampliação indevida de autenticação, equipe, planos ou FDM.

**Próximo passo recomendado:** aprovar D1–D7 e o recorte do MVP, depois detalhar 7.2. Até lá, reservas, estados, entidades e políticas deste documento permanecem propostas, não contratos vigentes.
