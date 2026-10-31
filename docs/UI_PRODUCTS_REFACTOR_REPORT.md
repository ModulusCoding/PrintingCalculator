# Refatoração Visual 05 — Produtos

Data: 28/10/2026. Relatório em consolidação durante a implementação.

## Inspeção anterior à implementação

Rotas reais: `/admin/products`, `/admin/products/new`, `/admin/products/[id]`; detalhe/edição compartilham a mesma rota. Inventário: `/estoque/produtos` e `/estoque/produtos/[id]`. Foram inspecionados componentes, ações de Produtos/imagens, schemas, acesso, capacidade, inventário, contratos de pedidos e integração com aplicação de preço. Precificadora fora do escopo: nenhum arquivo dela será alterado nesta entrega.

### Matriz integral dos campos reais

| Campo | Tipo/unidade | Obrigatório | Limites / precisão | Entrada e payload | Dependência / origem |
|---|---|---|---|---|---|
| Nome | texto | sim | trim, 2..255 caracteres | string; servidor apara | `lib/products/actions.ts` inputSchema |
| Descrição | texto | não | até 3000 antes de trim | string ou null; branco vira null | inputSchema/validate |
| Preço atual | monetário BRL | não | 0..1.000.000; até 2 casas | texto pt-BR; vazio representa sob consulta/null; action normaliza decimal string, não float autoritativo | parsePrice; numeric(10,2) |
| ID | UUID | operações existentes | UUID | argumento não editável | action/RPC |
| Versão | inteiro seguro não negativo | edição/status/exclusão | MAX_SAFE_INTEGER | argumento do produto carregado | optimistic locking action/RPC |
| Attempt criação/exclusão | UUID | tentativa | UUID | gerado/capturado; repetição idempotente | actions/RPC |
| Status | booleano | existente | ativo/arquivado | action separada, nunca campo cadastral livre | products.delete |
| Imagem | File | não | JPEG/PNG/WebP, 32 bytes..5 MiB, 4 milhões de pixels; até 3 imagens | FormData.file; normalização servidor WebP até 2000×2000 | image-actions/process |
| Ordem da imagem | inteiro | por imagem | 1..3 | RPC própria + versão | image-actions |
| Busca catálogo | texto | não | trim e até 200 | search GET, escape literal no servidor | listInternalProducts |
| Filtro status | enum | default ativo | active/archived/all | status GET | listInternalProducts |
| Página catálogo | inteiro | default 1 | 1..10000, ajustada ao total; 20 registros/página | page GET | listInternalProducts |
| Busca inventário | texto | não | até 120 | search GET | inventory route/actions |
| Filtro saldo | enum | default all | all/with_balance/without_balance | balanceFilter GET | inventory |
| Filtro situação | enum | default active | active/archived/all | productStatus GET | inventory |
| Movimento | enum | sim | entry/exit/adjustment | movementType | inventory validation |
| Quantidade entrada/saída | inteiro unidades | condicional | 1..1.000.000.000 | string inteira canônica quantity | inventory validation |
| Saldo contado ajuste | inteiro unidades | condicional | 0..1.000.000.000 | string inteira canônica countedBalance | inventory validation |
| Motivo movimento | texto | sim | trim 1..500 | reason | inventory validation |
| Versão estoque/tentativa | inteiro seguro/UUID | sim | contratos existentes | expectedVersion/attemptId | inventory |

Preço aceita `R$ 12,50`, `0`, `0,01`, `1000`, `1.000,50`; rejeita ponto decimal (`1.5`), negativos, letras, escala >2 e agrupamento malformado. Entrada vazia é **ausência de preço**, não zero. Não existem campos cadastrais de quantidade, SKU, categoria, material, tempo de impressão, custo ou lucro no CRUD autenticado. Não serão inventados.

## Referências Stitch e classificação

Base: `design-references/stitch_modulus_3d_editor/`, com HTML e screenshots de `celular_listagem_de_produtos_1`, `_2`, `novo_produto_mobile_modulus_hub`, `editar_produto_mobile_modulus_hub`, `detalhe_do_produto_mobile_modulus_hub`, `produto_arquivado_mobile_modulus_hub`, `estoque_de_produtos_prontos_modulus_hub` e `detalhe_do_estoque_vaso_voronoi_18cm_modulus_hub`; README e DESIGN inspecionados.

- Existentes: nome, preço/sob consulta, descrição, imagens, status, busca/filtros/paginação, CRUD/status conforme permissões, saldo/movimentos/histórico.
- Adaptáveis: cards mobile/tabela desktop, superfícies claras, badges, galeria e ações largas.
- Futuros/não expostos: reservado/disponível na leitura de inventário, produção e filtros avançados. Não criar contrato para reproduzir o desenho.
- Descartados: SKU, categorias, filamento/tempo, margens, contagens e KPIs fixos, exportação/bulk, fila/progresso de upload simulados, CDN e imagens externas. Fotos continuam depois de salvar, até 3 de 5 MiB, não 4 de 10 MB.

## Contratos preservados e divergências descobertas

- Empresa deriva da autenticação; filtros por tenant/deleted_at, RLS e RPCs permanecem intactos.
- Owner/admin podem escrever/excluir conforme gates; operador escreve mas não exclui. Arquivamento/restauração exigem products.delete.
- Ordenação existente: created_at DESC, id DESC; paginação servidor de 20. Não carregar catálogo inteiro no cliente.
- Preço sugerido não é campo do CRUD atual; salvar/aplicar preços continua nas ações/telas de histórico existentes. Não recalcular preço no cadastro.
- Inventário pago continua protegido pelo gate central e apresentação aprovada “Disponível no Visionário”. Saldo exposto é físico; reservado/disponível não são fornecidos no contrato de leitura. Não derivar disponível sem reserva.
- Guards de banco impedem consumo reservado, arquivar com reserva e excluir com reserva/saldo/upload pendente. Nenhum guard será removido.
- **Divergência importante de plano:** requisito descreve três produtos históricos; código local atual conta três **não excluídos**, incluindo arquivados, e soft-delete libera capacidade. Janela Free lê os três mais recentes não excluídos. Não é correto afirmar que o backend impede recriação após exclusão. Resolver isso exige decisão de contrato/planos/RPC, fora da refatoração visual. Implementação preserva o resolvedor central, não cria contador paralelo. Confirmação de exclusão deixará de prometer liberação de cota.
- Erros de reserva/saldo/upload em ações de Produto podem aparecer como técnicos; histórico de estoque pode ocultar erros de leitura. Documentar, não refatorar contratos backend silenciosamente.

## Arquivos e composição final

- `app/(authenticated)/admin/products/page.tsx`: tabela desktop/cards mobile, filtros rotulados, contagem real, estados vazio/erro, paginação acessível e ações preservadas.
- `app/(authenticated)/admin/products/new/page.tsx` e `[id]/page.tsx`: cabeçalhos/breadcrumbs, largura ampla, situação do produto e retorno.
- `app/(authenticated)/admin/products/loading.tsx`: estado de carregamento acessível, sem animação necessária.
- `components/admin/ProductForm.tsx`: principal/contexto lateral, validação antes de enviar, campos de consulta read-only, rascunho preservado, erros associados/foco, recuperação idempotente da criação incerta.
- `components/admin/ProductImageManager.tsx`: cards da galeria, controles de toque, status e proteção após operação incerta; imagens continuam operações separadas.
- `components/admin/ProductArchiveButton.tsx` e `ProductDeleteButton.tsx`: acabamento, captura de transporte, recuperação de versão; confirmação de exclusão sem promessa falsa de capacidade.
- `app/(authenticated)/estoque/produtos/page.tsx`, `[id]/page.tsx`, `components/inventory/ProductInventoryTable.tsx`, `ProductInventoryFilters.tsx`, `MovementForm.tsx`: visual do estoque associado; cards mobile, tabela desktop, todos os dados do histórico presentes, saldo rotulado como físico, controles 44px, gates e validação originais.
- `tests/products-ui.test.cjs`: regressões locais de formulário/listagem/inventário/recuperação.

Nenhuma alteração em ações, RPCs, schemas, resolvedor de planos, auth/RLS, armazenamento, pedidos, reservas, billing, layout global ou arquivos da Precificadora. As alterações anteriores do workspace foram preservadas.

## Revisão final independente e correções

Uma segunda revisão independente examinou os arquivos modificados, campos, parser, retry, imagens/versões, permissões, estilos e paginação. Encontrou:

1. Galeria podia continuar bloqueada após refresh com a mesma versão e sem imagens. Corrigido com identificador de releitura emitido no servidor, usado somente na chave da galeria; o formulário não é remontado e mantém rascunho. Uma releitura com erro continua bloqueando operações.
2. Exclusão mantinha versão antiga após conflito/refresh. Agora captura tentativa ao iniciar; conflito definitivo limpa a captura e atualiza a rota, enquanto resultado incerto mantém a tentativa/versão no retry.
3. Links de paginação do estoque tinham aria-disabled mas ainda respondiam ao teclado. Limites agora são spans sem link nas duas páginas.

Também corrigidos após inspeção: payload de criação congelado após invalid_input (edição é liberada), captura de falhas de transporte, nomenclatura de saldo físico, sem falsa disponibilidade, tabela de estoque com largura controlada/quebra para nomes longos e whitespace apontado por diff check. Transições novas respeitam reduced motion. Testes afetados repetidos.

## Verificações executadas

- **108 testes aprovados, zero falhas**, sendo 14 novos casos no arquivo de Produtos.
- Comando: `node --test --test-reporter=tap tests/products-ui.test.cjs tests/products-access.test.cjs tests/plan-capacity.test.cjs tests/paid-module-gate.test.cjs tests/paid-action-errors.test.cjs lib/orders/write.test.cjs lib/orders/operations.test.cjs tests/manual-pricing-persistence.test.cjs tests/apply-pricing-price-migration.test.cjs tests/pricing-actor-authorization.test.cjs`.
- Cobertura nova: tabela/cards, filtros/paginação/retornos, controles por permissão, capacidade/erros, preço nulo/zero/limites/colagem malformada, correção de validação local e servidor, foco/aria, rascunho, criação incerta/retry, consulta/arquivado, exclusão com conflito versus resultado incerto, chave da galeria e validação de unidades/movimentos/guards estáticos de reservas.
- Suítes existentes: acesso Produtos, capacidade/planos, gates pagos, pedidos/escrita/operações/reservas, persistência e aplicação de preços/atores.
- `npx tsc --noEmit`: aprovado.
- ESLint direcionado a todos os TSX alterados e novo teste: aprovado.
- `npm run build`: aprovado; depreciação preexistente middleware/proxy não modificada.
- `git diff --check`: whitespace corrigido e comando repetido; avisos de LF/CRLF podem aparecer no Windows.

Testes executam módulos TS/TSX/schemas reais com fronteiras de framework, hooks/browser e banco mockadas. Inspeções dos guards SQL são estáticas. **Não foi executado PostgreSQL, RLS real, armazenamento remoto, navegador nem rede real.** Não são provas de implantação ou integração transacional. O teste da chave da galeria não equivale a testar um refresh real do Next no navegador.

## Riscos e pendências

- Divergência da cota histórica solicitada versus cota não excluída implementada exige decisão/autorização separada. Não resolvida por CSS nem por contador frontend.
- Reservado/disponível ausentes no read model: UI mostra somente físico e explica a limitação. Não afirmar atendimento completo dessas grandezas.
- Actions de Produtos ainda podem converter bloqueios específicos de reservas/saldo/upload em falha técnica; guards permanecem, mas feedback de negócio precisa de revisão backend aprovada.
- Leitura do histórico de inventário pode tratar erro/parse como vazio; parser admite entry/exit/adjustment e precisa ser homologado após entrega/desfazimento de pedido. Não alterado silenciosamente nesta entrega.
- Concorrência de edição, uploads e pedidos, imagens com URLs expiradas e recuperação após commit perdido requerem homologação real.
- Sem ferramenta de navegador disponível e sem instalação de dependências: responsividade inferida de estilos, não medida.

### Checklist manual — todos pendentes

| Largura | Listagem / formulário / inventário | Overflow / foco / toque |
|---|---|---|
| 320px | pendente | pendente |
| 375px | pendente | pendente |
| 430px | pendente | pendente |
| 768px | pendente | pendente |
| 1024px | pendente | pendente |
| 1440px | pendente | pendente |

- [ ] Poucos/muitos produtos; nomes longos; pesquisa literal; filtros; páginas; erro e vazio.
- [ ] Criar/editar, preço sob consulta/zero/BRL colado, correção sem perda, teclado móvel/composição/backspace.
- [ ] Galeria upload/ordem/remoção/erro/refresh com e sem imagens, preservando rascunho.
- [ ] Owner/admin/operator; Aprendiz com limite atingido, arquivados, excluídos e downgrade; Visionário e equipe irregular.
- [ ] Confirmação/erro de arquivamento/exclusão com saldo/reserva/upload pendente.
- [ ] Entrada/saída/ajuste e histórico; reservas, entrega e desfazimento de pedido; sem saldo negativo.
- [ ] Aplicação de preço existente e conflito de versão, sem cálculo frontend ou alteração dos snapshots.
- [ ] Tab/Enter, leitor de tela, zoom/contraste, erro/foco, controles 44px e reduced motion.

Não houve SQL, Supabase remoto, instalação, Docker/WSL, commit, push ou deploy. Implementação visual e verificações locais entregues; homologação visual e operacional real continua pendente.
