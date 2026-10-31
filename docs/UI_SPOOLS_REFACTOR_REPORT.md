# Carretéis — refatoração visual 10

## Inspeção e referência

Inspecionados `/estoque/carreteis`, `/novo`, `/[id]`, `/configuracao`, componentes SpoolForms/ThresholdForm/SpoolDeleteButton, `lib/spools/{actions,schemas,validation,format,navigation}.ts`, plano/capacidade e integração existente com Precificadora. Referência: `design-references/stitch_modulus_3d_editor/carret_is_modulus_hub/{code.html,screen.png}` e README de adaptação. Guias locais do Next consultados antes da implementação.

Classificação prévia:
- Existente: identificação, tipo, marca, cor textual, peso original, saldo, compra, situação, busca, filtros, criação, edição de perfil, movimentos, histórico, exclusão, arquivar/restaurar e configuração do alerta.
- Adaptável: cards, hierarquia, destaque visual de filamento e estados de saldo; ilustração substituída por SVG nativo solicitado.
- Descartável: impressora/localização associada, lacrado, diâmetro, estoque seco, características técnicas e contagens ilustrativas; setas decorativas.
- Futuro sem contrato: arrastar nível, telemetria e consumo sincronizado; não implementados.

Não foi copiado HTML/script do Stitch, nem criada navegação global, imagem externa ou biblioteca.

## Indicador SVG

Criados `components/spools/SpoolLevel.tsx` e `SpoolLevel.module.css`. Componente client reutilizável com SVG nativo, sem IDs compartilhados, requests ou operações de estoque.

- Saldo real: `current_balance_grams`.
- Referência real: `original_filament_grams`.
- Ambos em gramas líquidas de filamento, não peso bruto/tara.
- Fórmula: percentual real = saldo / peso original × 100.
- Somente arco/aria-valuenow são limitados a 0–100%; peso e percentual textual real permanecem visíveis, incluindo aviso para saldo acima da referência.
- Saldo nulo, negativo ou não finito nunca se torna zero/esgotado.
- Referência ausente, zero ou inválida mantém peso real, representação estática e percentual indisponível. Nunca presume 1.000 g.
- Cor aceita apenas hex #RGB/#RRGGBB; nomes textuais e valores inseguros usam azul oficial. A cor cadastrada continua mostrada como texto, sem tentar inferi-la.
- Baixo: laranja #FF4E26; esgotado: #DC493A e texto explícito. Zero usa linha butt para não deixar uma marca arredondada enganosa no arco.
- Configuração real: `getSpoolConfig().config.low_spool_threshold_percent`, regra SQL <=, excluindo saldo zero. Não há fallback inventado quando consulta falha; indicador informa alerta indisponível.
- SVG com progressbar quando percentual calculável, aria-valuetext com peso e percentual reais; caso indisponível usa img com label. Elementos SVG decorativos ocultos da árvore acessível.
- Transição única de stroke-dashoffset por 650 ms quando recebe props novas. Sem giro, animação infinita ou montagem animada artificial. prefers-reduced-motion desativa transition. A transição CSS não foi visualmente homologada em navegador.

## Matriz dos campos

Schemas reais reutilizados, sem alterações de domínio. Objetos de submissão estritos; decimal preservado como texto e normalizado pela action (trim e vírgula → ponto).

| Campo | Tipo/unidade | Obrigatório | Mínimo | Máximo | Casas | Padrão/contrato |
| --- | --- | --- | --- | --- | --- | --- |
| material_type | texto | sim | 1 caractere após trim | 80 caracteres | — | vazio/valor atual; tipo próprio, não ID do catálogo |
| brand | texto | chave sim, conteúdo opcional | vazio | 120 caracteres | — | vazio/valor atual; vazio normaliza null |
| color | texto livre | chave sim, conteúdo opcional | vazio | 80 caracteres | — | vazio/valor atual; vazio normaliza null, sem campo novo de hex |
| internal_identifier | texto | sim | 1 caractere após trim | 120 caracteres | — | vazio/atual; conflito de identificador validado no backend |
| original_grams | decimal g | sim no cadastro | 0,001 | 100.000 | 3 | sem capacidade presumida; vira original_filament_grams |
| initial_balance_grams | decimal g | sim no cadastro | 0 | 100.000 e <= original | 3 | explícito; não inferido do peso original |
| purchase_price | decimal BRL | sim no cadastro | 0 | 1.000.000 | 2 | sem custo fictício; não editável no perfil |
| movement_type | enum | sim no movimento | — | consumption/replenishment/adjustment | — | consumo por padrão |
| quantity_grams | decimal g | consumo/reposição | 0,001 | 100.000 | 3 | somente nesses tipos |
| counted_balance_grams | saldo absoluto g | ajuste | 0 | 100.000 | 3 | substitui quantity_grams, não delta |
| reason | texto | movimento | 1 caractere após trim | 500 caracteres | — | histórico real |
| threshold | percentual | configuração | 0 | 100 | 2 | valor real da empresa |
| spool_id | UUID | alterações | — | — | — | ID carregado |
| expected_version | inteiro | alterações | 0 | MAX_SAFE_INTEGER-1 | 0 | versão carregada; sem edição manual |
| attempt_id | UUID | cadastro e movimento | — | — | — | congelado para repetir resultado incerto; perfil/estado/config não ganham ID fictício |
| active | boolean | arquivar/restaurar | — | — | — | inverso do estado atual |

Pesos aceitam ponto/vírgula decimal, até três casas; preço até duas. Não se usa parseFloat, arredondamento de payload nem conversão inválida para zero. Letras, notação científica, sinal negativo, agrupamento, prefixo monetário ou excesso de precisão são rejeitados mantendo texto para correção. Backend continua autoritativo.

## Estoque, custos e integrações preservados

Consumo subtrai, reposição soma, ajuste informa saldo contado. Backend impõe saldo entre zero e peso original, bloqueio de arquivados, versão e idempotência nos fluxos existentes. Confirmação de movimento e de arquivamento mantidas. Perfil altera identificação/tipo/marca/cor, não peso original/preço. Exclusão exige saldo zero e preserva histórico no backend. Histórico e resumo de consumo acumulado reais mantidos.

Custo por grama continua compra/peso original. Precificação integrada utiliza carretéis ativos, suas versões e snapshots; não há baixa automática adicionada. Home, Precificadora, catálogo de materiais e motor de cálculo não foram refatorados.

## Plano e permissões

Aprendiz permanece no PaidModuleNotice original por renderPaidModule, sem mudanças de textos/estilos/comportamento ou sidebar. Visionário mantém capacidade central `shared_materials` de 15 cadastros entre Materiais Gerais e Carretéis, imposta pelo backend e consultada apenas no cadastro. Arquivados e vazios contam; excluídos liberam; catálogo FDM legado não conta. Nenhum contador independente.

Owner/admin/operator podem ler e movimentar; owner/admin gerenciam perfil, arquivamento e exclusão. Configuração do limite mantém autoridade owner/enterprise.manage e gate pago. Sem alterações de autenticação, autorização, RLS, RPCs ou migrations.

## Arquivos desta entrega

- Rotas em `app/(authenticated)/estoque/carreteis/{page.tsx,[id]/page.tsx,novo/page.tsx,configuracao/page.tsx,loading.tsx}`.
- `components/spools/{SpoolForms.tsx,ThresholdForm.tsx,SpoolDeleteButton.tsx}`.
- Novos estilos locais: `SpoolPages.module.css`, `SpoolForms.module.css`.
- Novo SVG: `SpoolLevel.tsx`, `SpoolLevel.module.css`.
- Novos testes: `tests/spool-level.test.cjs`, `tests/spools-ui-validation.test.cjs`.

## Responsividade e acessibilidade

Cards em grid adaptável, SVG proporcional menor no mobile, superfícies brancas/neutras locais, texto #152336 e azul #2B00FF, foco lilás. Space Grotesk herdada. Sem setas decorativas, imagens, zoom ou ações ocultadas por viewport. Labels, erros associados, loading/alert/status e foco visível; botões com área mínima adequada. Formulários em coluna no mobile; histórico quebrável sem cortar motivos.

Alvos: 320, 375, 430, 768, 1024, 1440px. Revisão de código/CSS não equivale a homologação visual. Sem navegador automatizado disponível no projeto; não foram instaladas dependências.

## Segunda revisão e verificações

### Problemas encontrados e corrigidos

1. Fallback silencioso de 10% divergente do default SQL de 20% removido: falha de configuração agora é explícita e não classifica por um limite inventado.
2. Contagem de getDeletionCounts rotulada como excluídos, mas RPC conta não excluídos: texto corrigido para cadastros incluindo arquivados/esgotados. Não se usa essa contagem para autorizar capacidade.
3. Listagem tinha total/offset reais sem controles: adicionada paginação por 20 com filtros preservados.
4. Expressão canWrite sempre verdadeira removida; UI usa a matriz central de permissões real.
5. Erro técnico no detalhe era tratado como notFound: agora distinguido de spool_unavailable.
6. Formulários não tinham validação local com erros associados: schemas existentes reutilizados, inputs claros, dados mantidos após falha, submissão via onSubmit sem reset automático.
7. Tentativa incerta podia ser seguida por outra operação: payload/UUID congelados, controles concorrentes bloqueados. Sem attempt_id novo para operações que não possuem esse contrato.
8. no_change libera controles; confirmação com versão nova bloqueia nova operação até refresh, evitando envio contra versão anterior.
9. Custo por grama podia aparecer como R$ 0,00 mesmo positivo: detalhe passa a mostrar até nove casas (precisão do custo unitário existente), sem alterar cálculo ou payload.
10. SVG zero não mantém marca de ponta arredondada; dados inválidos não viram zero; status e peso real comunicados por texto e ARIA. Indicador no detalhe não usa key por versão, permitindo transição após atualização, enquanto controles usam id:version para defaults novos.
11. Testes de capacidade precisaram mockar apenas o novo import CSS; assertions funcionais mantidas e repetidas com sucesso.
12. Segunda leitura de rotas, formulários, threshold, exclusão, SVG e estilos verificou superfícies claras, quebra de textos, foco, ausência de setas e dependências externas.

### Execução local

`node --test tests/spool-level.test.cjs tests/spools-ui-validation.test.cjs tests/spools-forms.test.cjs tests/shared-material-creation-pages.test.cjs tests/plan-capacity.test.cjs tests/paid-module-gate.test.cjs tests/paid-action-errors.test.cjs tests/home-dashboard.test.cjs tests/pricing-actor-authorization.test.cjs tests/pricing-ui.test.cjs tests/pricing-wizard.test.cjs`: **118 passaram, zero falhas**. São 19 casos específicos do SVG, 23 de formulários e 15 de validação/actions de Carretéis, além das regressões existentes.

- `npx tsc --noEmit`: passou.
- ESLint direcionado a rotas/componentes/testes: passou sem warnings após remover variável não utilizada do harness.
- `npm run build`: passou (Next 16.3.1); aviso preexistente de middleware depreciado, sem migração fora do escopo.
- `git diff --check`: passou, apenas avisos LF/CRLF do workspace.

### Limitações preexistentes documentadas, sem alterar contratos

- deleted_at não está selecionado nem no schema de detalhe, embora a página tenha verificação histórica desse atributo; acesso direto a um excluído pode mostrar controles que o backend deve rejeitar. Corrigir apresentação requer revisão do contrato de leitura/seleção, fora do escopo de não alterar contratos; não se inventou estado.
- Possível lacuna de entitlement na chamada direta da RPC update_my_spool_threshold: SQL autoriza enterprise.manage, que possui exceção de plano para owner; a action atual aplica gate pago explicitamente. Não foi testada remotamente, nem alterada autorização. Requer auditoria separada autorizada e, se confirmada, nova migration com gate pago na RPC, nunca só frontend.
- Identificador de excluído continua reservado conforme a autoridade atual. Criação/movimento possuem idempotência, outras operações usam versão mas não ganham garantia nova de idempotência.
- Comparação de baixo usa valor não arredondado; percentual textual é apresentação. Nenhuma correção visual altera o saldo.

## Pendências

Homologar em navegador cards/formulários nos seis viewports, transição após movimento confirmado e prefers-reduced-motion, teclado e leitor de tela. Testes locais com mocks não provam integração real SQL/RLS/concorrência; nenhum banco remoto ou SQL foi executado. Sem Docker/WSL, instalação, commit, push ou deploy. Mudanças anteriores do workspace preservadas.
