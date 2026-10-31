# Materiais Gerais — refatoração visual 08

## Escopo e inspeção

Implementação local em `/estoque/materiais-gerais`, `/novo` e `/[id]`. Inspecionados listagem, formulários de criação, perfil, custo, movimentação, arquivamento, confirmação nativa de exclusão, schemas, actions, formatação, navegação, gates de plano e capacidade. Não havia modal/drawer de edição; a edição permanece na página de detalhes, sem introduzir fluxo paralelo.

Fontes funcionais: `lib/general-materials/{actions,schemas,validation,format,navigation}.ts`, `lib/plans/creation-access.ts`, componentes de plano e migrations locais `20261022000000_general_materials_inventory.sql`, `20261024000000_stage5_deletion_counts.sql`, `20261025000000_stage6_plans_entitlements.sql`, `20261026090000_creation_capacity.sql`, `20261026150000_pricing_actor_authorization.sql`. Integração inspecionada em `lib/pricing/{actions,persistence-actions,persistence,fdm}.ts` e componentes existentes. SQL apenas lido; nenhum acesso ao Supabase remoto.

O workspace já possuía numerosas alterações staged e unstaged de outras etapas. Foram preservadas; não houve commit, instalação ou deploy.

## Referência e classificação antes da implementação

Referências: `design-references/stitch_modulus_3d_editor/README.md` e `materiais_modulus_hub/{code.html,screen.png}`. O protótipo representa catálogo FDM, não o contrato de Materiais Gerais. PNG, HTML e diretrizes foram inspecionados; não foram copiados HTML, scripts, navegação ou assets externos.

| Elemento | Classificação | Decisão |
| --- | --- | --- |
| Nome, referência de custo, status, busca, filtro, cadastro, detalhes, paginação | Existente | Preservar com dados reais |
| Cabeçalho, superfícies claras, organização de filtros, tabela e badges | Adaptável | Adaptar ao domínio real e paleta Modulus |
| Saldo, movimentos, edição, históricos, arquivar/reativar e excluir | Existente, ausente ou diferente no Stitch | Manter operações reais |
| Marca, polímero, cor/amostra, código ilustrativo | Descartável neste módulo | Não criar campos |
| Total de polímeros, custo médio, impressoras vinculadas, alertas críticos e contagens ilustrativas | Descartável | Não apresentar métricas inventadas |
| Abas com contagem de carretéis e relação direta por material | Descartável | Não inventar vínculo; capacidade compartilhada é a relação real |
| Novos alertas/reposição/estoque mínimo | Futuro sem contrato nesta entrega | Não implementar |
| Setas em detalhes | Descartável | Links sem setas decorativas |

## Arquivos alterados/criados

- `app/(authenticated)/estoque/materiais-gerais/page.tsx`: listagem, filtros, estados, cards mobile, tabela desktop, retorno com filtros.
- `app/(authenticated)/estoque/materiais-gerais/[id]/page.tsx`: detalhes claros, gerenciamento, históricos responsivos, navegação de movimentos.
- `app/(authenticated)/estoque/materiais-gerais/novo/page.tsx`: enquadramento claro responsivo; gate central mantido.
- `app/(authenticated)/estoque/materiais-gerais/loading.tsx`: feedback de carregamento sem animação.
- `components/general-materials/GeneralMaterialForms.tsx`: formulários claros, schemas compartilhados, erros locais, proteção de tentativas e ajuste correto.
- `components/general-materials/GeneralMaterialDeleteButton.tsx`: alvo de toque e foco; contrato/confirmação preservados.
- `components/general-materials/{GeneralMaterials,MaterialForms}.module.css`: estilos locais, sem alterar tema global.
- `lib/general-materials/format.ts`: BRL com duas a seis casas visíveis, sem alteração do valor enviado.
- `tests/general-materials-ui-validation.test.cjs`: regressões de validação.
- `tests/general-materials-forms.test.cjs`: testes isolados dos handlers reais dos formulários.

Space Grotesk é herdada do layout existente. Azul elétrico `#2B00FF`, texto `#152336`, foco lilás e superfícies brancas/neutras. Logo e navegação global existentes não foram recriados. Não há necessidade de usar laranja indiscriminadamente em ações comuns.

## Matriz de campos (contrato real)

Todos os schemas de submissão são estritos. Campos obrigatórios numéricos permanecem texto decimal até a validação. Limites abaixo são da aplicação, sem alteração do SQL.

| Campo | Tipo/unidade | Obrigatório | Mínimo | Máximo | Precisão | Padrão UI | Validação/normalização e envio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `name` | texto | Sim | 1 caractere após trim | 120 caracteres | — | vazio / nome atual | trim pelo schema; `name` |
| `control_unit` | enum de unidade | Sim no cadastro | — | 5 opções reais | — | unidade | enum, `control_unit`; imutável após criar |
| `reference_quantity` | decimal na unidade de controle | Sim | 0,000001 | 1.000.000 | 6 casas | vazio / referência atual | dígitos + vírgula ou ponto; trim e decimal com ponto no schema; string para action |
| `reference_price` | decimal BRL para a quantidade de referência | Sim | 0 | 1.000.000 | 6 casas | vazio / preço atual | mesma validação; sem parseFloat, máscara que arredonde ou conversão inválida em zero |
| `opening_quantity` | decimal na unidade de controle | Sim no payload | 0 | 1.000.000 | 6 casas | 0 | saldo inicial explícito; normalização decimal |
| `movement_type` | entry/consumption/adjustment | Sim no movimento | — | — | — | entry | união discriminada |
| `supplied_unit` | enum de unidade | Sim no movimento | — | 5 opções reais | — | unidade do material | compatibilidade/conversão continua autoritativa no backend |
| `quantity` | quantidade de entrada/consumo na unidade informada | Sim nesses tipos | 0,000001 | 1.000.000 | 6 casas | vazio | decimal positivo; não enviado no ajuste |
| `counted_balance` | saldo absoluto contado na unidade informada | Sim no ajuste | 0 | 1.000.000 | 6 casas | vazio | decimal não negativo; substitui quantity |
| `reason` | texto | Sim no movimento | 1 caractere após trim | 500 caracteres | — | vazio | trim; `reason` |
| `active` | boolean | Sim no arquivamento/reativação | — | — | — | inverso do estado atual | boolean explícito, não string |
| `material_id` | UUID | Sim nas alterações | — | — | — | registro atual | UUID, não editável |
| `expected_version` | inteiro de versão | Sim nas alterações | 0 | MAX_SAFE_INTEGER - 1 | 0 | versão carregada | schema version, enviado à action |
| `attempt_id` | UUID | Sim | — | — | — | crypto.randomUUID | congelado com o payload em resultado incerto |

Não existem categoria, observações, estoque mínimo ou fornecedor nesse contrato. Quantidades fracionárias são permitidas inclusive em `unidade`: a interface não impõe inteiro sem respaldo. Campos BRL identificam R$, usam vírgula nos valores existentes e aceitam ponto/vírgula decimal. Não aceitam separador de milhar, prefixo R$ colado, letras, sinal negativo, notação científica ou mais de seis casas. Conteúdo inválido permanece visível para correção e não é enviado. Mensagens junto aos campos usam `aria-invalid` e `aria-describedby`; feedback geral usa alert/status. `onSubmit` evita o reset automático de formulários via action do React após validação inválida.

## Unidades, estoque e custos preservados

Unidades exatas: `unidade`, `metro`, `centimetro`, `grama`, `quilograma`. Todas aceitam seis casas no schema. Banco utiliza `numeric(18,6)` nas referências e saldos. Conversões existentes: mesma unidade, metro/centímetro e quilograma/grama; unidades incompatíveis e conversões não representáveis são rejeitadas pelo backend. A UI não converte automaticamente.

Entrada soma, consumo subtrai sem permitir saldo negativo, ajuste informa saldo absoluto contado. Saldo inicial positivo cria movimento opening. Zero delta resulta em no_change. Material arquivado não recebe movimento. Referência é preço de uma quantidade, não custo médio ou compra individual de entrada. Custo unitário e custo assinado continuam calculados no SQL (12 e 6 casas respectivamente). Atualização da referência preserva histórico; não reescreve movimentos ou saldo. Nenhum total mistura unidades heterogêneas.

Arquivamento, reativação e exclusão permanecem nas actions existentes. Exclusão exige saldo zero no backend e preserva histórico. Confirmação nativa existente mantida. Precificação utiliza materiais gerais ativos como embalagem, com conversões e snapshots existentes; salvar precificação não movimenta estoque. Nenhum arquivo da Precificadora ou de Carretéis foi alterado.

## Planos, capacidade e permissões

Gates existentes via `renderPaidModule` preservados. Aprendiz continua com `PaidModuleNotice` original; o componente, seus textos, ações, estilos e sidebar não foram alterados. Visionário continua com limite compartilhado de 15 entre carretéis e materiais gerais, consultado por `getCreationCapacity("shared_materials")` apenas no cadastro e imposto transacionalmente pelo backend. Arquivados e carretéis vazios contam, excluídos liberam capacidade; catálogo FDM legado não conta. Sem contador independente no frontend.

Owner/admin/operator leem e movimentam. Apenas owner/admin editam perfil/custo, arquivam/reativam e excluem conforme o fluxo atual. Backend segue autorizado pelas mesmas actions, RPCs e políticas; nenhum RLS/endpoint/schema/migration foi modificado.

## Responsividade e acessibilidade

Listagem e históricos têm cards abaixo de 768px e tabelas acima, preservando informações e acesso ao material. Formulários em coluna no mobile e grid adaptável no desktop; filtros refluem. Larguras mínimas zero, textos longos quebráveis e tabelas contidas com rolagem quando necessário em tablet. Botões com mínimo 44px, foco visível, labels, fieldsets desabilitados durante operações, feedback de salvamento e mensagens associadas. Nenhum zoom CSS, animação ou seta decorativa.

Alvos obrigatórios de homologação: 320, 375, 430, 768, 1024 e 1440px. Implementação por revisão de CSS/código; **não homologada em navegador**. Não há Playwright, @playwright/test ou Puppeteer instalado; nenhuma dependência foi instalada.

## Segunda revisão: problemas identificados e correções

1. Ajuste enviava quantity, incompatível com o schema: corrigido para counted_balance e label de saldo contado.
2. Campos não tinham validação local/erros individuais: schemas reais reutilizados antes de chamar actions; erros associados aos campos.
3. Sucesso era apresentado como erro: feedback separado em superfícies claras verde/vermelho.
4. BRL ocultava casas válidas: exibição até seis casas, sem arredondar payload.
5. Formulários action poderiam limpar entradas não controladas após falha: submissão via onSubmit preserva valores.
6. Tentativa incerta permitia outras operações concorrentes na mesma versão: bloqueio local entre formulários até resolução, replay com mesmo UUID/payload.
7. Controles não recarregavam valores após versão nova: key por id/versão. no_change não mantém formulário bloqueado esperando uma versão que não muda.
8. Parâmetros de página fracionários ou infinitos: normalizados para inteiro entre 1 e 5001; status inválido volta ao padrão real.
9. Históricos largos: cards mobile mantêm todos os campos; paginação de movimentos reutiliza o offset real sem inventar total. Histórico de custos informa limite real de 20.
10. Revisados todos os arquivos desta entrega quanto a superfícies claras, permissões, unidades, precisão, ações e ausência de setas; backend e cálculo não alterados.

## Testes e verificações

- `node --test tests/general-materials-ui-validation.test.cjs tests/shared-material-creation-pages.test.cjs tests/plan-capacity.test.cjs tests/pricing-access.test.cjs tests/pricing-actor-authorization.test.cjs tests/pricing-ui.test.cjs tests/pricing-wizard.test.cjs`: 42 testes passaram na primeira execução.
- `npx tsc --noEmit`: passou.
- ESLint direcionado aos TSX do módulo, componentes, formatador e ambos os testes novos: passou. Na revisão, o harness novo usava uma variável chamada module, proibida pela regra Next; renomeada para loadedModule e verificação repetida com sucesso.
- `npm run build`: passou (Next 16.3.1); warning preexistente de middleware depreciado, sem migração fora do escopo.
- `git diff --check`: passou; avisos LF/CRLF do workspace, sem erros de whitespace.
- Execução final dos oito arquivos de testes listados acima, incluindo `tests/general-materials-forms.test.cjs`: **50 passaram, zero falhas**. Inclui teste de formatação BRL com seis casas e quantidades fracionárias.
- `npx tsc --noEmit` e `npm run build` repetidos após as correções finais: passaram.

## Limitações e pendências

Não foram executados testes SQL, integração remota, RPCs reais, RLS ou concorrência de criação no banco. Os testes locais exercitam schemas, handlers com mocks, contratos de capacidade/autorização e regressões de precificação; não equivalem a homologação end-to-end autenticada.

Pendente homologar CRUD/movimentos reais por papel/plano e nos seis viewports, teclado e leitores de tela. Não foi declarado funcionamento remoto como testado.

Limitações preexistentes documentadas, sem mudança arquitetural: schemas de leitura convertem numeric para Number (risco em valores SQL muito altos), aplicação limita a 1 milhão enquanto SQL admite faixa maior; histórico de custo só entrega 20 alterações; getGeneralMaterial não fornece contagem de movimentos. Expor histórico completo de custos exige contrato de navegação/paginação adicional ou reutilização explícita de offset em outra consulta, a aprovar fora desta entrega. Metadados deleted_at não fazem parte do schema atual de leitura, apesar de a página já verificar sua presença; corrigir apresentação histórica de excluídos exige revisão separada do contrato de leitura. Nenhuma dessas limitações foi mascarada com dados inventados.
