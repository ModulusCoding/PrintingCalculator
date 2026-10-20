# Auditoria de aderência do Modulus Hub ao escopo do primeiro lançamento

**Data:** 20/10/2026  
**Método:** inspeção estática do working tree, rotas, componentes, actions, migrations, RPCs, RLS, documentação e scripts locais. Nenhuma funcionalidade foi implementada e nenhum código de produção foi alterado nesta rodada.

> **Regra de evidência.** “Implementado” significa que há fluxo e contrato representados no código. Isso não prova que a migration foi aplicada, que o banco remoto contém a estrutura, nem que Auth, SMTP, Storage, policies ou produção estão configurados. Migrations marcadas no próprio arquivo como `NEW / UNAPPLIED` permanecem condicionais.

## 1. Resumo executivo

O repositório já contém um núcleo relevante de identidade multiempresa, onboarding com confirmação de e-mail, troca obrigatória de senha, empresa/equipe/permissões, precificadora FDM, materiais, impressoras, produtos internos, carretéis e um desenho robusto de persistência/idempotência/concorrência para vários fluxos novos.

O lançamento, porém, **não está pronto**. As maiores ausências são: planos SaaS, escolha obrigatória de plano, assinatura/cobrança, limites, downgrade, pedidos novos com modelo operacional aprovado e dashboard comercial. A área de vendas existente é legada, usa `closed_sales`, não passa pelo contexto empresarial novo e não representa integralmente o fluxo de pedidos aprovado. O dashboard atual é de catálogos/produtos legados.

Há também dependências de implantação: persistência de precificação, carretéis e estoque de produtos prontos têm migrations recentes marcadas como não aplicadas; produtos prontos aparecem no working tree como não rastreados. O achado PRC-001 permanece confirmado: aplicação de um histórico salvo passa a enviar a versão do produto do snapshot e a RPC exige a versão atual, sem fluxo de atualização/confirmação na UI. O achado sobre `configVersion` fora do hash **não** é bug: a decisão foi aprovada.

A recomendação é separar identidade/autorização de contratação/entitlements, introduzir a escolha de plano antes do acesso empresarial, ativar gratuito por decisão explícita e só liberar plano pago após confirmação server-side do gateway. Dashboard e indicadores comerciais devem permanecer como última entrega funcional.

## 2. Matriz de aderência aos requisitos

| Requisito | Classificação | Evidência / observação |
|---|---|---|
| Login e sessão | Implementado | `lib/auth/actions.ts:10-46`, `middleware.ts:4-17`, `lib/auth/context.ts:332-376`. |
| Cadastro público | Implementado no código; sem validação suficiente de ambiente | `lib/auth/onboarding.ts:12-69`; RPC em `20261014193700_complete_public_onboarding.sql:193-262`. Confirmação/Auth/SMTP remotos não foram verificados. |
| Recuperação de senha | Implementado no código; sem validação suficiente de produção | `lib/auth/recovery.ts:13-83`; configuração de URL e sessão são exigidas. |
| Troca obrigatória de senha | Implementado | `app/trocar-senha-obrigatoria/`, `lib/auth/password-change.ts:19-79`, `20261014193800_password_change_obligation.sql`. Resultado desconhecido/parcial é tratado. |
| Empresa e owner | Implementado no onboarding; implantação incerta | `complete_public_onboarding.sql` cria empresa, identidade e membership owner. |
| Equipe e permissões | Parcial | UI e RPCs em `app/(authenticated)/empresa/equipe/`, `lib/enterprise/management.ts`, migrations `20261015120000`/`15140000`. O modelo permite owner/admin/operator; a regra específica do intermediário ainda não existe. |
| Isolamento por empresa | Implementado no desenho novo; sem validação suficiente do banco | RLS/RPCs novas derivam a empresa de identidade/membership. Fluxos legados não têm a mesma garantia explícita. |
| Produtos internos e imagens existentes | Parcial / implantação incerta | `20261015150000_internal_products_multitenancy.sql`, `20261015170000_internal_product_images.sql`, rotas `/admin/products`. Há coexistência com catálogo legado e documentação alerta incompatibilidades de contratos. |
| Impressoras FDM | Implementado no código/migration; sem confirmação remota | `20261015180000_internal_printers_mvp.sql`, telas da precificadora. |
| Materiais de referência e tarifa | Implementado no código/migration; sem confirmação remota | `lib/materials/actions.ts`, migration `20261015192000_internal_materials_fdm_mvp.sql`; tarifa em `20261015190000_enterprise_electricity_rate.sql`. |
| Precificadora | Implementado | `lib/pricing/fdm.ts`, testes `lib/pricing/fdm.test.ts`, `app/(authenticated)/precificadora/`. |
| Persistência/histórico | Implementado no código; migration condicional | `lib/pricing/persistence-actions.ts`, `app/(authenticated)/precificadora/historico/`, migration `20261016000000_backend_pricing_persistence.sql` marcada `NEW / UNAPPLIED`. |
| Aplicação de preço ao produto | Parcial; PRC-001 confirmado | RPC aplica sob lock e versão esperada; UI usa `snapshot.product_snapshot.version` (`.../historico/[id]/page.tsx:13`) e não permite retomada após edição legítima. |
| Carretéis físicos, consumo e custos | Implementado no código/migration; sem confirmação remota | `lib/spools/actions.ts`, migration `20261017000000_fdm_filament_spools.sql`, ledger imutável, saldo, custo, idempotência e locks. Testes concorrentes estão documentados como pendentes. |
| Estoque de produtos prontos | Parcial / estado do banco desconhecido | UI/actions e migration `20261020000000_finished_product_inventory.sql`; migration e `ESTOQUE_PRODUTOS_PRONTOS.md` estão não rastreados no working tree. Movimentação é manual e não integra carretéis/pedidos. |
| Uma única seção de pedidos | Ausente | Existe `/admin/sales` legado; não foi localizado modelo novo de pedidos. Catálogo/carrinho públicos são recursos públicos preservados, não uma seção empresarial de pedidos. |
| Dashboard operacional | Ausente como requisito novo | `/admin` exibe contagens de catálogo/produtos via `lib/catalogs/actions.ts`; `/home` é apenas placeholder. |
| Faturamento e expectativa | Ausente | Não há agregação confiável por pagamento/cancelamento nem expectativa de pedidos. Deve ser implementado por último. |
| Três planos apresentados | Ausente | Não há domínio, tabela, tela ou entitlements de planos SaaS. Planos em `calculator`/`marketplaceCalculator` são planos de marketplace, não assinatura Modulus. |
| Contratação autônoma | Ausente | Não há checkout, assinatura, webhook ou reconciliação. |
| Cobrança mensal | Ausente | Gateway ainda não escolhido; nenhum SDK deve ser instalado nesta rodada. |
| Preparação para produção | Parcial / não comprovada | Há práticas novas de RLS, RPC, locks e resultado `uncertain`, mas há migrations não aplicadas, legado sem tenancy explícita e lint falhando. |

### Fora do lançamento

CRM/perfil detalhado, insights/recomendações, plano avançado contratável, automação de impressoras, parcelamento/pagamentos parciais, pagamentos dos clientes das empresas, imagens de carretéis e catálogo público como novo recurso **não devem ser criados como escopo desta entrega**. Os recursos públicos existentes devem continuar preservados conforme seu comportamento atual; não há recomendação de apagá-los.

## 3. Funcionalidades existentes e evidências

### Identidade, onboarding e autorização

O onboarding valida nome, empresa, e-mail, senha e confirmação em `lib/auth/onboarding.ts`; `signUp` usa `/auth/confirm`; a finalização exige usuário autenticado e e-mail confirmado. A RPC transacional cria `users`, `auth_identities`, `enterprises`, `enterprise_members` e conclusão, com idempotência por issuer/auth user e locks.

`lib/auth/context.ts` representa estados de identidade, usuário, senha obrigatória, empresa/membership e prontidão. `requireBusinessContext(permission)` diferencia estado pronto e permissão. O layout redireciona estados não prontos para `/conta`. Hoje `business_ready` significa identidade ativa, senha liberada, uma empresa ativa e membership ativa; **não inclui plano** e isso não deve ser alterado nesta auditoria.

A matriz de permissões existe em TypeScript e é replicada em SQL (`private.can_access_enterprise`). A UI esconde módulos, mas os fluxos novos também exigem permissionamento no servidor/RPC. Isso é diferente de acesso por plano, status de assinatura e cota; esses três controles ainda não existem.

### Estoque, sem consolidar estruturas

O desenho atual mantém separadas as seguintes entidades:

- **Material de referência:** tabela de materiais FDM, material, peso/referência de custo, ativo e versão (`20261015192000_internal_materials_fdm_mvp.sql`). É uma referência de cálculo, não necessariamente uma unidade física em estoque.
- **Carretel físico:** `filament_spools`, com material, identificador, peso original, saldo, preço e versão. `filament_spool_movements` é ledger de entradas/saídas/ajustes protegido contra alteração; movimentações usam lock, saldo suficiente, versão esperada e idempotência (`20261017000000_fdm_filament_spools.sql`).
- **Produto:** produto interno multiempresa (`20261015150000_internal_products_multitenancy.sql`), com versão e ativo; imagens possuem estrutura própria (`20261015170000_internal_product_images.sql`).
- **Posição de estoque de produto pronto:** tabela de saldo por empresa/produto no desenho `20261020000000_finished_product_inventory.sql`.
- **Movimentação:** ledger de produtos prontos separado, com `entry`, `exit` e `adjustment`, saldo não negativo, `FOR UPDATE`, versão e tentativa idempotente.

“Sem limite” no intermediário deve significar somente permitir cadastrar quantos materiais/carretéis/itens de estoque o plano definir, sem introduzir armazéns físicos, estoque genérico, novas categorias ou consolidação de tabelas.

Para o limite de 10 itens no gratuito, o código ainda não tem uma função de entitlement/contagem. A alternativa semanticamente mais segura é contar **itens cadastrados ativos por entidade de inventário**, com uma decisão explícita sobre se materiais de referência entram: (A) contar produtos prontos e carretéis físicos, deixando material de referência fora por ser insumo de cálculo; ou (B) contar um conjunto normalizado de “itens de estoque” sem duplicar um carretel como material. A regra aprovada ainda não resolve isso. Não se deve contar saldo físico nem somar movimentos.

### Precificação e PRC-001

A precificadora calcula localmente e possui motor/testes. O histórico salva snapshot de produto, impressora, materiais, configuração, entradas e resultado. A aplicação no produto é transacional e protege concorrência com lock e versão atual.

O PRC-001 permanece confirmado, após inspeção do estado atual: o detalhe de histórico passa a versão salva para `ApplyPricingButton`; a RPC compara com a versão atual. Após edição do produto, a aplicação falha por conflito e a interface não oferece consulta/confirmação para reaplicar o mesmo histórico. Não é uma falha de `configVersion` fora do hash: isso foi aprovado e não deve ser repetido como achado.

## 4. Lacunas e bugs demonstrados

### Bugs ou riscos demonstrados no código

1. **PRC-001 — aplicação de histórico sem retomada (confirmado, média):** `app/(authenticated)/precificadora/historico/[id]/page.tsx:13`, `components/pricing/ApplyPricingButton.tsx` e RPC em `20261016000000_backend_pricing_persistence.sql:124-139` discordam deliberadamente sobre a versão esperada após edição do produto; não há fluxo de confirmação/atualização.
2. **Vendas legadas fora do novo gate (alto risco de lançamento):** `lib/sales/actions.ts` consulta/muta `closed_sales` diretamente após `auth.getUser()`, sem `requireBusinessContext`, sem `enterprise_id` explícito, sem idempotência ou versão; a policy em `20260826000000_create_closed_sales.sql:70-75` é ampla. Isso é uma lacuna demonstrada de aderência ao novo tenancy, não uma suposição sobre policies remotas.
3. **Migrations novas não comprovadas:** pricing, carretéis e produtos prontos estão marcadas como novas/não aplicadas nos arquivos. O banco remoto permanece desconhecido; não se deve tratar o SQL local como prova de execução.
4. **Lint atual falha:** `npm run lint` terminou com 16 erros e 17 warnings, sobretudo `react-hooks/set-state-in-effect` em calculadoras e componentes legados. Isso não prova bug funcional específico, mas impede declarar gate de qualidade verde.

### Não classificados como bug nesta rodada

Não classificar como bug a ausência de funcionalidades fora do escopo, `configVersion` fora do hash, falta de teste como se fosse falha reproduzida, migration não rastreada como prova de ausência no banco, nem policies/imagens/conconcorrência legadas sem evidência concreta do estado remoto. Esses itens são, respectivamente, decisão de escopo, decisão aprovada, cobertura pendente, incerteza de implantação e hipóteses a verificar.

## 5. Mapeamento das duas áreas de pedidos

### Área 1 — vendas empresariais legadas

- Rota: `app/(authenticated)/admin/sales/page.tsx`.
- Gate: `lib/legacy-gate.ts`.
- Actions: `lib/sales/actions.ts`.
- Tabela: `closed_sales`, migrations `20260826000000_create_closed_sales.sql`, `20260829000000...`, `20260831000000...` e `20260907000000_add_carrinho_perdido_status.sql`.
- Sidebar: link `/admin/sales` em `AuthenticatedShell.tsx`.
- Comportamento: CRUD/listagem de vendas fechadas, com estados legados e `carrinho_perdido`; não é o modelo completo aprovado de pedidos, pagamento e andamento operacional.
- Permissões: dependem do gate legado/policies; não estão alinhadas à autorização multiempresa nova.

### Área 2 — catálogo público/carrinho e calculadoras legadas

- Rotas: `/catalogo/[slug]`, `/calculator`, `/marketplaceCalculator` e componentes `CatalogoModulus`/`CartContext`.
- Componentes: `app/components/catalog/CatalogoModulus.tsx`, `context/CartContext.tsx`.
- Tabelas/actions: `catalogs`, `products`, imagens e actions em `lib/catalogs/actions.ts`; os planos encontrados em calculadoras pertencem ao marketplace.
- Comportamento: preserva catálogo/carrinho público e cálculo de taxas; não é uma seção empresarial de pedidos persistidos do Hub.

**Proposta de único ponto de entrada:** criar, em etapa própria, `/pedidos` como entrada empresarial única para a operação de pedidos, mantendo `/catalogo/[slug]` e recursos públicos atuais. A nova seção deve usar um contrato de pedido aprovado, sem apagar/mesclar `closed_sales` automaticamente. Deve haver migração/compatibilidade somente após inventário de dados e contratos.

### Estado e semântica recomendados

Preservar os estados visíveis: **Em conversão, Orçado, Pago, Modelando, Imprimindo, Entregue, Cancelado, Carrinho perdido**. Separar:

- `operational_status`: conversão/orçado/modelando/imprimindo/entregue/carrinho perdido;
- `payment_status`: inicialmente `unpaid`/`paid` (somente pagamento integral; sem parcelamento);
- `cancelled_at`/`cancellation_reason`: cancelamento operacional/financeiro do registro, sem estorno automático.

O estado “Pago” pode continuar sendo uma apresentação quando `payment_status=paid` e o andamento ainda não começou, mas a venda não deve deixar de ser reconhecida quando avançar para Modelando, Imprimindo ou Entregue. Faturamento = pedidos com pagamento integral registrado e sem cancelamento efetivo. Cancelar pedido pago retira do faturamento do Hub, sem executar estorno.

Identificação mínima do comprador, sem módulo CRM: nome exibido, contato fornecido, identificador opcional externo e snapshot do endereço/dados necessários à entrega, conforme decisão de privacidade. Rascunhos, cancelados e carrinhos perdidos não devem entrar na expectativa sem decisão explícita; recomendação inicial: incluir apenas pedidos não cancelados, com valor orçado e ainda não pagos, excluindo rascunho e carrinho perdido.

## 6. Proposta de escolha de plano e assinatura

### Onboarding

Hoje a empresa é criada na conclusão do onboarding (`20261014193700_complete_public_onboarding.sql`) e o usuário vira owner na mesma transação. O contexto passa a `business_ready` após identidade, empresa e membership estarem válidos e a obrigação de senha estar liberada (`lib/auth/context.ts`).

A escolha obrigatória deve entrar **depois de confirmação de e-mail e troca obrigatória de senha, quando aplicável, e antes do acesso a módulos empresariais**. Não alterar `get_my_access_context` nem adicionar estados nesta rodada. A empresa sem escolha deve ser representada fora do contexto de identidade, por uma relação de contratação/entitlement ausente ou `selection_required`, consultada pelo layout/gate de módulos. Rotas pré-contratação necessárias: `/conta`, confirmação/recuperação/troca de senha e página autenticada de planos; módulos empresariais devem redirecionar para a escolha.

O gratuito pode ser ativado com uma ação explícita, sem checkout. Para pago, selecionar o plano apenas registra intenção/seleção; não libera acesso até confirmação confiável do pagamento/assinatura pelo backend.

### Separar identidade de contratação (recomendado)

**Recomendação:** manter `get_my_access_context` como fonte de identidade, empresa, membership, papel e permissões; criar consulta/serviço separado para contratação, com estado de assinatura e entitlements. O layout combina os resultados para decidir acesso.

- Vantagem: não mistura owner/operator com assinatura, não usa claims mutáveis como fonte de limites, permite múltiplas tentativas de checkout e troca futura de gateway.
- Custo: uma leitura adicional e necessidade de definir comportamento quando a contratação estiver indisponível.
- Alternativa rejeitada como padrão: adicionar plano/assinatura ao contexto de identidade; simplifica a UI, mas acopla sessão a billing, dificulta reconciliação e aumenta risco de liberar acesso com dado stale.

### Domínio mínimo, sem abstração excessiva

1. `saas_plans`: código (`free`, `intermediate`, `advanced`), nome de apresentação, visibilidade/contratabilidade e regras versionadas; sem inventar preço ou limites não aprovados.
2. `enterprise_plan_selection`: empresa, plano escolhido, origem, timestamps e versão; registra escolha, não prova pagamento.
3. `subscriptions`: empresa, plano, provider, `provider_subscription_id`, status normalizado (`pending`, `active`, `past_due`, `cancelled`, `expired`/equivalentes), períodos e timestamps.
4. `payments`: empresa, subscription, provider, IDs externos, valor/moeda/status e dados de evento; nunca cartão.
5. `billing_events`: provider/event ID único, payload mínimo necessário/metadata, recebido/processado/erro, para idempotência e auditoria.
6. `entitlements` ou função server-side de limites: resultado efetivo por empresa/plano/status, com versão/validade. Não confiar em claims do token.

O avançado fica visível como “Em breve” e não contratável. Não criar preço, período de teste ou limites adicionais.

## 7. Pontos de integração do gateway

O fornecedor permanece em aberto; Mercado Pago é apenas exemplo de pesquisa e não deve ser selecionado sem verificação. Não instalar SDK nem chamar gateway nesta rodada.

Fluxo a mapear quando o fornecedor for escolhido:

1. página autenticada `/planos`/contratação, com três planos e estado atual;
2. backend cria checkout/assinatura usando plano interno, empresa e usuário autenticados;
3. retorno do checkout é apenas UX: mostra processamento e consulta o backend;
4. webhook em endpoint público, com assinatura/verificação exigida pelo fornecedor e deduplicação por event ID;
5. consulta/reconciliação periódica ou sob demanda para divergências;
6. renovação mensal e atualização do período;
7. falha de pagamento, carência e suspensão conforme capacidade do gateway;
8. cancelamento, término ao fim do período ou imediato conforme decisão;
9. mudança de plano com regra de efeito e cobrança dependente do fornecedor;
10. retomada de checkout abandonado por nova sessão/reconciliação, sem duplicar subscription.

Dependem do fornecedor: assinatura recorrente mensal, checkout hospedado, notificações de renovação/falha, cancelamento, proration, atualização de método de pagamento, chargeback, retries, assinatura de webhook, moedas, impostos, disponibilidade no Brasil e status de pagamento confiável. Nada disso deve ser afirmado sem documentação do gateway escolhido.

## 8. Estratégia de limites e downgrade

Separar no servidor/banco:

- **papel:** owner/admin/operator e permissões funcionais;
- **plano:** gratuito/intermediário/avançado;
- **estado de assinatura:** ativa, pendente, inadimplente, cancelada etc.;
- **entitlement/cota:** operação permitida e contagem atual.

Toda criação/mutação sujeita a limite deve verificar entitlement no backend/RPC dentro da transação, com lock/advisory lock ou constraint apropriada para impedir duas requisições concorrentes de ultrapassarem a cota. Esconder botão não é enforcement. Não usar claim mutável do JWT como única fonte.

Regras aprovadas:

- Gratuito: uma conta; precificadora, estoque e pedidos; no máximo 10 pedidos cadastrados no total, inclusive cancelados; no máximo 10 itens diferentes de estoque independentemente do saldo.
- Intermediário: uma conta master e um operador; pedidos ilimitados; itens de estoque ilimitados, incluindo carretéis; funcionalidades do lançamento com persistência.
- Avançado: visível “Em breve”, sem contratação.

Pendências do gratuito: limites de produtos, impressoras e cálculos salvos; contagem exata de materiais/carretéis/produtos; efeito de arquivamento. Alternativas estão registradas na seção 10.

Downgrade/inadimplência: preservar dados; manter consulta e exportação autorizadas; bloquear novas operações que ultrapassem limites; não apagar registros. Não bloquear toda escrita: saídas/consumos e ajustes de itens existentes podem ser necessários para reduzir estoque e manter integridade. Uma política possível é permitir movimentações de itens existentes que não criem nova entidade nem aumentem saldo acima da regra, manter pedidos existentes consultáveis e impedir novos pedidos quando o total já exceder 10.

Casos ainda sem decisão: dois usuários ativos ao voltar ao gratuito (manter master e marcar operador excedente como acesso suspenso, ou exigir escolha), estoque acima de 10 (preservar e bloquear novos cadastros), pedidos acima de 10 (preservar, permitir consulta/exportação e bloquear novos), movimentação de itens existentes (permitir saída/ajuste validado), recuperação após pagamento (reativar por webhook/consulta reconciliada, não redirect). Carência, data de efeito e operador excedente precisam ser definidos.

## 9. Dependências dos indicadores

Período padrão: mês atual, usando timezone empresarial definido. Cada indicador precisa de uma data explícita:

| Indicador | Fonte/dependência | Data necessária |
|---|---|---|
| Saldo/alerta de estoque | posições de produtos prontos, carretéis e/ou materiais conforme escopo; não inventar estoque genérico | `as_of`/saldo atual e limiar configurado |
| Carretéis baixos/esgotados | `filament_spools` e saldo, material, ativo | saldo atual; data da última movimentação para histórico |
| Consumo de filamento | ledger de movimentos dos carretéis, apenas saídas/consumos tipados | `occurred_at` da movimentação |
| Custo histórico consumido | custo/preço efetivamente associado à movimentação, não preço atual global | custo na data do consumo e moeda |
| Faturamento | pedidos com pagamento integral e não cancelados | `paid_at` e `cancelled_at` |
| Expectativa | pedidos não pagos, com valor orçado, não cancelados e não rascunho/carrinho perdido pela recomendação | `created_at`/`quoted_at`, com valor atual aprovado |
| Lucro bruto | somente após custo efetivamente associado a cada pedido | `paid_at` e custo alocado do pedido |

Não chamar “faturamento menos consumo global de filamento” de lucro bruto dos pedidos. O faturamento deve continuar contabilizado após avanço operacional de Pago para Modelando/Imprimindo/Entregue. Cancelamento posterior exige decisão sobre relatório histórico: recomendo relatório atual recalculado excluir cancelado e um ledger/auditoria preservar o valor originalmente reconhecido.

Não há hoje dados suficientes para afirmar esses indicadores como reais: não existe modelo novo de pedidos/pagamento nem agregações. Dashboard e indicadores comerciais são a última entrega funcional, depois de pedidos, pagamento, custos e datas estarem estabilizados.

## 10. Decisões pendentes para o usuário

1. **Contagem gratuita:** contar apenas produtos prontos + carretéis físicos (recomendado), ou incluir materiais de referência? Se incluir, como evitar contar o mesmo material duas vezes por carretel?
2. **Arquivamento:** item arquivado devolve vaga imediatamente, nunca devolve, ou só após retenção? Recomendação: não contar arquivados para novos cadastros, preservando histórico.
3. **Intermediário:** “master + operador” exclui admin? Recomendação: permitir exatamente owner/master e um operator, sem terceiro admin, salvo aprovação.
4. **Limites gratuitos:** haverá limite de produtos, impressoras e cálculos salvos? Não preencher silenciosamente.
5. **Pedidos:** expectativa inclui apenas orçados não pagos, ou também “Em conversão”? Recomendo excluir rascunhos/carrinhos perdidos e incluir pedidos com valor orçado não cancelados.
6. **Cancelamento histórico:** relatórios do mês anterior são recalculados após cancelamento ou preservam snapshot de fechamento? Recomendação: faturamento operacional atual recalcula; auditoria preserva eventos.
7. **Carência:** duração e momento de suspensão após falha de pagamento.
8. **Downgrade:** data de efeito, preservação do operador excedente e se ele fica somente leitura.
9. **Checkout:** fornecedor, recorrência, proration, cancelamento, retries, chargeback, impostos, moeda e capacidades de webhook.
10. **Dados mínimos do comprador:** campos obrigatórios de identificação/entrega sem criar CRM.

## 11. Plano incremental de implementação

1. **Fechar contratos e inventário:** aprovar decisões acima; confirmar migrations no ambiente de desenvolvimento por procedimento autorizado; mapear dados/contratos legados sem apagar recursos públicos.
2. **Hardening de identidade e tenancy:** validar configuração de Auth/SMTP, RLS/grants, gates e testes de isolamento; alinhar actions legadas ao contexto novo ou mantê-las explicitamente fora do Hub.
3. **Entitlements sem gateway:** criar planos internos, seleção obrigatória, estado de empresa sem plano fora de `get_my_access_context`, limites server-side e gratuito explícito.
4. **Pedidos:** definir tabela/contrato novo, payment status separado, estados operacionais, comprador mínimo, cancelamento, idempotência e uma entrada `/pedidos`; preservar `closed_sales` e catálogo público até plano de compatibilidade aprovado.
5. **Assinatura:** selecionar fornecedor após pesquisa; implementar adapter mínimo, checkout, retorno não confiável, webhook verificado, reconciliação, renovação, falha, cancelamento, mudança e retomada; nunca cartão.
6. **Downgrade/recuperação:** implementar preservação, leitura/exportação, bloqueios por operação, carência e tratamento do operador excedente.
7. **Integração de custos:** associar consumo de carretel e custos efetivos a pedidos quando aplicável; validar histórico e concorrência.
8. **Dashboard e indicadores comerciais por último:** saldo/alertas, carretéis, consumo/custo, faturamento, expectativa e depois lucro bruto somente com custos associados. Sem mocks apresentados como reais.
9. **Preparação de produção:** migrations ensaiadas, testes de isolamento/concor­rência/idempotência, TypeScript/build/lint acordados, observabilidade, reconciliação e runbook de rollback. Compilar sozinho não é critério de prontidão.

## 12. Verificações executadas e limitações

### Executado

- Inspeção de `git status`: há alterações em `AuthenticatedShell.tsx`, `layout.tsx` e `lib/auth/context.ts`; há arquivos de estoque de produtos prontos/migration no working tree não rastreados. Eles foram tratados como estado atual observado, não como banco implantado.
- Inspeção de rotas, actions, componentes, migrations SQL, RPCs, RLS, grants e documentação.
- `npm run lint`: **falhou**, com 16 erros e 17 warnings; predominam regras React `set-state-in-effect` em código legado/calculadoras, além de warnings de `<img>` e variáveis não usadas.
- Busca específica por PRC-001, `configVersion`, pedidos/vendas, billing/subscription/checkout/webhook, senha e migrations.

### Não executado, conforme solicitado

Não foram executados SQL remoto, migrations, reset/db push, chamadas de gateway, criação de assinaturas/cobranças/contas, e-mail, mudança de configuração, instalação de dependências, commit, push ou deploy.

### Limitações

Não foi validado o estado remoto do banco, migrations aplicadas, policies/grants efetivos, Auth/SMTP, Storage, produção, dados existentes, concorrência real ou compatibilidade de um gateway específico. Portanto, o documento distingue o que o código declara do que permanece desconhecido. Nenhuma conclusão de produção deve ser baseada somente na existência dos arquivos SQL.
