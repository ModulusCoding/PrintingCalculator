# Etapa 01 — Diagnóstico e contratos atuais

**Data da inspeção:** 21/10/2026  
**Escopo:** investigação; nenhum código de produção, migration ou configuração foi alterado.

## 1. Resumo executivo

O código atual contém um núcleo novo de identidade multiempresa, onboarding, equipe/permissões, produtos internos, materiais de referência, impressoras, precificadora persistente, carretéis físicos e estoque de produtos prontos. Os fluxos novos usam contexto empresarial, validação server-side, RPCs `SECURITY DEFINER`, locks e, em vários casos, idempotência.

Ainda não existe o modelo operacional aprovado de pedidos, reservas, fabricação, entrega ou assinatura/entitlements. A venda existente é legada (`closed_sales`). O dashboard atual também é legado. O achado PRC-001 continua demonstrado: o histórico envia a versão salva do produto, a RPC exige a versão atual e não há na UI uma confirmação/retomada após edição legítima.

A dependência estrutural mais importante para carretéis é que `filament_spools.material_id` é obrigatório e possui FK composta para `materials`. Portanto, a experiência desejada de um único cadastro não pode ser obtida apenas pela UI sem definir compatibilidade de dados, referência de cálculo e histórico. A alternativa de menor risco inicial é preservar as tabelas e relações existentes, permitindo uma camada de cadastro unificada/valores diretamente no carretel somente após contrato explícito e migração compatível.

**Conclusão:** é possível iniciar a etapa 2 de carretéis, desde que ela seja precedida pelo fechamento do contrato de compatibilidade com `materials`, preserve IDs, movimentos e históricos e não tente introduzir silenciosamente pedidos, materiais gerais ou cobrança. Não há bloqueio técnico para investigação/incremento isolado; há bloqueios de lançamento para pedidos, planos, cobrança e integração de estoque.

## 2. Estado do repositório e fontes consultadas

### Estado Git

- Branch: `feat/saas-foundation`.
- Commit atual: `e5c1bda8d32ed8d3bdbd6fc316f93b3aaf1ee9de`.
- `git status --short`: limpo na verificação desta etapa; não havia alterações locais a preservar.
- Somente este documento foi criado por esta etapa.

### Fontes principais

- `AUDITORIA_LANCAMENTO_MODULUS.md` e `AUDITORIA_MODULUS_HUB.md`.
- `CARRETEIS_FDM.md`, `ESTOQUE_PRODUTOS_PRONTOS.md`.
- `docs/architecture/saas-foundation.md`, `products-multitenancy-plan.md`, `enterprise-management-review.md`, `fdm-pricing-simulator-v1.md`, `auth-tenancy-proposal.md`.
- Rotas em `app/(authenticated)`, componentes em `components/`, ações em `lib/`.
- Migrations de identidade/tenancy, produtos, materiais, impressoras, precificação, carretéis, vendas e estoque de produtos prontos em `supabase/migrations/`.
- `package.json` (scripts: `lint`, `build`; não há script de testes no package).

O documento de projeto geral disponível é `docs/architecture/saas-foundation.md`; ele ainda descreve planos e cobrança como futuros. As decisões deste prompt prevalecem onde divergem, especialmente limites, estados de pedidos, carretéis e materiais gerais.

A informação do usuário de que precificação, carretéis e estoque de produtos prontos tiveram migrations aplicadas e testes básicos no desenvolvimento foi registrada como **informada pelo usuário**. Não foi executado SQL remoto nem verificada produção. Comentários `NEW / UNAPPLIED` nos arquivos locais não são tratados como prova de ausência no banco.

## 3. Mapa dos contratos atuais por módulo

### 3.1 Identidade, empresa, equipe e acesso

**Entradas e rotas:** login em `app/(public)/admin/login`, conta em `app/conta`, onboarding em `lib/auth/onboarding.ts`, troca obrigatória em `app/trocar-senha-obrigatoria/`, equipe em `app/(authenticated)/conta/equipe/novo/`. O shell é `app/(authenticated)/AuthenticatedShell.tsx` e o layout autenticado aplica o contexto.

**Servidor e tipos:** `lib/auth/actions.ts`, `lib/auth/context.ts` (`getMyAccessContext`, `requireBusinessContext`) e `lib/enterprise/management.ts`. A identidade vem de `auth.getUser()` e de `public.get_my_access_context()`, não de `user_metadata` como autorização. A migration `20261014193600_create_auth_tenancy_access_context.sql` cria contexto, helpers e grants; `20261014193700_complete_public_onboarding.sql` finaliza empresa, identidade e membership.

**Contrato:** estados de identidade, senha obrigatória, empresa/membership e `business_ready`; papéis atuais owner/admin/operator; permissões funcionais são distintas de plano, assinatura e cota. Não alterar `get_my_access_context` nem adicionar estado nesta etapa. A escolha obrigatória de plano deve ser uma consulta/gate separado depois de confirmação de e-mail/troca de senha e antes dos módulos empresariais.

**Segurança:** as RPCs novas chamam contexto e `private.can_access_enterprise`; operações sensíveis revalidam identidade, issuer, usuário, membership e empresa. A proteção visual do shell não substitui a proteção de action/RPC. Fluxos legados não têm o mesmo contrato.

### 3.2 Materiais de referência e carretéis

**Rotas/componentes:** materiais em `/materiais` e `components/materials/MaterialForm.tsx`, actions em `lib/materials/actions.ts`; carretéis em `/estoque/carreteis`, `/novo`, `/[id]` e `/configuracao`, componentes `components/spools/*`, actions em `lib/spools/actions.ts`.

**Schema:** `20261015192000_internal_materials_fdm_mvp.sql` define `materials` com referência de preço/peso, versão, ativo e empresa. `20261017000000_fdm_filament_spools.sql` define `filament_spools` e `filament_spool_movements`. O carretel exige `material_id`, `internal_identifier`, peso original, saldo inicial e preço de compra; a FK composta `(enterprise_id, material_id)` preserva isolamento.

**Movimentos/custos:** o ledger é imutável; consumo é negativo, reposição positiva e ajuste usa saldo contado. O custo é calculado por `quantidade absoluta × purchase_price / original_filament_grams`, preservando custo na movimentação, não o preço atual. `FOR UPDATE`, versão esperada, saldo não negativo, capacidade máxima e `UNIQUE(enterprise_id, actor_id, attempt_id)` protegem concorrência/repetição.

**Permissões:** `spools.read/write/archive`; leitura RLS; escrita somente via RPCs `create_filament_spool`, `create_filament_spool_movement`, `set_filament_spool_active`, `update_filament_spool_identity`. O material de referência é hoje dependência obrigatória, não apenas uma etiqueta.

**Impacto aprovado:** o usuário deseja carretel como cadastro completo, sem exigir dois cadastros na experiência. Devem ser preservados `filament_spools`, movimentos, IDs e históricos. Alternativas: (A) manter `materials` como referência técnica invisível/gerenciada automaticamente — menor risco de migração, mas ainda existe entidade interna; (B) tornar atributos de referência colunas do carretel e manter compatibilidade/backfill — UX mais direta, porém exige migração, snapshot de cálculos e estratégia para materiais compartilhados; (C) tabela unificada — maior retrabalho e risco de quebrar consumidores. Recomendação atual: A ou B em etapa dedicada, sem remover a FK antes de inventariar consumidores.

### 3.3 Produtos e estoque de produtos prontos

**Entradas:** `/admin/products`, componentes `components/admin/ProductForm.tsx`, `ProductArchiveButton.tsx`, `lib/products/actions.ts` (e actions relacionadas). Estoque em rotas `/estoque/produtos` e componentes `components/inventory/*`.

**Schema/contrato:** `20261015150000_internal_products_multitenancy.sql` define produtos internos com `enterprise_id`, ativo, preço e `version`; imagens têm migration própria. `20261020000000_finished_product_inventory.sql` define `product_inventory` (saldo inteiro por produto/empresa) e ledger `product_inventory_movements` com `entry`, `exit`, `adjustment`, versão e tentativa idempotente.

**Efeitos:** movimentos são transacionais, com lock, saldo não negativo, ledger imutável e repetição por attempt. Atualmente são operações manuais; não reservam, não fabricam, não entregam e não movimentam carretéis. O produto é FK restrita, preservando histórico.

**Risco futuro:** reservar produtos prontos exige separar saldo físico, reservado e disponível, ou uma tabela de reservas. Não usar o saldo atual como disponibilidade sem contrato de reserva.

### 3.4 Precificação, snapshots, histórico e aplicação

**Rotas:** `/precificadora`, `/precificadora/historico`, `/precificadora/historico/[id]`. Componentes `components/pricing/PricingSimulator.tsx` e `ApplyPricingButton.tsx`.

**Servidor:** motor puro em `lib/pricing/fdm.ts`; persistência em `lib/pricing/persistence-actions.ts` e `lib/pricing/persistence.ts`. `saveFdmPricingAction` valida IDs/versões e lê produto, impressora, materiais e configuração por empresa; salva snapshot de entradas/resultados. `listPricingHistoryAction` e `fetchPricingDetailAction` filtram `enterprise_id`.

**Schema/RPC:** `20261016000000_backend_pricing_persistence.sql` cria `pricing_calculations`, aplicações e RPCs `lookup_pricing_attempt`, `save_pricing_attempt`, `apply_pricing_price`. A aplicação trava o produto, verifica versão e registra aplicação idempotente. A aplicação não deve ser confundida com movimento de estoque.

**Contrato a preservar:** snapshot é histórico imutável; nomes, preços, versões e configuração usados devem continuar recuperáveis. `configVersion` fora do hash é decisão aprovada e não é bug.

### 3.5 Pedidos, vendas e módulos legados

A única tela empresarial encontrada é `app/(authenticated)/admin/sales/page.tsx`, com `components/admin/SalesListClient.tsx`, `SaleFormModal.tsx`, `SaleDetailModal.tsx` e `lib/sales/actions.ts`. Ela opera sobre `closed_sales`, criada pelas migrations `20260826000000_create_closed_sales.sql` e alterações posteriores, incluindo `carrinho_perdido`.

As actions consultam/mutam diretamente o legado, com gate `lib/legacy-gate.ts`; não demonstram o mesmo `requireBusinessContext`, `enterprise_id`, idempotência ou versão das operações novas. Isso é um risco demonstrado de tenancy/contrato, não uma afirmação sobre policies remotas.

O fluxo aprovado de pedido ainda não existe: não há itens com origem pronta/sob encomenda, reserva, fabricação, consumo de desperdício, entrada vinculada, entrega, cancelamento transacional ou estados separados de pagamento/operação. Preservar `closed_sales` até inventário de dados e contrato de compatibilidade.

### 3.6 Dashboard

`/admin` e `lib/catalogs/actions.ts` exibem contagens/estatísticas de catálogos/produtos legados. `/home` é placeholder. Não há agregação comprovada de faturamento, expectativa, consumo histórico ou custos por pedido. Dashboard e indicadores comerciais ficam por último; consumo de filamento não deve ser subtraído globalmente do faturamento e chamado de lucro bruto.

### 3.7 Planos e cobrança

Não foram encontrados domínio, tabela, rota, action, RPC, webhook ou gateway para planos Modulus, assinatura, entitlements ou cotas. `planos` em `app/calculator` e `app/marketplaceCalculator` são planos/taxas de marketplace, não assinatura do Hub.

O contrato futuro deve separar papel/permissão, plano, estado da assinatura e entitlement. Deve preservar consulta/exportação no downgrade, limitar novas operações server-side e não confiar em claims. Fornecedor, carência e datas de efeito permanecem pendentes.

## 4. Revisão dos achados anteriores

| Achado | Classificação nesta etapa | Evidência atual |
|---|---|---|
| PRC-001 | **Confirmado no código** | Detalhe passa versão do snapshot; RPC compara versão atual e retorna conflito. Ver seção 5. |
| `configVersion` fora do hash | **Não é bug** | Comentário em `persistence-actions.ts:69-71`; decisão aprovada. |
| Migrations recentes não comprovadas | **Estado remoto desconhecido** | Usuário informa aplicação/testes básicos em dev; não houve verificação remota. Arquivos locais não provam ausência. |
| Ledger/idempotência de carretéis | **Comprovado no código**; testes concorrentes locais não demonstrados nesta etapa | Constraints, locks, versão e attempt em `20261017000000...`. |
| Estoque pronto manual e isolado de pedidos | **Comprovado no código** | `20261020000000...` e documentação; sem integração de pedidos. |
| Vendas legadas fora do contrato novo | **Comprovado no código** | `lib/sales/actions.ts`, `closed_sales`, `lib/legacy-gate.ts`. |
| Ausência de planos/cobrança/pedidos novos/dashboard | **Comprovado por busca local** | Nenhum domínio/rota/schema novo correspondente foi localizado. |
| Lint anterior falhando | **Não reexecutado nesta etapa** | Relatório anterior registrou 16 erros/17 warnings; não tratar como nova reprodução. |

## 5. Diagnóstico PRC-001

Sequência atual:

1. `app/(authenticated)/precificadora/historico/[id]/page.tsx:13` carrega o snapshot e envia `snapshot.product_snapshot.version` a `ApplyPricingButton`.
2. `components/pricing/ApplyPricingButton.tsx` chama `applyFdmPricingPriceAction`.
3. `lib/pricing/persistence-actions.ts:107-131` valida ID/versão, exige `products.write` e `pricing.read`, autentica actor/issuer e chama `apply_pricing_price`.
4. A RPC em `20261016000000_backend_pricing_persistence.sql:124-139` busca o cálculo na empresa, retorna idempotente se já aplicado, trava o produto e compara `p.version` com `p_expected_product_version`.
5. Se o produto foi editado depois do snapshot, a versão atual difere da versão salva; retorna `product_version_conflict` com a versão atual. A action traduz isso para “Confirme novamente usando a versão atual.”

**Detecção concorrente:** existe lock `FOR UPDATE` no produto e comparação de versão dentro da RPC. Isso impede aplicação silenciosa sobre edição concorrente. A ação é idempotente por `pricing_calculation_id` após aplicação.

**Problema persistente:** a UI não busca a versão atual nem mostra revisão/confirmar para reaplicar aquele histórico após uma edição legítima. Portanto, o cenário reproduzível por inspeção é: salvar histórico na versão 3 → editar produto para versão 4 → abrir histórico → aplicar → conflito; não existe segundo passo para revisar e confirmar versão 4.

**Esperado:** informar claramente que o produto mudou, mostrar dados atuais relevantes e permitir confirmação explícita usando a versão atual, mantendo o snapshot original e registrando qual preço foi aplicado. Correção mínima: action/consulta de conflito que devolva estado atual suficiente para revisão e botão de confirmação que reenvie a versão atual; manter lock, idempotência e histórico. Não implementar aqui.

## 6. Mapeamento das áreas de pedidos

Não foram encontradas duas telas empresariais novas de pedidos. Foram encontrados dois conjuntos distintos:

1. **Vendas empresariais legadas:** `/admin/sales`, tabela `closed_sales`, actions e componentes administrativos. É CRUD/listagem de registros fechados com estados legados, inclusive carrinho perdido. Contrato de acesso distinto do núcleo novo.
2. **Recursos públicos:** `/catalogo/[slug]`, `components/catalog/CatalogoModulus.tsx`, `CartDrawer.tsx`, `context/CartContext.tsx`, além de `/calculator` e `/marketplaceCalculator`. São catálogo/carrinho em experiência pública e calculadoras; não são a segunda tela empresarial de pedidos persistidos.

Os públicos dependem de `catalogs`, `products`, imagens e actions legadas, e devem ser preservados. Não recomendar excluir/unir tabelas. O candidato para ponto único futuro é uma nova entrada empresarial `/pedidos`, com contrato novo; catálogo/carrinho público permanecem separados até compatibilidade aprovada.

Limitação: se o usuário observou duas telas empresariais específicas, elas não foram localizadas neste commit; não é possível atribuir correspondência sem inventar. A busca local só sustenta os candidatos acima.

## 7. Dependências da mudança de carretéis e materiais gerais

- Carretel hoje depende de material de referência por FK composta e seleção de `material_id` na UI (`components/spools/SpoolForms.tsx`).
- Precificação lê `materials` diretamente e snapshots incluem materiais, versões e preços; remover/reutilizar material sem preservar snapshot quebra reprodutibilidade.
- Movimentos usam preço de compra do carretel e preservam custo no ledger; não introduzir custo médio/FIFO.
- Materiais gerais exigirão entidade, unidade de referência, conversão compatível, quantidade física, entrada/consumo/ajuste, custo proporcional e histórico de referência. Não reutilizar silenciosamente `materials`, cujo contrato atual é FDM e peso em gramas.
- Embalagens na precificadora são hoje apenas custo por peça (`packaging` no simulador); não há estoque de embalagens/lotes.
- A precificadora deverá selecionar carretéis e materiais gerais, aplicar perda percentual configurável/ajustável e salvar parâmetros/custos efetivos; simulação e salvamento não podem movimentar estoque.

Alternativas para materiais gerais: tabela própria com unidades/conversões compatíveis (recomendado, menor acoplamento); generalizar `materials` (mais migração e risco para snapshots); ou tabela unificada de insumos físicos (maior impacto). A recomendação não altera código nesta etapa.

## 8. Pontos de entrada para planos, cotas e assinatura

Hoje não existem pontos implementados. Os pontos a preservar/integrar depois são:

- após confirmação de e-mail e troca obrigatória, antes de liberar módulos do layout autenticado;
- `/conta` e uma futura `/planos` para escolha explícita;
- gates de cada Server Action/RPC, não somente sidebar/página;
- criação de produto, carretel, material geral e pedido para cotas com lock/transação;
- convite/gestão de equipe para exatamente owner + operator no intermediário;
- retorno ao gratuito preservando dados, consulta/exportação e restringindo novas operações;
- webhook/reconciliação futura, sem decidir fornecedor, carência ou datas.

As cotas aprovadas são: gratuito com uma conta, 10 produtos, 10 cadastros compartilhados entre carretéis e materiais gerais e 10 pedidos totais, incluindo cancelados; arquivamento não libera vaga; exclusão só com saldo zero, sem reservas/operações pendentes e preservando históricos. A forma exata de contar o cadastro compartilhado ainda exige contrato técnico para não contar material de referência duas vezes.

## 9. Riscos de migração, concorrência e preservação histórica

- **Histórico:** snapshots de pricing, ledgers de carretéis/produtos e `closed_sales` não podem ser reescritos para refletir cadastros atuais.
- **Duplicação:** criação/movimentação existentes têm attempt idempotente; novos fluxos de reserva/fabricação/entrega precisarão de chave de operação e transação única.
- **Saldo:** reserva deve distinguir físico, reservado e disponível; fabricação baixa filamento uma vez, registra desperdício e dá entrada em produto pronto; cancelamento libera reserva sem estornar consumo nem duplicar entrada.
- **Concorrência:** cotas precisam ser verificadas dentro da mesma transação com lock/constraint. Contagem apenas na UI é insuficiente.
- **Exclusão:** produtos/carretéis/materiais com saldo, reserva ou operação pendente não podem ser apagados; FK `RESTRICT` já protege diversos históricos. Arquivamento não libera vaga conforme decisão aprovada.
- **Operador/downgrade:** hoje o papel é funcional; não há enforcement de plano. É necessário decidir o destino do operador excedente e o que pode ser escrito durante downgrade.
- **Server Actions/RPCs:** `requireBusinessContext` e RPCs novas são evidência de proteção; `lib/sales/actions.ts` é exceção legada. A proteção de página não comprova proteção de operação.

## 10. Decisões realmente pendentes

1. Compatibilidade final entre cadastro unificado de carretel e `materials` existente.
2. Se materiais de referência permanecem internos/automáticos ou ganham experiência única visível.
3. Modelo de unidades/conversões e arredondamentos de materiais gerais.
4. Contagem técnica dos 10 cadastros sem duplicar referência e carretel.
5. Contrato de pedido novo e eventual migração/leitura de `closed_sales`.
6. Campos mínimos do comprador e dados de entrega.
7. Comportamento do operador excedente no downgrade.
8. Carência, data de efeito, fornecedor, recorrência, proration e cancelamento da assinatura.
9. Política de relatório após cancelamento de pedido pago.
10. Critério de reserva e disponibilidade de produtos prontos.

Não escolher nesta etapa carência, fornecedor, datas de efeito ou novos estados de identidade.

## 11. Orientações para as etapas seguintes

1. Etapa 2: fechar contrato de carretel e compatibilidade; preservar tabelas, FKs, movimentos, custos e snapshots; adicionar testes de isolamento/idempotência/conflito onde autorizado.
2. Depois, materiais gerais em tabela/contrato próprio, com conversões compatíveis e histórico de custo de referência.
3. Evoluir precificadora para selecionar entidades físicas e materiais gerais sem movimentação durante simulação/salvamento; resolver PRC-001 com confirmação explícita.
4. Definir pedidos antes de integrar estoque: itens com origem, reserva, fabricação, desperdício, entrega, cancelamento e idempotência.
5. Introduzir planos/entitlements separados de identidade e permissão; aplicar cotas no servidor.
6. Integrar assinatura somente após fornecedor e regras pendentes.
7. Dashboard e indicadores comerciais por último, usando datas e custos efetivos. Não apresentar mocks como indicadores reais.

## 12. Verificações executadas e limitações

**Executado:** leituras locais, busca de rotas/símbolos, inspeção de migrations, RPCs, actions, componentes, tipos, documentação, `git status`, branch e commit. O estado informado pelo usuário sobre migrations/testes de desenvolvimento foi registrado, mas não revalidado remotamente.

**Não executado:** SQL remoto, migrations, `db push/reset`, instalação, gateway, contas/assinaturas/cobranças, e-mail, alterações de configuração, commit, push ou deploy. Nenhum valor de ambiente, token ou credencial foi lido/exposto.

Não foi executado lint/build/testes nesta etapa: `package.json` não define script de testes e as verificações permitidas não eram necessárias para o diagnóstico. O resultado de lint do relatório anterior permanece histórico, não uma nova reprodução.

Desconhecido: estado remoto/produção, grants e policies efetivos, dados existentes, concorrência real, configuração Auth/SMTP/Storage e fornecedor de cobrança.

## Conclusão

Podemos iniciar a etapa 2 de carretéis, com escopo controlado e decisão explícita sobre a dependência de `materials`. Devem ser preservados: `get_my_access_context`, isolamento por `enterprise_id`, permissões atuais, IDs e históricos de `materials`/`filament_spools`, ledger imutável e custos por movimentação, snapshots de pricing, produtos e inventário com versão/idempotência, além dos recursos públicos e `closed_sales` até compatibilidade aprovada.

Não há bloqueio concreto para preparar a evolução de carretéis. Há bloqueios concretos para declarar lançamento: pedidos novos/reservas/fabricação/entrega inexistentes, planos/cotas/assinatura inexistentes, PRC-001 sem retomada e vendas legadas fora do contrato novo.

Arquivos provavelmente afetados em etapas futuras, sem alteração nesta investigação: `supabase/migrations/20261015192000_internal_materials_fdm_mvp.sql`, `20261016000000_backend_pricing_persistence.sql`, `20261017000000_fdm_filament_spools.sql`, `20261020000000_finished_product_inventory.sql`, `lib/materials/actions.ts`, `lib/spools/actions.ts`, `components/spools/*`, `lib/pricing/persistence-actions.ts`, `components/pricing/ApplyPricingButton.tsx`, `app/(authenticated)/precificadora/historico/[id]/page.tsx`, `lib/auth/context.ts` apenas como consumidor (não alterar o contrato), `lib/sales/actions.ts`, `AuthenticatedShell.tsx` e futuras rotas/actions/RPCs de pedidos e entitlements.

**Somente `ETAPA_01_DIAGNOSTICO_CONTRATOS.md` foi criado ou atualizado por mim.**