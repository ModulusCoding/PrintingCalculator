# Refatoração Visual 03 — Home operacional

## Entrega e dependência de banco

A rota `/home` agora é um dashboard Server Component com leituras autorizadas server-only, estados reais de vazio/erro, resumo financeiro, evolução de seis meses, últimos cinco pedidos e estoque conforme plano. Não há dados demonstrativos na interface.

**A migration `supabase/migrations/20261028140000_home_dashboard_reads.sql` foi apenas criada localmente, NÃO executada nem aplicada.** Vendas, recebimentos, saldo, pedidos recentes e inventário agregado dependem da aplicação manual autorizada dessa migration e de suas dependências de Pedidos C4/D1/reservas/autorização. Antes disso, a Home mostra indisponibilidade explícita, não números zero. Carretéis reutilizam RPCs existentes.

Nenhum acesso remoto, execução SQL, Docker/WSL, instalação de dependências, commit, push ou deploy foi realizado. Migrations históricas, regras de plano, autenticação, ledger, billing e demais páginas não foram modificados nesta etapa. Alterações anteriores de autenticação/shell e outros trabalhos locais foram preservadas.

## Referências e composição

Inspecionados os HTMLs e screenshots de:
- `design-references/stitch_modulus_3d_editor/dashboard_inicial_modulus_hub/`
- `design-references/stitch_modulus_3d_editor/dashboard_futura_pedidos_produ_o_modulus_hub/`
- README de diretrizes e `lumina_system/DESIGN.md` da mesma árvore.

Mantidos: hierarquia de visão geral, cards, painel amplo de evolução, pedidos recentes e área de estoque. Adaptados: indicadores financeiros aos contratos manuais reais, resumo operacional aos status existentes e alertas de carretéis ao limite configurado. Descartados: lucro sem custo realizado confiável, tendências/percentuais fictícios, utilização de máquinas, atrasos/prazos inventados, seletor temporal sem implementação e valores de protótipo.

Cores oficiais `#2B00FF`, `#152336`, `#A6B4FF`, `#FF4E26`. Space Grotesk e logos oficiais `public/logo_Horizontal.svg` / `public/logo.svg` são herdados do shell existente; nenhuma nova marca, sidebar ou header foi criado. A apresentação “Disponível no Visionário” reutiliza **o próprio `PaidModuleNotice`**, sem alterar seu estilo, conteúdo ou ações.

## Arquivos desta etapa

- Modificado: `app/(authenticated)/home/page.tsx`.
- Criados: `app/(authenticated)/home/loading.tsx`, `components/dashboard/HomeDashboard.tsx`, `components/dashboard/SalesChart.tsx`.
- Criados: `lib/dashboard/reader.ts`, `lib/dashboard/schema.ts`, `lib/dashboard/format.ts`.
- Criados: migration citada, `tests/home-dashboard.test.cjs` e este relatório.

## Fontes, fórmulas e períodos

| Indicador | Fonte e regra |
|---|---|
| Vendas do mês | `public.orders.total_amount`, criados no mês local, status atual diferente de `cancelado`. Total negociado já inclui desconto e frete: `subtotal - discount_amount + shipping_amount`. Sem join com itens que multiplique valores. |
| Recebido no mês | `public.order_payments`: soma de `receipt.amount` menos `refund.amount`, cada lançamento pelo próprio `effective_at`, inclusive movimentos de pedidos atualmente cancelados. Não usa `recorded_at`, data do recebimento original ou status `pago`. Pode ser negativo no período. |
| Saldo total a receber | Soma de `pending_amount` da autoridade `private.orders_c4_financial`, excluindo pedidos atualmente cancelados, sem limitar ao mês de criação. O helper valida ledger completo e não mascara inconsistências. |
| Pedidos ativos | Todos os pedidos exceto `entregue` e `cancelado`. |
| Quantidade/ticket mensal | Mesma coorte de vendas não canceladas; total dividido pela quantidade, arredondamento de centavo por BigInt. Sem pedidos: “Sem pedidos no mês”, não ticket inventado. |
| Evolução | Seis buckets consecutivos, incluindo mês atual, com vendas e recebimentos agregados independentemente; meses legitimamente vazios retornam zero. |
| Recentes | Últimos cinco por `created_at DESC, id DESC`, todos os status; número, comprador, total, data e nomes operacionais existentes. Link abre detalhe pela query `orderId` na listagem real. |
| Disponível físico | Soma de `product_inventory.balance - reserved_balance`. |
| Reservado físico | Soma de `product_inventory.reserved_balance`. |
| Produtos com saldo | Quantidade de posições com `balance > 0`, não soma de unidades. |
| Carretéis baixos | `count_filament_spools('', 'low')`: ativos, não excluídos, saldo positivo, percentual restante <= limite da empresa. |
| Carretéis esgotados | `count_filament_spools('', 'empty')`: ativos, não excluídos, saldo zero. Não duplica os baixos. |
| Limite carretéis | `get_my_spool_config().low_spool_threshold_percent`, intervalo real 0..100; não fixa 20%. |

Períodos SQL `[início do mês, início do próximo mês)`, conversão explícita `America/Sao_Paulo`; timezone do navegador/sessão não define o mês. Recebimentos e estornos são limitados por `effective_at <= anchor`, o mesmo `statement_timestamp()` devolvido em `as_of`; lançamentos efetivos futuros não entram, mesmo dentro do mês atual. O saldo pendente continua usando o ledger completo autoritativo C4, inclusive lançamentos futuros já registrados, sem criar uma fórmula temporal paralela de saldo.

Pedidos arquivados não são excluídos silenciosamente (mesma abrangência dos readers existentes). Inventário inclui posições de produtos arquivados/excluídos logicamente com saldo físico: arquivamento não elimina estoque. Não há indicador de baixo estoque de produto pronto sem threshold autoritativo.

Não são consultadas assinaturas, pagamentos Asaas ou preços sugeridos para formar vendas/recebimentos/lucro. Não é calculado lucro. Materiais gerais e impressoras foram analisados, mas indicadores foram omitidos: contagens cadastrais não agregam utilidade suficiente ao painel, unidades heterogêneas não podem ser somadas e não há threshold de baixo saldo de material aprovado.

## Consultas, segurança e precisão

- Nova `get_home_dashboard()`: resposta JSON pequena, seis meses e no máximo cinco pedidos; usa `private.orders_c4_reader()` para obter empresa da sessão. Nenhum parâmetro de tenant livre.
- Nova `get_home_inventory()`: valida contexto empresarial, identidade interna e `private.can_access_enterprise(...,'inventory.read')`, incluindo gate central de plano no banco.
- Ambas `VOLATILE SECURITY DEFINER SET search_path=''`, owner postgres; execução revogada de PUBLIC/anon/authenticated/service_role, depois concedida somente a authenticated. Sem mutação de domínio; mantêm os advisory transaction locks do padrão de autorização existente.
- Todos os acessos de tabelas são explicitamente limitados por empresa. Nenhuma concessão nova sobre tabelas/RLS. Usa cliente Supabase de sessão, nunca service role.
- Reader exige `requireBusinessContext('sales.read')`; autorização paga/permissão específica ocorre antes de cada loader físico. Verifica também tenant nos resultados/contextos. Schema Zod estrito rejeita payload inválido, contagens inseguras e períodos inconsistentes.
- SQL soma `numeric`, devolve centavos inteiros como strings; UI formata e calcula ticket em BigInt. Apenas alturas proporcionais das barras são convertidas a Number, após normalização inteira; nenhum total monetário é agregado em ponto flutuante.
- Não há cache compartilhado de dados de empresa: rota dinâmica, sem fetch/cache global.

## Planos e falhas

Gate de entrada continua `requirePlanBusinessAccess()`. Aprendiz, inclusive expiração/cancelamento com acesso efetivo gratuito, **não inicia consultas físicas** e recebe o componente pago já aprovado. Visionário regular tem leituras próprias de inventário e carretéis. Cada RPC continua revalidando autoridade; o frontend não substitui o gate do banco. Sidebar preservada, inclusive módulos pagos.

Leituras financeiras falhas não exibem cards/valores como sucesso. Inventário e carretéis falham independentemente; um erro não zera o outro. Erros de contexto/plano usam a apresentação central existente. Esqueletos são não numéricos. Sem pedidos há mensagem explícita; sem vendas/movimentação no período há mensagem de ausência e buckets verdadeiramente zerados. Carretéis vazios e limite zero são válidos.

RPCs diferentes não compartilham necessariamente snapshot: contagens de carretéis e configuração podem refletir instantes ligeiramente distintos sob edição concorrente. Inventário disponível/reservado vem de uma só agregação. Resumo financeiro depende do helper por pedido (custo cresce com histórico); não carrega pedidos no browser. Homologação deve avaliar plano de execução e latência para empresas grandes antes de decidir otimização adicional, preservando a autoridade financeira.

## Responsividade e acessibilidade

Cards: uma coluna estreita, duas a partir de 560px, quatro a partir de 1280px. Operação/estoque lado a lado a partir de 1200px. Contêineres `min-w-0`, valores com quebra, listas móveis sem tabela desktop comprimida, ações principais com altura mínima de 44px. Gráfico CSS sem biblioteca nova, seis colunas fluidas, labels compactos e valores exatos disponíveis em lista expansível acessível. Barras mostram magnitude; líquidos negativos têm indicação textual e valores assinados, não são convertidos a recebimentos positivos. Erros usam `role=alert`; loading tem status e `aria-busy`.

**Não houve homologação visual em navegador.** Verificar manualmente 320, 375, 430, 768, 1024 e 1440px, inclusive o componente pago preexistente, números máximos, nomes extensos, sidebar/drawer, foco/toque e ausência de overflow horizontal. A revisão de classes não substitui essa verificação.

## Verificações executadas

- `node --test tests/home-dashboard.test.cjs`: **12 passaram**. Referência financeira independente, exclusão de cancelados, pedido em andamento, parcial/estorno, `effective_at`, saldo, ativos, seis meses, virada de mês, precisão, tenants, schemas/vazios/erros, renderização e reader runtime com stubs Aprendiz/Visionário e gates anteriores às queries.
- `node --test tests/paid-module-gate.test.cjs tests/paid-action-errors.test.cjs tests/plan-capacity.test.cjs tests/products-access.test.cjs tests/global-navigation.test.cjs`: **26 passaram**.
- `node supabase/tests/orders_stage72flex_static.mjs`: **11 passaram**, verificações estáticas dos contratos de Pedidos existentes.
- `npx tsc --noEmit`: passou.
- ESLint direcionado aos arquivos Home/dashboard: passou após mover a construção JSX para fora do try/catch.
- `npm run build`: passou (exit 0), sem acesso SQL autorizado por esta tarefa.
- `git diff --check`: executado, sem erros de whitespace; avisos locais LF/CRLF não representam validação de banco.

**Limite dos testes:** stubs e referência financeira não executam as RPCs novas. As verificações SQL são inspeção textual, não parser/execução PostgreSQL, não demonstram ACL/RLS efetivos, concorrência ou performance. Não se declara PostgreSQL homologado.

## Validação manual posterior autorizada

1. Revisar/aplicar manualmente migration e dependências em ambiente autorizado; confirmar assinaturas, ACLs e schema cache PostgREST.
2. Homologar duas empresas, papéis e planos, mudança/expiração durante leitura, seleção/equipe irregular e tenants inconsistentes.
3. Validar dinheiro decimal/muito grande, pedido cancelado com recebimento não estornado, parcial, estorno em outro mês, datas antes/depois da meia-noite local, mês sem pedidos e líquido mensal negativo.
4. Conferir físico totalmente reservado, posições arquivadas com saldo, carretéis baixos/vazios/excluídos e threshold 0/100.
5. Confirmar falha de migration/RPC sem zero falso, erros parciais, latência e planos de execução em volume real.
6. Executar checklist visual nas seis larguras e com teclado/leitor de tela.
