# Modulus Hub — Refatoração visual de autenticação 01

## Escopo e referências

Implementação frontend em React/TypeScript, Tailwind e CSS Module local, sem dependências novas. As regras funcionais existentes prevalecem sobre o Stitch. O README foi relido após a atualização solicitada pelo usuário, incluindo o adendo de identidade visual oficial.

Referências em `design-references/stitch_modulus_3d_editor/`:

- `login_modulus_hub/code.html` e `screen.png`.
- `cadastro_acesso_modulus_hub/code.html` e `screen.png`.
- `confira_seu_e_mail_modulus_hub/code.html` e `screen.png`.
- `cadastro_empresa_modulus_hub/code.html`, como referência complementar para a conclusão existente.
- `lumina_system/DESIGN.md`, para espaçamento, hierarquia, superfícies e raios.
- `README.md`, incluindo a prioridade de marca oficial.

Não foi encontrada referência específica de recuperação/redefinição de senha. Essas interfaces reutilizam a composição e os componentes extraídos das referências disponíveis. Os exports principais contêm HTML parcial e screenshots com a composição completa; a estrutura dividida foi reconstruída em React. Não foram copiados scripts, CDN, estilos globais ou simulações de autenticação dos exports. Não há assets ilustrativos adicionais associados às três referências principais além dos screenshots; ícones são da dependência Lucide já existente.

## Branding

- Logo oficial: `public/logo_Horizontal.svg`, inspecionada e usada com `next/image` e proporção original (920:190).
- Desktop: logo sobre superfície branca com respiro dentro do painel azul, preservando as cores originais do arquivo. Mobile/tablet: logo no topo do conteúdo. Não há texto “Modulus” duplicado junto ao arquivo, que já contém o nome.
- Azul elétrico `#2B00FF`: painel, botões, links e foco. Azul escuro `#152336`: textos institucionais/feedback. Lilás `#A6B4FF`: bordas, realces e decoração tonal. Neutros claros para campos/superfícies. Laranja permanece reservado; não foi necessário introduzi-lo nesta composição.
- A primária violeta genérica e a tipografia Geist do Stitch foram substituídas pelo branding oficial.
- Space Grotesk reutiliza a configuração existente em `app/layout.tsx`, via `--font-space-grotesk`, sem outro download/configuração ou mudança global.

## Rotas e contratos identificados

| Rota | Situação real / preservação |
| --- | --- |
| `/admin/login` | E-mail/senha por `loginAction`; `business_ready` → `/home`, demais estados → `/conta`; guardas servidor e erro técnico mantidos. |
| `/cadastro` | Cadastro público condicionado ao layout/flag existente. Campos reais: `userName`, `enterpriseName`, `email`, `password`, `passwordConfirmation`. |
| `/cadastro/concluir` | Guardas de identidade mantidos; formulário chama `completePublicOnboardingAction` com nome e empresa, sem criar outro onboarding. |
| `/auth/confirm` | Callback sem página própria, `verifyOtp` de signup; sucesso vai à conclusão, falhas à tela de link inválido. Não modificado. |
| `/auth/invalid-link` | Mantidos motivos de recovery/signup inválido, indisponibilidade técnica e sessão de signup não validada, sem interpretar texto arbitrário da query. |
| `/esqueci-senha` | Solicitação real pela action existente; sucesso genérico sem enumerar contas, erros reais e loading. |
| `/auth/recovery` | Callback recovery, token e marcador de recuperação existentes. Não modificado. |
| `/redefinir-senha` | Mantida exigência servidor de usuário e marcador vinculado à sessão; refatorados formulário e ramo inválido/expirado. |
| `/redefinir-senha/sucesso` | Mantida navegação após retorno da action e mensagem alternativa `logout=failed`. |
| `/trocar-senha-obrigatoria` | Mantidos guardas, campos `current`, `next`, `confirm`, action versionada, logout e estados parcial/desconhecido/sucesso. |
| `/conta` | Destino existente dos bloqueios; não alterado. Preserva estados e ações específicas. |

### Estados de acesso

Não houve alteração em `get_my_access_context()`, `resolveMinimalIdentity()`, middleware, RLS, migrations, regras de planos ou permissões. Permanecem os estados `unauthenticated`, `business_ready`, `password_change_required`, `user_inactive`, `enterprise_inactive`, `membership_inactive`, `no_enterprise_membership`, `ambiguous_active_enterprise` e `no_active_internal_identity`.

As actions em `lib/auth/` e os callbacks não foram modificados. Preservados os limites de tentativas, schemas/validações, mensagens do backend, tratamento de e-mail duplicado, resultados desconhecidos e regras de primeira autenticação. A captura de FormData do reset foi movida para antes da transição assíncrona, sem mudar payload ou contrato.

## Estado real de cadastro e confirmação

`isPublicOnboardingEnabled()` exige desenvolvimento e `PUBLIC_ONBOARDING_ENABLED=true`. `app/cadastro/layout.tsx` já bloqueia a rota com `notFound()` quando indisponível e foi preservado, sem transformar bloqueio em sucesso fictício. O link de cadastro no login só aparece quando essa mesma configuração autoriza o fluxo. Não foi lido `.env.local` para declarar a flag ativa ou inativa no ambiente do usuário.

Signup cria identidade Auth e solicita confirmação; provisionamento empresarial continua somente pela conclusão existente, após verificação real. A confirmação pendente é representada dentro da própria página de cadastro após o retorno `confirmation_pending`, sem nova rota pública que afirme envio. A mensagem genérica da action é mantida, inclusive para duplicidade. Não se exibe e-mail fictício, conta confirmada, sessão ativa ou acesso empresarial liberado.

O formulário mantém seus valores não secretos; senhas são limpas após a resposta pendente. “Revisar dados do cadastro” permite retornar ao formulário, preservando a possibilidade de revisão/nova tentativa. Login e recuperação continuam disponíveis. Não existe action de reenvio de confirmação, portanto o botão do Stitch foi omitido.

Confirmação bem-sucedida continua um callback com redirect, não uma tela que valida tokens por conta própria. A conclusão não declara confirmação com base apenas em aparência visual. O estado de sucesso do reset já era uma rota pública acessível diretamente; não foi introduzido recibo, autorização ou inferência de acesso nessa página.

## Filtragem dos elementos do Stitch

| Classificação | Elementos / decisão |
| --- | --- |
| Existente | E-mail/senha, exibir senha, login, recuperação, cadastro condicionado, confirmação pendente, conclusão, erros/loading e navegação. Mantidos. |
| Adaptável | Painel dividido, fundo pontilhado, hierarquia, badge, campos com ícones, CTA com seta, painel de status e orientações. Reconstruídos com componentes reais. |
| Adaptável | Nome e nome da empresa preservados já no signup, embora o Stitch os coloque em outra etapa; contrato real não foi simplificado. |
| Adaptável | Requisito visual de senha reduzido ao mínimo real de 8 caracteres; sem impor maiúscula/número/símbolo do exemplo. |
| Futuro / não implementado | Reenvio de confirmação, integrações diretas com parques/slicers, lembrança explícita por 30 dias. Omitidos. |
| Descartável | E-mail de exemplo, timers de sucesso fictício, sessão ativa fictícia, versão Core, dados preenchidos, certificação ISO 27001, alegação SSL 256-bit e links institucionais sem destino funcional. Omitidos. |

Não foram adicionados Google/OAuth, MFA, campos extras de identidade, permissões, provedor de e-mail, SQL, chamadas remotas ou lógica de token.

## Componentes criados

- `components/auth/AuthUI.tsx`: shell de marca, heading, campos, feedback, submit, retorno e painel de status compartilhados.
- `components/auth/PasswordField.tsx`: visibilidade de senha independente por campo, acessível, preservando autocomplete.
- `components/auth/auth.module.css`: composição responsiva e estilos isolados da autenticação.

## Arquivos modificados nesta entrega

- `app/(public)/admin/login/LoginForm.tsx`
- `app/(public)/admin/login/page.tsx`
- `app/cadastro/page.tsx`
- `app/cadastro/concluir/CompletionForm.tsx`
- `app/cadastro/concluir/page.tsx`
- `app/esqueci-senha/page.tsx`
- `app/redefinir-senha/page.tsx`
- `app/redefinir-senha/reset-form.tsx`
- `app/redefinir-senha/sucesso/page.tsx`
- `app/auth/invalid-link/page.tsx`
- `app/trocar-senha-obrigatoria/page.tsx`
- `app/trocar-senha-obrigatoria/RequiredPasswordForm.tsx`
- Os três componentes/estilos novos acima e este relatório.

Alterações preexistentes em Billing, migrations, testes, plano e referências foram preservadas e não fazem parte desta entrega.

## Responsividade e acessibilidade

- A partir de 1024 px: grid 5:7, painel institucional e formulário limitado a 520 px; dimensões e padding fluidos.
- Abaixo de 1024 px: uma coluna, marca no topo, painel exclusivamente decorativo/institucional removido. Nenhuma ação funcional fica nesse painel.
- Abaixo de 480 px: margens de 16 px e painel de status compacto; sem altura fixa ou scale/zoom. `min-height: 100svh` permite crescimento e rolagem com teclado virtual.
- Campos a 16 px, botões de pelo menos 50 px e controles de visibilidade de 44 px. Quebra de texto e `min-width: 0` evitam pressão horizontal.
- Labels vinculadas, autocomplete real, foco visível, link de pular conteúdo, erros de campo associados e anunciados, feedback `alert/status`, submit desabilitado e `aria-busy`.
- Ícones decorativos fora da leitura; suporte a reduced motion; sem animação de confirmação fictícia.

## Verificações locais

- `node --test tests/employees-provisioning.test.cjs tests/pricing-access.test.cjs tests/pricing-actor-authorization.test.cjs tests/manual-pricing-persistence.test.cjs tests/paid-module-gate.test.cjs tests/products-access.test.cjs`: **84 aprovados, 0 falhas**. Logs de erro esperados pertencem a casos negativos mockados. Não acessam o Supabase remoto.
- Não foram encontrados testes dedicados ponta a ponta de login/signup/callback/recovery; a suíte acima cobre contratos adjacentes de autorização/provisionamento, não comprova entrega de e-mail ou sessões reais.
- `npx tsc --noEmit`: aprovado.
- `npx eslint components/auth "app/(public)/admin/login" app/cadastro app/esqueci-senha app/redefinir-senha app/trocar-senha-obrigatoria app/auth/invalid-link`: aprovado.
- `npm run build`: aprovado, Next 16.3.1. Advertência preexistente de convenção `middleware` depreciada; não migrada por restrição do escopo. O build carregou a configuração local automaticamente, sem leitura/exposição de credenciais pelo agente.
- `git diff --check`: aprovado; somente avisos do Git sobre conversão futura LF/CRLF.

Sem instalação, Docker/WSL, SQL, acesso intencional ao Supabase remoto, commit, push ou deploy.

## Pendências de homologação manual

Não há ferramenta de navegação visual disponível nesta execução. **Os layouts não foram visualmente homologados no navegador.** Conferir login, cadastro/pendência/conclusão, recuperação, reset válido/inválido/sucesso e troca obrigatória em:

- 320 px; 375, 390 e 430 px; 768 px; 1024 e 1366 px; 1440 px ou superior.
- Teclado virtual, orientação horizontal, zoom 200%, mensagens longas, foco/tabulação, leitor de tela, autofill e gerenciador de senhas.
- Todos os estados de acesso, erros técnicos, credenciais inválidas, duplicidade, validações e envio repetido.
- Flags habilitada/desabilitada, token inválido/expirado/consumido, ausência de sessão, marcador recovery inválido e retorno `same_password`.
- Retorno incerto do cadastro/reset, troca obrigatória parcial, conflito de versão e falha de logout.

Entrega real de e-mail continua dependendo da configuração externa existente: SMTP/provedor Supabase, URL base, templates com `token_hash` e allowlists compatíveis com `/auth/confirm` e `/auth/recovery`. Não foram verificados remotamente, nem foi simulado envio bem-sucedido. Validar em ambiente autorizado com contas de teste. Reset de recuperação continua sem liberar automaticamente a obrigação empresarial de troca de senha, conforme contrato existente.
