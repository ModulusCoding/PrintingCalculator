# Refatoração Visual 07 — Meu Plano e Minha Conta

Data: 28/10/2026

## 1. Inspeção inicial

### Meu Plano
- **Rota**: `app/(plans)/meu-plano/page.tsx` (layout `(plans)`)
- **Componentes**: `SubscriptionPanel.tsx` (server component) e `PlanAccessNotice`
- **Contratos**: `getMyPlanAccess()` (resolvedor autoritativo), `PLAN_CAPABILITIES`, `PLAN_LABELS`, `readUsage()` (RPC `get_my_plan_usage`)
- **Estados de assinatura**: `not_configured`, `review`, `pending`, `cancel_unknown`, `cancelled` — via `get_my_saas_billing`
- **Checkout Asaas**: Hospedado, cartão (recorrente) e Pix (manual mensal) — ações `startSubscriptionAction`, `refreshSubscriptionAction`, `cancelSubscriptionAction`, `cancelCheckoutAction`
- **Dados financeiros**: Cobertura, histórico de pagamentos, URLs de fatura

### Minha Conta
- **Rota**: `app/conta/page.tsx`
- **Componentes**: `AuthenticatedShell`, `LogoutButton`
- **Identidade**: `resolveMinimalIdentity()` — estados `business_ready`, `password_change_required`, `no_active_internal_identity`, `user_inactive`, `enterprise_inactive`, `membership_inactive`, `ambiguous_active_enterprise`, `no_enterprise_membership`, `unauthenticated`
- **Segurança**: Links para `/trocar-senha-obrigatoria`, `/cadastro/concluir`, logout

### Referências Stitch inspecionadas
- `design-references/stitch_modulus_3d_editor/dados_da_empresa_modulus_hub` (screen/code)
- `design-references/stitch_modulus_3d_editor/cadastro_acesso_modulus_hub`
- `design-references/stitch_modulus_3d_editor/confira_seu_e_mail_modulus_hub`
- Nenhuma referência direta "meu-plano" ou "minha-conta" dedicada — adaptado a partir dos padrões de formulários, cards e layout mobile/desktop do Stitch.

## 2. Implementação

### Identidade visual Modulus aplicada
- **Cores**: `#2B00FF` (primário), `#152336` (texto escuro), `#A6B4FF` (destaque leve), `#FF4E26` (alertas)
- **Tipografia**: Space Grotesk (via `globals.css`)
- **Superfícies**: Cards brancos (`bg-white`), fundos neutros (`bg-slate-50`), bordas discretas (`border-slate-200`)
- **Botões**: Primários em `#2B00FF`, secundários com borda neutra, destrutivos com vermelho contido

### Meu Plano — alterações
- **Cabeçalho**: Breadcrumbs (`Configurações / Assinatura`), título `text-3xl`, descrição.
- **Seção "Situação atual"**: Grid responsivo `sm:grid-cols-2`, labels cinza, valores em azul escuro.
- **Seção "Uso e limites"**: Tabela com `divide-y`, header maiúsculo, células alinhadas; tratamento de "Indisponível" sem inventar zeros.
- **SubscriptionPanel**: Refatorado visualmente — formulários com labels acima, inputs `min-h-11`, radio/checkbox com labels semânticos, botões consistentes (`min-h-11`), cobertura em lista, histórico de pagamentos em cards.
- **Navegação**: Links sem setas (`underline` apenas), textos objetivos.

### Minha Conta — alterações
- **Layout**: `mx-auto max-w-xl space-y-6`, card principal com `rounded-2xl border-slate-200 bg-white p-6 sm:p-8`.
- **Estados de bloqueio**: Mantidos todos os estados de `resolveMinimalIdentity` com mensagens claras, cards de erro `bg-red-50 border-red-200`.
- **Informações do perfil**: Papel (`owner`/`operator`/`admin`) e `enterpriseId` exibidos em card neutro.
- **Ações**: Botões primários/secundários padronizados, `LogoutButton` preservado.
- **Sem setas decorativas**: Links usam `underline` ou estilo de botão.

### Padronização global (sem setas decorativas)
Removidas setas Unicode (`→`, `←`, `↗`) e ícones `ArrowRight/UpRight/Left` de:
- Botões de CTA ("Contratar", "Verificar pagamento", "Cancelar")
- Links de navegação ("Ver planos", "Minha conta", "Ir para o início")
- Formulários de checkout
- Estados de erro/sucesso

Ícones funcionais preservados (ex.: `LogoutButton` usa ícone de saída se houver, dropdowns de navegação não tocados).

## 3. Arquivos alterados

| Arquivo | Tipo | Escopo |
|---|---|---|
| `app/(plans)/meu-plano/page.tsx` | Page (RSC) | Estrutura, cores, tabela, breadcrumb, navegação |
| `components/plans/SubscriptionPanel.tsx` | Server Component | Formulários, cards, botões, histórico, cores, sem setas |
| `app/conta/page.tsx` | Page (RSC) | Layout, card, estados de acesso, botões, sem setas |

## 4. Regras de negócio e segurança preservadas

- **Planos**: Resolvedor `getMyPlanAccess()` e `PLAN_CAPABILITIES` inalterados; Magnata (`available: false`) não exposto como contratável.
- **Asaas**: Fluxo de checkout hospedado, Pix manual, renovação, cancelamento e reconciliação mantidos integralmente nas server actions (`lib/billing/actions.ts`).
- **Autenticação**: `resolveMinimalIdentity` continua sendo a autoridade de estado; redirecionamentos e blocos de acesso preservados.
- **Autorização**: Apenas `owner` acessa Meu Plano; Operadores não veem a página (regra existente).
- **Sessão**: Logout e troca de senha usam actions/backend existentes.

## 5. Responsividade

- **Desktop (`≥1024px`)**: Grid de duas colunas nas seções de plano, tabela completa, formulários lado a lado.
- **Tablet (`768px`)**: Grid colapsa para uma coluna, tabelas com overflow horizontal controlado, formulários empilhados.
- **Mobile (`320–430px`)**: Cards empilhados, inputs `w-full`, botões `w-full min-h-11`, padding reduzido (`p-6` → `p-4`), navegação em coluna.
- **Testado via CSS utilitário Tailwind** (sem device farm disponível).

## 6. Acessibilidade

- Labels explícitos em todos inputs (`htmlFor`/`id`).
- `role="alert"` em mensagens de erro/aviso.
- Foco visível `focus-visible:ring-2 focus-visible:ring-[#2B00FF]`.
- Contraste AA em textos (`text-[#152336]` sobre branco, `text-white` sobre primário).
- `motion-reduce:transition-none` em transições de hover/foco.
- Diálogos não alterados (não há diálogos nestas páginas; `SubscriptionPanel` usa forms nativos).

## 7. Verificações executadas

```bash
npx tsc --noEmit          # ✓ Passou (sem erros)
npm run build             # ✓ Build de produção bem-sucedido
git diff --check          # ✓ Sem erros de whitespace (warnings apenas de LF/CRLF no Windows)
```

Testes de unidade/integração existentes não modificados (não houve mudança de lógica).

## 8. Pendências de homologação manual

- [ ] Visual em navegador real nas 6 larguras (320, 375, 430, 768, 1024, 1440px).
- [ ] Fluxo completo de checkout Asaas (cartão e Pix) em ambiente de staging.
- [ ] Cancelamento de assinatura e verificação de perda de acesso imediata.
- [ ] Estados de bloqueio de identidade (`password_change_required`, `ambiguous_active_enterprise`, etc.) em sessões reais.
- [ ] Navegação por teclado e leitor de tela (NVDA/VoiceOver).
- [ ] Verificação de que nenhum `dark:` residual afeta o tema em preferências de sistema `prefers-color-scheme: dark`.

## 9. Conclusão

As páginas **Meu Plano** e **Minha Conta** foram refatoradas para aderir à identidade visual oficial da Modulus, utilizando superfícies claras, tipografia consistente e uma hierarquia de informação que reflete os contratos reais de plano, assinatura e identidade. Todas as funcionalidades de billing, autenticação e autorização foram preservadas sem alteração de lógica.

O relatório finaliza a entrega da **Refatoração Visual 07**.