# M7.3 FINAL — implementação integrada de Pedidos

Data: 27/10/2026. Implementação local de aplicação, com testes unitários/mocks e build. **Não equivale a homologação PostgreSQL, navegador ou produção.**

## Correção cirúrgica — recusas definitivas e preservação do modal (27/10/2026)

- Causa: o coordenador bloqueava qualquer `!result.ok`, inclusive `payment_exceeds_pending`/`invalid_input`; a confirmação fechava o modal imediatamente, e o efeito de leitura também o descartava.
- Modal agora aguarda resultado tipado, fecha apenas no sucesso e mantém campos/valores e mensagem interna em recusas. Atualizações de leitura não descartam o formulário. Campo obrigatório continua validado no cliente e servidor. Ref síncrona + lock central impedem duplo envio.
- Recusa definitiva de validação/negócio permite corrigir e confirmar explicitamente uma **nova intenção com novo UUID**. O envelope anterior não é alterado. Não há reload obrigatório para corrigir valor acima do saldo.
- Conflito de versão bloqueia até a versão autoritativa avançar; atualização não reenvia nada. A confirmação posterior captura versão atual e novo UUID. Permissão/identidade e conflitos de idempotência/recibo não são liberados pelo botão de revisão.
- Rede/resultado incerto mantém exatamente UUID, argumentos e identidade no `sessionStorage`, sem reenvio automático. Retomada explícita pode fechar o modal no sucesso. Actions informam `dispatched:false` para falhas pré-despacho; essas falhas em um retry não apagam a incerteza original (incluindo validação e plano).
- Regressões Node VM cobrem: valor acima do saldo e edição sem reload; nova UUID; obrigatório; permissão; conflito de versão com atualização/reconfirmação; rede/persistência/retry exato e falha pré-despacho; duplo clique; estorno rejeitado. Teste do componente verifica modal aberto, valor/nota preservados e mensagem interna, fechando somente no sucesso.
- Validação local: `node --test lib/orders/write.test.cjs lib/orders/operations.test.cjs` (20 testes), `npx tsc --noEmit` e ESLint direcionado aos arquivos alterados. Sem homologação em navegador ou banco real; sem SQL, migração, dependências, autenticação central, infraestrutura, commit/push/deploy.

## 1. Fontes e rastreabilidade

Lidos integralmente `docs/M7_3_KANBAN_INTEGRATION_ANALYSIS.md`, a migration local FLEX `20261027120000_orders_stage72flex_delivery_cycles.sql`, C4 `20261026184000_orders_stage72c4_payments.sql` e seu contrato `docs/ETAPA_7_2C4_CONTRATO_PAGAMENTOS.md`; inspecionados código comercial, leitor, página, controller, seletor e Kanban existentes e schema histórico A. Consultados os guias instalados Next de Server Actions e `revalidatePath` antes da implementação.

A aplicação utiliza **o contrato local**, não uma descoberta do banco remoto. As partes exatas aplicadas, correções e evidência de commit não foram disponibilizadas. A equivalência entre o SQL instalado e o arquivo FLEX permanece não verificável. O arquivo local possui três transações independentes, conforme análise anterior. **Nenhum SQL foi executado, alterado, criado ou reaplicado nesta implementação.** A ausência das partes não foi contornada com compatibilidade silenciosa: respostas incompatíveis falham explicitamente. Antes da liberação, o responsável deve confrontar offline os artefatos realmente aplicados com os contratos locais.

O repositório já continha alterações e muitos arquivos de Pedidos não rastreados. Essas bases foram tratadas como trabalho do usuário, não removidas ou revertidas. Não houve mudança em autenticação central, dependências/package-lock, migrations, Asaas, containers, Docker/WSL, commit, push ou deploy. Build e testes locais não fizeram chamadas explícitas a Supabase; rotas autenticadas permanecem dinâmicas.

## 2. Funcionalidades integradas

### Operacional FLEX

- Todos os 20 pares distintos entre Em conversão, Orçado, Pago, Modelando e Imprimindo são permitidos; os dez retrocessos exigem motivo.
- Entregue e Cancelado nunca são destinos da action genérica de transição.
- Criação, edição comercial, lista padrão, busca, filtros URL, paginação, toggle Kanban, sete colunas, `@dnd-kit/react` e alternativa por seletor foram preservados.
- Ações especiais são explícitas nos detalhes: **alocar item integral, entregar, desfazer entrega, cancelar e reabrir**. Arraste para destino especial orienta abrir detalhes; não despacha comando terminal. Cartões terminais não são arrastáveis; texto agora explica a saída por undo/reopen.
- Reabertura não possui destino arbitrário: RPC fixa `em_conversao`.
- Cancelamento não encadeia undo, estorno ou movimentação manual. Entregue exige fluxo separado de undo antes de eventual cancelamento posterior.

### Físico

- Consulta `get_order_physical_state` somente no pedido aberto: **nenhuma leitura física por cartão**.
- Parser estrito da tupla completa, UUIDs, enums, booleans, nullability e inteiros seguros. Erro/ausência não vira untracked.
- Snapshot compara pedido, versão, conjunto completo/único de itens, produto, quantidade, modo e evento vigente; verifica relações mínimas de reserva/cobertura e flags. Não reconstrói ledger no cliente.
- Estados sem controle, reservado, saída válida, compensado, alocação necessária e reconciliação têm textos próprios.
- Entrega mostra efeito por item e aviso de saldo financeiro pendente **não bloqueante por valor**. Erro/incoerência de leitura exige atualização, não falso zero.
- Undo exige evento vigente de conjunto coerente, destino comum, motivo e **classificação sem default**. `actual_delivery` preserva saída; `incorrect_record` compensa apenas quando todas as linhas são elegíveis. D4 desabilita compensação e explica cobertura herdada; nenhuma flag isolada autoriza o pedido inteiro.
- Alocação é por item, integral, sem promessa de batch atômico. Versão confirmada precisa alcançar a UI antes de próximo comando.
- Reconciliação bloqueia o fluxo físico correspondente, não leitura/comercial/financeiro globalmente. Não há botão de reparo/forçar.
- Nenhuma action de Pedidos chama `move_product_inventory` ou faz DML direto.

### Financeiro C4 completo

- Resumo autoritativo separado de status operacional; mantém bruto, estornado, líquido e pendente.
- Registro manual em pedido não cancelado, com valor decimal textual, método exato `pix/card/cash/bank_transfer/other`, data efetiva explícita e nota opcional.
- Data local digitada é convertida uma vez em ISO UTC antes de congelar o envelope. Não há data efetiva implícita.
- Estorno integral por recebimento original, uma vez, motivo/data explícitos. Cliente não envia amount/method de refund.
- Nenhum gateway é cobrado/reembolsado; registro manual não significa transação externa.
- Histórico paginado por cursor composto `recorded_at + payment_id`, limite 20 (fronteira aceita 1–100); carrega anteriores sem descartar os já vistos. Erro é explícito. Estorno conhecido na página desabilita original; backend decide também para contrapartida fora da página.
- Snapshots financeiros das novas actions são validados em centavos com BigInt: bruto−estorno=líquido, total−líquido=pendente e status coerente; não se usa float para decidir lançamento.

## 3. Contratos e permissões

| Operação | RPC | Permissão na action | Invalida estoque |
|---|---|---|---|
| Transição comum | transition_order | sales.write | não |
| Alocação | allocate_order_stock | sales.write | sim |
| Entrega | deliver_order | sales.write | sim |
| Undo | undo_order_delivery | sales.write | sim |
| Cancelamento | cancel_order | **sales.delete** | sim |
| Reabertura | reopen_order | sales.write | sim |
| Recebimento | record_order_payment | sales.write | não |
| Estorno integral | reverse_order_payment | **sales.delete** | não |
| Físico/resumo/histórico | leitores públicos correspondentes | sales.read | não |

Cada action autoriza por `requireBusinessContext`, valida input específico estrito e usa cliente SSR autenticado; não aceita empresa/ator como fonte de autorização. Dispatcher com identidade valida novamente usuário/empresa atuais antes do envio/retry. Cada action individual continua autorizada quando invocada diretamente.

Não há pré-gate `inventory.write` ou plano físico genérico para entregar/desfazer/ler histórico. Plano, disponibilidade, cobertura, downgrade e exceções são avaliados pelas RPCs. `sales.delete` é separado de write na página e comandos; operator não ganha cancelamento/estorno por poder receber.

Outputs específicos validam status, cardinalidade 1, pedido, versão esperada +1, UUIDs de evento/reserva e campos próprios. Alocação verifica item; undo verifica evento de origem, destino e efeito coerente com classificação. Replay não é recusado por comparação com estado atual antes da RPC.

Erros conhecidos exigem **SQLSTATE e mensagem de domínio**, incluindo D4 com P0001/23514 e reserva inconsistente com ambos os códigos. SQLSTATE inesperado, transporte ou output incompleto após dispatch são `uncertain`; não se afirma rollback por timeout. Falhas de autenticação/pré-dispatch não causam RPC. `unstable_rethrow` preserva fluxo Next.

Pedidos e edição são revalidados em sucesso; operações físicas e criação com atendimento físico também invalidam `/estoque/produtos` e o padrão `/estoque/produtos/[id]` com tipo `page`. Não foram inventados dashboards ou métricas.

## 4. Coordenação, retry e privacidade

Um coordenador por página/identidade concentra transições e ações especiais. Guarda síncrona por pedido impede clique/drop duplicado e concorrência entre ação financeira e física no mesmo pedido. Outros pedidos são independentes; Next pode serializar dispatch no browser, sem promessa de paralelização/batch.

Envelope: identidade local usuário/empresa, operação, attempt UUID, pedido, versão e argumentos mínimos. `sessionStorage` versionado por usuário/empresa/aba é escrito **antes** do dispatch. Não contém cookies, JWT, credenciais, dados de comprador ou catálogo. Motivo/nota necessários para retry podem conter texto pessoal: diálogo orienta não inserir dados sensíveis. Persistência não é criptografia nem proteção contra XSS.

- Sem retry automático no mount, erro ou mudança de contexto.
- Retomada sempre explícita e com mesmos argumentos/UUID/V; servidor confere identidade atual.
- Reload recupera operação pendente/incerta e bloqueia nova intenção; não supõe que estado atual prova resultado da tentativa.
- Falha conhecida fica registrada como conhecida no reload. Nova intenção requer revisão explícita; conflitos idempotentes, recibo indisponível e identidade/autorização não oferecem descarte normal pelo controller.
- Falha de sessão/pré-dispatch durante retry de comando originalmente incerto não apaga a incerteza original.
- Falha de escrita no armazenamento impede novo dispatch e preserva envelope prévio em memória. Armazenamento inválido/ilegível bloqueia novas operações e orienta revisão.
- Sucesso confirmado não altera cartão com snapshot retornado; revalida/reconsulta. Bloqueio permanece enquanto a versão renderizada for menor que a confirmada. Replay antigo não regride UI mais recente.
- Retenção: pendências não expiram automaticamente (expiração não comprova rollback); são removidas em sucesso ou revisão explícita de falha conhecida; vida útil normal é a aba/sessão do navegador. Não há limpeza silenciosa de resultado incerto. Fechar a aba/limpar dados perde recuperação local: revisar evidência antes de nova intenção.
- SQL é o lock entre abas/operadores. Não há lock distribuído frontend, polling nem realtime. Outra aba requer atualização.

`router.refresh` permanece também como sincronização defensiva e para falhas conhecidas/revisão; `revalidatePath` já inclui atualização RSC conforme guia instalado. Custo redundante possível não foi medido no navegador. Leituras físicas/financeiras são invalidadas por versão e têm botão de consulta explícita para recuperar erro mesmo sem mudança de versão.

## 5. Acessibilidade e UX

Drawer e diálogos usam `<dialog>.showModal()`: fundo inert, contenção de foco nativa, Escape via cancel e restauração explícita ao elemento anterior. Diálogos possuem nome acessível; ações de fechar/voltar ficam disponíveis antes do envio. Modal de erro do drawer e motivo regressivo usam o mesmo primitive. Mensagens de loading/resultado/erro usam status/alert. Ações especiais não dependem de drag.

Confirmações descrevem consumo versus cobertura preservada, classificação e efeito, ausência de recebimento automático, ausência de refund automático e finalidade manual do financeiro. Fechar depois do dispatch não cancela transação; resultado e retry ficam no coordenador da página.

**Não foi executado teste de navegador:** foco real entre diálogos aninhados, leitores de tela, touch, contraste, sensores DnD e layout móvel precisam homologação. O uso de primitive nativo é implementação, não certificação de acessibilidade.

## 6. Arquivos desta implementação

Novos:
- `lib/orders/operation-schema.ts`: inputs/outputs específicos, físico/financeiro/histórico, identidade e coerência.
- `lib/orders/operation-errors.ts`: classificação SQLSTATE + domínio e mensagens seguras.
- `lib/orders/operation-actions.ts`: sete mutações, dispatcher com identidade e três leitores autorizados.
- `lib/orders/read-schema.ts`: validação runtime dos leitores comerciais/lista/itens existentes, incluindo BRL/enums/versões.
- `components/admin/orders/OrderDialog.tsx`: modal nativo acessível compartilhado.
- `components/admin/orders/OrderOperations.tsx`: ações explícitas, físico, resumo, financeiro manual e cursor.
- `lib/orders/operations.test.cjs`: testes de schemas/actions/coerência/controller com mocks executáveis.
- Este relatório.

Alterados de forma direcionada:
- `lib/orders/transitions.ts`: FLEX20/10 e política de motivo.
- `lib/orders/write-actions.ts`: erros por código+mensagem e invalidação física na criação; CRUD preservado.
- `lib/orders/actions.ts`: validação runtime sem defaults falsos; detalhes/itens vinculados ao pedido.
- `components/admin/orders/useOrderTransitions.ts`: coordenador integrado/persistência/retry.
- `components/admin/orders/OrderStatusSelector.tsx`: feedback/revisão e diálogo acessível.
- `components/admin/orders/OrdersView.tsx`: permissões/identidade, drawer e painel integrado.
- `components/admin/orders/KanbanBoard.tsx`: texto sobre fluxos especiais; DnD e paginação preservados.
- `app/(authenticated)/admin/orders/page.tsx`: identidade, capacidade delete e AuthContextError.code/login correto, sem auth central.
- `lib/orders/write.test.cjs`: expectativas FLEX e classificação de erros; teste de controller antigo substituído por cobertura integrada nova.

## 7. Verificações executadas

| Comando | Resultado |
|---|---|
| `node --test lib/orders/write.test.cjs lib/orders/operations.test.cjs` | **12/12 PASS**, zero skips |
| `npx tsc --noEmit` | **PASS**, saída vazia após correções locais |
| `npx eslint lib/orders components/admin/orders "app/(authenticated)/admin/orders"` | **PASS**, zero avisos/erros |
| `npm run lint` | **FAIL global**: detectou problemas anteriores fora do escopo e inicialmente quatro problemas novos, corrigidos; lint direcionado final PASS |
| Next build local (`npm run build`; confirmação final via Node spawn do mesmo CLI instalado) | **PASS**, exit 0: compilação, TypeScript, 37/37 páginas estáticas, rotas de Pedidos dinâmicas |
| `git diff --check` | PASS; somente avisos LF/CRLF em quatro arquivos preexistentes fora das alterações desta tarefa |

Build final confirmado com captura integral de stdout/stderr e status 0 (`node_modules/next/dist/bin/next build`, telemetry desabilitada apenas no processo). Único warning de build: convenção middleware depreciada em favor de proxy; não foi feita migração fora do escopo. Uma primeira tentativa de build identificou duplicidade de propriedade no novo schema de leitura, corrigida; tentativa inicial de tsc após adicionar BigInt literal identificou target anterior a ES2020, corrigida usando `BigInt()`.

Lint global inicial: 45 problemas (28 erros/17 warnings), incluindo refs/effects novos depois corrigidos. Permanecem fora do escopo effects em calculadoras, modais de catálogo, contextos e imports require em testes SQL históricos, além de warnings de imagens/unused. Não se declara lint global limpo.

Cobertura unitária/mocks real: 20 pares/10 motivos, terminais recusados, enum/método/data/valor/cursor, Unicode/btrim/code points e limite seguro; todas sete mutações com nome de RPC/permissão/payload/resultados; separação sales.delete; invalidação estoque; sem movimento manual; unknown/output incompleto incerto; SQLSTATE divergente incerto; validação/auth/identidade sem dispatch; snapshots físicos completos; leitores com erro/cursor; guarda síncrona por pedido, retry exato, armazenamento, restauração sem auto retry, bloqueio até versão, sessão expirada preservando incerteza. Testes comerciais existentes de centavos e CRUD continuam passando.

Mocks transpile/VM exercitam funções reais com dependências substituídas. **Não são testes PostgreSQL, HTTP autenticado real nem renderização browser.**

## 8. Limites e homologação obrigatória

Não executados: SQL/PostgreSQL, ACL/RLS reais, locks/concorrência entre sessões, comparação de catálogo remoto, replay com ledger real, browser/teclado/touch/leitor de tela ou gateway. Não se comprova atomicidade do instalador multipartes nem integridade global de cadeia pela UI.

Checklist antes de liberar:
1. Obter partes exatas aplicadas, ordem/correções/commits; confrontar corpos finais, assinaturas, ACLs, constraints e triggers offline. Não reaplicar para confirmar.
2. Em ambiente autorizado pelo responsável: autenticação real owner/admin/operator, sessão expirada, troca de empresa e IDs externos. Operator recebe mas não cancela/estorna.
3. Testar livre navegação comum e dez retrocessos com acentos/emoji/espaços; terminais somente por RPC específica.
4. Entrega untracked, reservada, múltiplos produtos e dois itens mesmo produto; financeiro pendente não bloqueia, ausência de novo receipt/refund automático.
5. Undo das duas classificações, D4 herdado, reconciliação, compensação única ao saldo corrente e cobertura preservada após nova entrega.
6. Alocação sequencial, saldo/plano insuficiente, cancelamento liberando só reservas ativas e reopen fixo preservando cobertura; downgrade histórico versus obrigação nova.
7. Recebimento/estorno integral e único, cancelado sem receber, total zero sem receipt fictício; cursor com empate de timestamp, contrapartida fora da página, alteração financeira concorrente com físico.
8. Perda de resposta/reload, retry exato de todos comandos após outros ciclos, replay sem regressão visual, duas abas e conflito de versão/idempotência. Nunca gerar UUID novo para resolver resultado incerto.
9. Drawer/dialogs: Tab/Shift+Tab, Escape, retorno de foco inclusive diálogos aninhados e erro, status announcements, lista móvel e DnD com scroll; menu sempre funcional sem arraste.
10. Confirmar atualização de colunas, busca/páginas/seleção preservadas, detalhes/físico/financeiro/inventário e ausência de N+1 físico. Medir refresh adicional.

Sem endpoint público de timeline operacional genérica: não se inventou histórico operacional com SELECT em tabelas protegidas. Histórico físico apresentado é snapshot/identificadores atuais, não extrato integral de todos ciclos. UI permanece BRL; outro currency é contrato incompatível explícito, não conversão silenciosa.
