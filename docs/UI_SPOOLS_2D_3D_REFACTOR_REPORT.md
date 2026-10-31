# Carretéis — separação 2D / 3D

## Decisão e referências

Referências localizadas sob `design-references/`: `stitch_modulus_3d_editor/carret_is_modulus_hub/{code.html,screen.png}`, `modulus_carretel_3d_demo.html` e README.md. O HTML completo do proprietário foi analisado na integração anterior e revisado nesta mudança: WebGL 2 nativo, flanges com sete raios, cubo e aros; filamento em camadas, raio baseado em área anular, luz direcional e matrizes de perspectiva/rotação. Não há texturas/modelos externos associados. Slider de saldo, 720 g iniciais, capacidade fixa de 1 kg, limite 20% e oscilação contínua são demonstração, não funcionalidades do Hub.

Stitch orienta grid, hierarquia, filtros e superfícies. SVG anterior orienta apresentação resumida. Contratos atuais prevalecem sobre ambos.

## Arquitetura implementada

- `SpoolLevel2D.tsx`: entrada explícita para SVG, reutilizando `SpoolLevel.tsx` e sua transição CSS. Nenhum canvas, import de 3D, shader ou buffer.
- Listagem e prévias do seletor de cor usam exclusivamente SpoolLevel2D. Cor do filamento permanece mesmo em alerta; status/dot de alerta são separados. Contorno neutro mantém branco visível.
- `SpoolDetail3D.tsx`: boundary client com next/dynamic, ssr:false. Importa o componente e motor somente na rota autorizada de detalhe. Guia local Next de lazy-loading consultado: ssr:false não é suportado diretamente em Server Component.
- `Spool3D.tsx`: somente cena interativa de detalhe, sem modo snapshot/card, observador de visibilidade ou contexto compartilhado. Dono ativo em escopo de módulo descarta a cena anterior antes de criar outra, inclusive em sobreposição de árvores durante navegação.
- `spool-webgl.ts`: removidas as APIs e infraestrutura de previews compartilhados; mantém geometria fixa, uniforms para raio/material, frames sob demanda, tween de 500 ms, preferência de movimento reduzido, resize e DPR até 1,5.

### Detalhes como página responsiva

Mantida a rota existente `/estoque/carreteis/[id]`, em vez de introduzir drawer/intercepting routes e duplicar carregamento de histórico/ações. É a alternativa de página responsiva autorizada: painel amplo no desktop e coluna única no mobile, com modelo como destaque. Só essa rota monta 3D. Links Detalhes têm prefetch=false para não antecipar bundle do detalhe ao mostrar a lista. Fechar detalhes retorna à busca/filtro/página sanitizados e fragmento do card; `SpoolListFocus` restaura foco no link correspondente, sem localStorage/sessionStorage. Não existe modal que exija focus trap.

### Recursos e falhas

Desmontagem encerra frames, listeners pointer/media/resize, ResizeObserver, buffers, shaders, programa e contexto. Perda de contexto dispara fallback textual. Rotação mouse e toque horizontal com touch-action:pan-y; rolagem vertical preservada. Botões de giro acessíveis por teclado. Sem loop ocioso ou giro infinito. Atualização de HEX muda uniform somente, não cria malha/cena nova. Saldo muda raio físico do filamento, não apenas número. Estrutura mantém cor própria.

## Auditoria funcional

Inspecionados rotas list/new/detail/config, SpoolForms, SpoolColorField, actions, validation, schemas, navegação, capacidade e permissões. Mantidos busca/status/página e paginação real 20 itens. Não foram adicionados filtros ilustrativos nem ordenação sem contrato.

- Saldo: `current_balance_grams`, gramas líquidas de filamento.
- Referência: `original_filament_grams`, peso original líquido imutável, não tara/peso bruto nem capacidade presumida.
- Percentual: saldo / referência × 100. Só desenho limitado a 100%; peso verdadeiro preservado. Dados inválidos não viram zero; referência inválida torna percentual indeterminado.
- Baixo: percentual real <= `low_spool_threshold_percent`, saldo positivo. Esgotado separado; falha de config não inventa limite.
- Original/quantidade positivos 0,001–100000 g, até três casas; saldo 0–original; preço 0–1000000 BRL, até duas casas. Vírgula/ponto decimal, sem agrupamento/expoente/sinal negativo. Validação local reutiliza schemas reais e preserva entradas para correção.
- Cadastro: identificação/tipo obrigatórios, marca/cor opcionais; peso original, saldo inicial e preço reais. Perfil não altera preço/peso original. Movimentos consumption/replenishment/adjustment preservados, inclusive counted_balance_grams=0.
- Confirmações, versão otimista e congelamento de payload/UUID após resultado incerto preservados. Não há operações de estoque nos indicadores.

## Cor

Campo `color` existente aceita texto até80 e HEX; nenhuma coluna nova. Picker e input textual sincronizados, #RGB expandido para #RRGGBB e maiúsculas. Rascunhos inválidos ficam editáveis com erro e última prévia válida; não são enviados pelos formulários. Nomes legados/vazio permanecem suportados, sem substituir silenciosamente pela cor ilustrativa. Edição carrega salvo; mesmo campo alimenta SVG e 3D. Persistência usa createSpool/updateSpoolProfile e p_color existentes, não armazenamento do navegador. Backend mantém contrato textual legado, não foi transformado em HEX-only.

HEX é aproximação iluminada: sem transparência, fluorescência ou metal inventados. Branco tem contorno no SVG; preto possui realce neutro no shader.

## Plano, permissões e integrações

PaidModuleNotice, sidebar e renderPaidModule intactos. Aprendiz continua “Disponível no Visionário”, sem operações físicas. Visionário usa limite compartilhado central15 (não excluídos de Materiais Gerais + Carretéis, incluindo vazios/arquivados). Owner/admin/operator e permissões existentes mantidos, owner para threshold. Autoridade servidor/RPC preservada, sem autorização paralela. Precificadora, custo por grama (compra/peso original), snapshots históricos, ledger, Home e isolamento empresarial não alterados.

## Verificações / revisão final

Segunda revisão: removidas APIs de snapshots, owners de preview e renderização de cards do motor; removidos imports de Spool3D dos formulários/lista. Links sem prefetch evitam carregamento antecipado. Ownership defensivo impede dois renderizadores vivos durante troca de detalhes. SVG preserva HEX em baixo/esgotado, contorno torna branco visível e amostra mantém cor consultável mesmo com arco vazio. Retorno usa fragmento validado por padrão UUID para foco, sem mudar o sanitizador de returnTo. Layout de detalhes existente foi mantido para evitar duplicar contratos/histórico em drawer.

### Navegador real, escopo isolado

Chrome headless/SwiftShader executou fonte atual do motor (sem API snapshot): níveis0/25/50/100/null, cinco cores, rotação programática, descarte e fallback sem WebGL. Sem erros JS; gl.getError=0. Null e vazio coincidiram, quantidade/cor/rotação alteraram pixels. SVG real renderizado com React e CSS de produção em harness isolado: sem overflow horizontal nos seis viewports320/375/430/768/1024/1440. Screenshots em `C:\\Users\\Pichau\\AppData\\Local\\Temp\\opencode\\spool-native-smoke`, imagem320 aberta e inspecionada. Esse harness não é a tela autenticada nem comprova gestos físicos, hidratação, foco real de navegação ou layout completo do Hub.

### Verificações automatizadas

Suite final com `node --test` dos arquivos spool-3d, spool-webgl, spool-color, spool-level, spools-forms, spools-ui-validation, spool-list-focus, shared-material-creation-pages, plan-capacity, paid-module-gate, paid-action-errors, home-dashboard, pricing-actor-authorization, pricing-ui e pricing-wizard: **164 testes passaram, zero falhas**. Inclui grafo recursivo dos imports da lista/form (não alcança WebGL), lazy boundary, propriedade única de renderer, troca/desmontagem, recursos parcialmente inicializados, preferência de movimento, HEX e persistência em RPC local simulado, foco e regressões de acesso/capacidade.

- `npx tsc --noEmit`: passou.
- `npm run build`: passou, somente aviso preexistente de middleware depreciado.
- ESLint direcionado: passou sem warnings, incluindo fontes e testes após alterações finais.
- `git diff --check`: passou, somente avisos LF/CRLF existentes no workspace.

Testes com mocks não comprovam banco remoto/RLS real. Nenhum SQL, Supabase remoto, nova dependência, Docker/WSL, commit/push/deploy.

## Pendências

Homologar aplicação autenticada nos seis viewports, navegação/foco com dados reais, toque físico e persistência backend real. Não confundir harness gráfico isolado com homologação completa. Limitações preexistentes de leitura de deleted_at e possível gate da RPC direta de threshold permanecem registradas no relatório anterior; não foram alteradas regras de negócio.
