# Modulus Hub — Refatoração visual 02: shell autenticado

## Escopo

Refatorados somente shell, navegação e composição compartilhada. Páginas de módulos, domínio, actions, backend, planos, RPCs, Supabase, migrations/RLS e integração Asaas não foram alterados nesta entrega. As alterações da entrega de autenticação e outros trabalhos já existentes foram preservadas.

O adendo sobre os bloqueios Visionário foi incorporado: **`PaidModuleGate.tsx`, `PaidModuleNotice.tsx` e `PlanAccessNotice.tsx` permanecem intactos**, assim como a mensagem “Disponível no Visionário”, explicações, estilos, botões e ações existentes.

## Referências inspecionadas

Em `design-references/stitch_modulus_3d_editor/`:

- `README.md`, incluindo adendo de identidade oficial (já relido integralmente na entrega anterior).
- `desktop_menu_aberto_1/screen.png` e `code.html`: sidebar clara, separadores, ativo lilás/azul e cabeçalho contextual.
- `desktop_menu_recolhido_1/screen.png` e `code.html`: versão compacta e controles de expansão.
- `celular_painel_de_navega_o_aberto/screen.png` e `code.html`: drawer lateral, backdrop, fechar e navegação rolável.
- `lumina_system/DESIGN.md`, já inspecionado: superfícies claras, hierarquia, espaçamento e raios discretos.

Guias locais do Next sobre layouts/componentes servidor-cliente/CSS, e nesta entrega linking/navigation, orientaram a integração. Não foram usados scripts/CDNs dos exports.

### Filtragem funcional

| Classificação | Elementos |
| --- | --- |
| Existentes | Rotas reais, logout, permissões, acesso à conta/plano, módulos pagos navegáveis, skip-link. |
| Adaptáveis | Sidebar branca, ativo lilás/azul, ícones, header contextual, recolhimento desktop e drawer mobile. |
| Futuros / sem suporte no shell | Busca global, notificações e seletor de empresa: não implementados. |
| Descartáveis | Usuário Rafael/empresa Oficina 3D de exemplo, iniciais fictícias, contadores, gráficos e ações ilustrativas. Não copiados. |

## Estrutura final da sidebar

Dez definições principais, nesta ordem e sem outros módulos independentes:

| Item | Rota real / comportamento |
| --- | --- |
| 1. Home | `/home` |
| 2. Precificadora | `/precificadora` |
| 3. Produtos | `/admin/products` |
| 4. Pedidos | `/admin/orders` |
| 5. Impressoras | `/impressoras` |
| 6. Materiais gerais | `/estoque/materiais-gerais` |
| 7. Carretéis | `/estoque/carreteis` |
| 8. Dados empresa | `/empresa` |
| 9. Equipe | `/empresa/equipe` |
| 10. Configurações | Botão expansível, não rota fictícia |

As capacidades do papel continuam filtrando itens sem permissão. Assim, owner tem os dez itens; admin não recebe Dados empresa nem Meu plano; operator também não recebe Equipe. Isso atende à proibição de expor ações administrativas indevidas, sem ocultar módulos por plano. Não há rotas ausentes entre os nove destinos principais.

### Configurações

Contém somente:

- **Meu plano** → `/meu-plano`, somente quando `enterprise.manage` permite a apresentação administrativa (owner no mapa atual).
- **Minha conta** → `/conta`.

Expande por botão com `aria-expanded`/`aria-controls`. Abre automaticamente ao entrar em conta/plano, permite fechar manualmente e marca corretamente o destino ativo. `/planos` pertence ao mesmo contexto, sem virar novo item principal. A sidebar recolhida mantém nomes acessíveis e títulos nativos dos controles; abrir Configurações em modo compacto expande o menu para facilitar leitura.

Logout permanece uma ação no rodapé, não item principal de navegação.

### Itens retirados e caminhos preservados

- Minha conta e Meu plano saíram do nível principal e foram para Configurações.
- Materiais (`/materiais`) saiu da sidebar: link contextual disponível no shell das páginas de Materiais gerais/Materiais.
- Produtos prontos (`/estoque/produtos`) saiu da sidebar: link contextual junto de Produtos, respeitando `inventory.read`.
- Alerta de estoque (`/estoque/carreteis/configuracao`) saiu da sidebar: link contextual junto de Carretéis, respeitando leitura. A edição continua exclusivamente autorizada no backend.
- Não há Dashboard duplicado, Inventário independente ou outros itens principais.
- Catálogos continuam com rotas existentes e navegação interna de Produtos; o shell reconhece esse contexto sem criar item extra.

Essa navegação contextual é parte do shell, não refatoração das páginas dos módulos. Mantém os destinos pagos reais e o mesmo comportamento dos gates. Não exclui ou redireciona rotas antigas.

## Header e marca

- Header comum em desktop/tablet/mobile com título do contexto, categoria, botão de menu em telas menores e acesso à conta. As páginas conservam seus próprios títulos e ações; o header não tenta reproduzir CTAs específicos de módulo.
- Logo oficial `public/logo_Horizontal.svg` no menu expandido/drawer; `public/logo.svg` (símbolo oficial já existente) no compacto. Inspecionados os assets disponíveis em `public/`, sem redesenhar/recolorir. `next/image`, proporções e respiro preservados.
- Azul `#2B00FF`, escuro `#152336`, lilás `#A6B4FF`, neutros claros; laranja reservado, sem decoração arbitrária.
- Space Grotesk da variável existente `--font-space-grotesk`; sem import/download extra ou alteração global.
- O contexto atual contém ID da empresa e papel, **não o nome empresarial**. Não foi criada query/RPC nem usado metadado não confiável para ornamentação. O shell aceita nome opcional para integração futura real, mas não apresenta nome fictício ou afirmação enganosa no estado atual.

## Integração e preservação de acesso

### Layout operacional

`app/(authenticated)/layout.tsx` permanece integralmente inalterado. Mantidos:

- Resolução de identidade, redirecionamentos de sessão/estados de empresa e `business_ready`.
- Resolução central de plano, seleção obrigatória e bloqueio de membros legados no Aprendiz.
- Cálculo das permissões existentes por `ROLE_PERMISSIONS`.
- Aviso do Aprendiz sobre operação somente pelo master e links de regularização.

Home, Produtos, Pedidos e Precificadora não receberam flag de exclusividade paga. Precificação manual/integrada, cotas e operações seguem seus contratos.

Impressoras, Materiais gerais e Carretéis continuam **visíveis no Aprendiz** para quem tem permissão de leitura. O ícone de cadeado informa a restrição, mas o link continua na rota real, com prefetch desativado quando bloqueado. Não há redirecionamento para checkout nem abertura de formulário por ação do shell. As páginas e actions existentes continuam autorizando antes dos loaders/ações.

### Planos e conta

- `app/(plans)/layout.tsx` reutiliza **somente o componente visual cliente** do shell após os mesmos guards de identidade. Não foi movido para o grupo operacional nem passou a exigir plano selecionado. Preserva seleção/remediação sem loops.
- `app/conta/page.tsx`: apenas ramo `business_ready` foi envolvido no shell visual, sem mudar conteúdo funcional. Ramos de identidade bloqueada/erro permanecem disponíveis como antes, fora do shell empresarial.
- `shellAccessForRole` apenas projeta o mapa de permissões existente para apresentação nesses dois contextos. Não consulta plano, inventa estado comercial ou substitui guardas. Neles não é exibida indicação de cadeado por plano não resolvido; clicar ainda chega aos gates reais.
- Meu plano continua na página M8 existente e mantém sua restrição de owner. Nenhum arquivo de billing foi modificado nesta entrega.

## Responsividade e acessibilidade

- Desktop (a partir de 1024 px): sidebar fixa de 264 px ou compacta de 88 px; workspace ajusta margem estruturalmente. Sem scale/zoom. Menu e rodapé têm fluxo independente e navegação rolável.
- Tablet/mobile (abaixo de 1024 px): sidebar fixa removida da composição e botão no header abre drawer nativo `<dialog>` via `showModal()`.
- Drawer com largura `min(88vw, 320px)`, altura dinâmica `100dvh`, backdrop e conteúdo rolável; não há limite rígido de altura que corte itens.
- Modal nativo proporciona Escape, contenção de foco e conteúdo externo inerte. Foco inicial no fechar, restauração ao botão de menu, fechamento ao navegar/mudar de rota, clique externo e mudança para desktop. Scroll do body bloqueado durante abertura e restaurado no fechamento/desmontagem.
- Controles de no mínimo 44 px, foco visível, labels acessíveis e `aria-current` para rota ativa. Skip-link e destino `main-content` mantidos.
- Header/links contextuais quebram linha; conteúdo com `min-width: 0`. Páginas antigas que ainda possuem tabelas largas ficam contidas por overflow local da área principal, sem exigir refatoração individual nesta entrega.
- Sem animações excessivas; transições desativadas com reduced motion.
- Preferência de recolhimento fica somente em memória durante a vida do shell. Não altera cookies, sessão ou storage.

## Arquivos desta entrega

Modificados:

- `app/(authenticated)/AuthenticatedShell.tsx`
- `app/(plans)/layout.tsx`
- `app/conta/page.tsx` (somente integração de apresentação do ramo empresarial pronto)

Criados:

- `components/layout/navigation.ts`
- `components/layout/access.ts`
- `components/layout/shell.module.css`
- `tests/global-navigation.test.cjs`
- `docs/UI_GLOBAL_LAYOUT_REFACTOR_REPORT.md`

Arquivos alterados anteriormente de autenticação, M8/Billing, referências e demais trabalhos locais não pertencem a esta entrega e não foram revertidos.

## Verificações locais

- `node --test tests/global-navigation.test.cjs tests/paid-module-gate.test.cjs tests/paid-action-errors.test.cjs tests/plan-capacity.test.cjs tests/products-access.test.cjs tests/pricing-access.test.cjs`: **34 testes aprovados, zero falhas**.
- Sete testes novos cobrem ordem/nomes/destinos, visibilidade paga no Aprendiz, permissões de apresentação, caminhos contextuais, correspondência de rota por segmento, contexto de Configurações e contratos estáticos do drawer. Testes estáticos não equivalem a interação real de browser.
- Suíte existente dos gates confirma que os loaders pagos não são executados no Aprendiz, que bloqueios técnicos/de papel não viram upsell e que as 15 páginas pagas continuam usando gate, incluindo detalhes/novos/configuração.
- `npx tsc --noEmit`: aprovado.
- ESLint direcionado ao shell, layouts modificados, novos helpers e teste: aprovado.
- `npm run build`: aprovado, Next 16.3.1. Advertência preexistente de depreciação de `middleware`, não alterado por estar fora do escopo. A configuração local é carregada automaticamente pelo build, sem exposição de credenciais pelo agente.
- `git diff --check`: aprovado; somente avisos do Git sobre conversão futura LF/CRLF.

## Pendências reais de homologação

Não há ferramenta de navegador disponível nesta execução; **não houve homologação visual real**. Verificar manualmente 320, 375, 430, 768, 1024 e 1440 px:

1. Header, navegação expandida/compacta, Configurações e estado ativo em conta/plano/subrotas.
2. Drawer com toque, Tab/Shift+Tab, Escape, clique externo, foco restaurado, scroll e mudança de orientação/breakpoint.
3. Todas as rotas com tabelas/formulários legados, zoom 200%, conteúdo longo e teclado virtual. O shell é adaptativo, mas não declara corrigidas as páginas individuais fora do escopo.
4. Owner Aprendiz: clique em Impressoras/Materiais gerais/Carretéis/inventário abre exatamente a apresentação existente “Disponível no Visionário”, sem loader operacional e sem checkout automático.
5. Visionário: mesmos links e operações autorizadas, sem alteração de telas dos módulos.
6. Admin/operator, capacidade de equipe, bloqueios de empresa/sessão e seleção/regularização de plano sem loops.
7. Billing M8 e retorno à conta preservados em ambiente autorizado.

Não foram instalados pacotes, executados SQL, consultas remotas Supabase, Docker/WSL, commits, pushes ou deploys.
