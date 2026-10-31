# Refatoração visual 12 — Planos

## Referência real inspecionada

A pasta foi adicionada pelo usuário antes da implementação:

- `sites/Modulus-Hub-Landing-Codigo/index.html`, seção `#planos` (linhas 63–67), comparação manual/integrada e FAQ.
- `sites/Modulus-Hub-Landing-Codigo/style.css`: tokens oficiais, `.pricing-head`, `.plan-grid`, `.plan-card`, `.featured`, hierarquia de preços e breakpoints.
- `sites/Modulus-Hub-Landing-Codigo/app.js`: interação demonstrativa dos botões de planos/diálogo, não contratação real.

Reutilização da linguagem visual, não dos scripts: eyebrow “Um plano para cada momento”, referência editorial a ritmo/próxima camada, bordas discretas, preço em destaque e Visionário destacado. A landing é HTML/CSS/JS independente, com scripts de demonstração e ações sem contratação. Importá-la para o App Router acoplaria scripts e regras fictícias ao Hub. Nenhum arquivo em `sites/` foi alterado.

## Inspeção funcional anterior às alterações

Foram inspecionados `/planos`, `FreePlanChoice`, layout `(plans)`, `/meu-plano`, `SubscriptionPanel`, `lib/plans.ts`, seleção inicial e ações/contratos/orquestração Asaas. O layout de planos continua sem guard operacional, permitindo seleção inicial e regularização. A autorização continua sendo do servidor, não da apresentação.

Inconsistências identificadas:

- O CTA anterior do Visionário dizia contratação indisponível, embora Meu Plano já contenha o fluxo real. A nova apresentação deve encaminhar o proprietário ao fluxo existente, não duplicar checkout.
- A descrição de pedidos indisponíveis estava desatualizada em relação ao contrato aprovado e às rotas existentes.
- O Magnata mostrava capacidades futuras como lista comparável; elas não devem ser anunciadas como recursos disponíveis.
- A escolha inicial do Aprendiz não é downgrade e deve permanecer restrita a proprietário com `selection_required`.
- Plano selecionado e plano efetivo diferem após expiração/cancelamento. O badge deve refletir acesso efetivo, sem chamar Visionário expirado de ativo.

## Contratos comerciais preservados

Fonte: `lib/plans.ts`; nenhuma capacidade, resolvedor ou preço foi modificado.

- Aprendiz: gratuito; 1 proprietário (owner); precificadora manual; até 3 produtos históricos e 3 pedidos históricos por empresa, totais e não mensais/simultâneos; sem impressoras/carretéis/materiais e inventário físico integrado.
- Visionário: R$ 39,90/mês, sem fidelidade; 1 proprietário + 1 operador; precificadora integrada; produtos/pedidos ilimitados sob regras atuais do lançamento; impressoras; **15 cadastros compartilhados** entre carretéis e materiais gerais; estoque de produtos prontos.
- Magnata: preço planejado de R$ 79,90/mês confirmado na constante, em breve, indisponível. Nenhum benefício futuro adicional anunciado.

## Organização e diferenças da landing

Categorias paralelas no Aprendiz e Visionário: Precificação; Produtos e pedidos; Produção e materiais; Estoque; Equipe e acesso. A mesma funcionalidade ocupa a mesma categoria em ambos. Magnata tem estado futuro informativo, não uma lista especulativa.

Não se copiam as setas, animações de tilt/reveal, modal demonstrativo, escalas de fonte minúsculas, futuros relatórios/clientes/insights ou promessas de materiais ilimitados. Os limites históricos e a quota compartilhada são mais explícitos no Hub. A comparação fica nos próprios cards, sem tabela redundante ou conteúdo essencial oculto por hover/expansão.

## Fluxos mantidos

- Identidade e plano são consultados no servidor; falhas usam `planAccessNotice`, sem inventar plano gratuito.
- Aprendiz somente pela action existente de seleção inicial, com selected/no_change/conflict/error/uncertain, refresh em conflito e links de recuperação/retorno.
- Visionário encaminha o proprietário para `/meu-plano`, onde já existem contratação, recuperação de checkout, Pix, verificação e cancelamento. Não há nova state machine nem formulário de cobrança duplicado em `/planos`.
- Usuários não proprietários não recebem ações de contratação/administração da assinatura.
- Assinatura já paga não é apresentada como nova contratação.
- Nenhuma assinatura é criada ao renderizar `/planos`.
- Cartão: recorrência em checkout hospedado. Pix: faturas mensais pagas manualmente, não Pix Automático. Acesso depende de confirmação autoritativa, nunca de simples retorno do checkout.
- Webhooks, reconciliação, ciclos, cancelamento, renovação, persistência, onboarding e autorização não foram alterados.

## Arquivos desta entrega

- `app/(plans)/planos/page.tsx`
- `app/(plans)/planos/Plans.module.css` (novo)
- `app/(plans)/planos/FreePlanChoice.tsx`
- `tests/plans-presentation.test.cjs` (novo)
- `tests/plans-billing-presentation.test.cjs` (novo)
- Este relatório.

Há trabalho anterior extenso no workspace, inclusive SQL e outras telas; não faz parte desta entrega.

## Responsividade e acessibilidade

Cards em três colunas a partir de 960px de largura útil do conteúdo (container query, considerando a sidebar), empilhados abaixo disso, sem zoom CSS. No desktop as categorias possuem mínimos de altura alinhados, mas podem crescer para não recortar texto com fontes maiores. Categorias e ações têm posições consistentes, botões têm altura mínima de toque, texto não depende de hover. Headings semânticos, badges textuais (não apenas cor), foco visível, disabled nativo e anúncios de erro/status.

## Validações e revisão independente

- Regressões existentes de capacidades, gates pagos, erros de ações, navegação, Asaas, orquestração e calendário: **75/75 aprovadas**.
- Checkout/cancelamento, reconciliação, scan e compatibilidade dos contratos SQL (apenas análise de texto): **25/25 aprovadas**.
- Novas regressões de apresentação/seleção inicial: **57/57 aprovadas**. Novas regressões do painel existente, links Asaas, estados checkout, gates de Meu Plano e layout: **32/32 aprovadas**. Total direcionado incluindo suites anteriores: **189 testes aprovados**.
- Onboarding: verificações explicitamente identificadas como SOURCE CONTRACT preservam completion → `/home` → guard operacional → `/planos`; não representam E2E de provisionamento.
- Suíte completa `node --test tests/*.test.cjs`: **574 testes, 573 aprovados, 1 falha preexistente** em `tests/company-sql.test.cjs` (“rate-only retains the exact current identity/locking/authorization sequence”). O teste compara a forma antiga `NOT private.can_access_enterprise(...)` com a migration local que já usa `IS DISTINCT FROM TRUE`. Nem SQL nem esse teste foram alterados nesta entrega; a divergência não foi ocultada.
- `npx tsc --noEmit`: aprovado.
- ESLint direcionado a página, escolha gratuita e ambos os testes novos: aprovado.
- `npm run build`: aprovado. Aviso preexistente de depreciação de `middleware` para `proxy`, sem alteração fora do escopo.
- `git diff --check`: aprovado; apenas avisos de normalização LF/CRLF no workspace.
- Chrome nativo local: **36 combinações aprovadas**, nos estados owner-selection, owner-free, owner-paid, expired, nonowner e missing-access, em **320/375/430/768/1024/1440 px**. Nenhum overflow de documento, limites de elementos ou conteúdo interno. Botão de escolha gratuita com altura de 48px. Screenshots mobile e desktop inspecionados.
- Evidência de navegador é **SSR isolado** da página e componente reais com CSS real, mocks de identidade/plano/actions, fonte Arial fallback e aproximação conservadora do shell (sidebar 264px). Não é sessão autenticada hidratada. Scripts e screenshots em `C:/Users/Pichau/AppData/Local/Temp/opencode/plans-native-smoke/` e harness `plans-native-smoke.cjs`.

## Segunda revisão independente e correções finais

Revisor independente verificou contratos, estados efetivos, restrições owner, fluxo real, identidade e responsividade e executou **89/89 testes**, sem bloqueadores. Como reforço aos pontos sugeridos:

- O breakpoint foi ajustado para 960px úteis para permitir três cards em 1440px com sidebar expandida.
- As linhas desktop usam `minmax(..., auto)` em vez de alturas rígidas, permitindo crescimento com texto ampliado.
- Foram adicionadas asserções explícitas para histórico total/não mensal/não simultâneo e igualdade das cinco categorias entre Aprendiz e Visionário.
- A escolha gratuita foi integrada ao mesmo CSS local dos cards, com botão de 48px e foco consistente, mantendo a action e seus resultados intactos.
- Removida a repetição de “em breve” no título do Magnata; o estado continua explícito no CTA e no texto.
- A validação de navegador foi repetida após as mudanças de CSS.

## Pendências de homologação

Testes locais com dependências controladas não comprovam pagamento real, implantação de RPCs, configuração Asaas ou concorrência de produção. Não houve SQL executado, Supabase remoto, instalação, Docker/WSL, commit, push ou deploy.

A página Meu Plano já possui limitações anteriores: outcomes `?billing=...` não são apresentados individualmente e os rótulos do estado de cobrança diferem do estado efetivo do acesso. Seu painel autoritativo e recuperação permanecem existentes e inalterados; essa refatoração não redesenha a state machine de billing. Homologação autenticada e financeira real permanece necessária.
