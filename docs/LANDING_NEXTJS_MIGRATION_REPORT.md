# Modulus Hub — migração da landing para Next.js

Data: 30/10/2026. Implementação local; **sem deploy, alteração de DNS, commit ou push**.

## 1. Originais e arquitetura analisados

Leitura integral de `sites/Modulus-Hub-Landing-Codigo/index.html`, `style.css`, `app.js` e `assets/favicon.svg` (único arquivo da pasta assets). A pasta original foi preservada. CSS/HTML minificados foram também expandidos em arquivos temporários para inspeção completa.

A referência não tem fotografias, vídeos, pacotes auxiliares ou bibliotecas JavaScript externas. A ilustração principal é SVG procedural; os carretéis, cards, fundos e demais desenhos são CSS/SVG inline. A única dependência externa da referência é Google Fonts / Space Grotesk. A migração reutiliza a fonte já carregada por `next/font/google` no layout, sem segundo carregamento por CDN.

Inspecionados: `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, grupos `(authenticated)` e `(plans)`, login, cadastro, confirmação, conta, configurações de onboarding, middleware e helper Supabase, contratos/apresentação de planos, dependências, `next.config.ts` e `vercel.json`. Consultada a documentação instalada do Next 16 para CSS, metadata, route groups e middleware/proxy.

O repositório já tinha muitas alterações staged/unstaged e arquivos não rastreados antes deste trabalho. Não foram revertidas ou reformatadas alterações alheias. `next dev` atualizou automaticamente o bloco de instruções de `AGENTS.md`.

## 2. Seções e componentes

Todas as seções reais foram preservadas:

| Seção | Implementação |
|---|---|
| Header desktop/mobile | `components/landing/LandingHeader.tsx` |
| Hero, vaso, cards e ticker | `LandingHero.tsx`, `VaseLayers.tsx`, composição em `app/page.tsx` |
| Demonstração: precificadora, materiais e pedidos | `LandingDemo.tsx` |
| Benefícios e quatro etapas do fluxo | `LandingFeatures.tsx` |
| Comparação manual/integrado | `LandingComparison.tsx` |
| Três planos e comparação expandida | `LandingPricing.tsx`, `PricingComparison.tsx` |
| FAQ | `LandingFAQ.tsx`, `LandingFAQItem.tsx` |
| CTA final e footer | `LandingFooter.tsx` |
| Escopo e efeitos visuais | `LandingShell.tsx`, `useLandingEffects.ts`, `Landing.module.css` |

Seções estáticas e geometria do vaso são Server Components. Estado fica nas fronteiras client necessárias. Não há iframe, renderização da landing por HTML injetado, scripts originais importados, nova aplicação ou dependências instaladas.

## 3. CSS e assets

`Landing.module.css` reproduz os valores, breakpoints, keyframes, cores e composição originais. Todos os seletores têm o escopo local `.landing`; classes internas possuem prefixo `ml-` para não receber o estilo global `.hero` do antigo site. Não houve alteração em `app/globals.css` ou nos estilos dos módulos autenticados. Resets foram restritos à landing.

- `public/landing/favicon.svg`: cópia byte a byte do asset original.
- Vaso: mesmas 92 camadas × 12 polígonos, anel superior e abertura, agora renderizados no servidor.
- Demais logos/desenhos: SVG inline e CSS originais.
- Imagem social existente e inspecionada: `app/opengraph-image.png`, 1080×1080, marca Modulus. A convenção de metadata do Next já a expõe; não foi inventado caminho de imagem.

## 4. Scripts e interações

- Menu por estado React, `aria-expanded`, Escape, fechamento após navegação e retorno de foco pelo Escape.
- Abas da demonstração, slider com perda de 5%, custos e acréscimo de 100%, interpolação de 180 ms, toast, avanço/reinício do pedido: estado local; nenhum dado real é alterado.
- Modos manual/integrado e comparação expandida: estado React. Comparação com teclas Arrow/Home/End e roving tabIndex.
- FAQ mantém `details/summary`, grupo exclusivo, animação de altura e cancelamento no cleanup.
- Scroll progress, header, parallax, reveal escalonado, fluxo ativo, navegação ativa, luz do ponteiro, tilt e magnetismo foram adaptados em hook com queries restritas ao wrapper e limpeza de listeners/observers/RAF/estilos.
- `prefers-reduced-motion`: CSS e lógica respeitam a preferência; mudança dinâmica também reconfigura os efeitos. Vaso/ticker foram verificados com `animation-name: none`.
- Sem JavaScript, textos SSR e FAQ nativo continuam disponíveis. Controles dependentes de React exigem hidratação.

## 5. Rota pública e segurança

Mantido **somente `app/page.tsx` para `/`**, agora Server Component com metadata. Não existe página concorrente em `(marketing)`. A antiga raiz era uma vitrine pública de calculadoras, sem onboarding/redirecionamento necessário; `/calculator`, `/fastCalculator` e `/marketplaceCalculator` continuam existindo.

**Middleware/proxy, layouts autenticados, permissões, planos e billing não foram alterados.** A raiz já era pública. A página não consulta sessão, contexto empresarial ou dados privados, nem exige `business_ready`.

Precisão importante: o middleware existente ainda corresponde a `/` e executa `auth.getUser()` para manutenção de sessão. Portanto, componente estático público não significa ausência absoluta de processamento de autenticação no middleware. Essa política foi preservada, sem enfraquecer proteções ou migrar a convenção middleware para proxy dentro deste escopo.

## 6. CTAs e limitação de cadastro

- Entrar → `/admin/login`.
- Começar no header/hero → âncora `#planos`.
- Aprendiz/CTA final → `/cadastro` **somente quando `isPublicOnboardingEnabled()` permite**; caso contrário, `/admin/login`.
- Visionário → `/meu-plano`, fluxo protegido existente. Visitante anônimo passa pelo login; não há contratação direta nem ativação por navegação.
- Magnata → botão desabilitado.
- Recursos, fluxo, preços, demonstração e FAQ → âncoras reais preservadas.

**Bloqueio comercial preexistente:** `lib/auth/config.ts` só permite onboarding com `NODE_ENV=development` e `PUBLIC_ONBOARDING_ENABLED=true`. Em produção, cadastro público continua desativado mesmo com essa flag. Foi incluída mensagem visível esclarecendo o acesso pelo login e a indisponibilidade do cadastro público. Não foram alteradas essa política, callbacks ou variáveis de produção. A promessa de aquisição self-service completa depende de uma decisão separada sobre habilitação segura do onboarding.

O login existente não preserva automaticamente um destino arbitrário pós-login; não foi inventado parâmetro `next`. Checkout/billing continuam no Hub, sob as regras atuais.

## 7. Planos e diferenças intencionais

- Aprendiz gratuito: 1 owner, precificadora manual, 3 produtos históricos e 3 pedidos históricos.
- Visionário R$ 39,90/mês, sem fidelidade: 1 owner + 1 operator, precificadora integrada, produtos/pedidos ilimitados no lançamento, impressoras, 15 cadastros compartilhados de materiais/carretéis e estoque integrado.
- Magnata R$ 79,90/mês planejado: em breve e não contratável; removidas alegações especulativas de operadores, financeiro, materiais ilimitados etc. da lista, tabela e FAQ.

Outras diferenças justificadas: diálogos de prévia de login/planos foram removidos em favor de navegação real; footer deixou de dizer que o site inteiro era uma prévia sem contratação. A demonstração continua explicitamente ilustrativa. Pequenos espaços corrigem palavras coladas quando o CSS esconde `<br>` no mobile. O menu foi disponibilizado também entre 651 e 880 px (lacuna na referência). `scroll-margin-top` evita âncoras sob o header fixo. Pequenos ajustes abaixo de 360 px evitam aperto de CTAs/cards. Não foram inventadas seções comerciais, avaliações, clientes ou estatísticas.

## 8. SEO

Metadata na página: título absoluto `Modulus Hub — Sua próxima camada de crescimento`, descrição original, canonical `https://www.modulus3d.com.br/`, metadataBase oficial, Open Graph `pt_BR`, Twitter, favicon e `index, follow`. O layout já usa `lang=pt-BR`. A imagem social existente é herdada pela convenção do Next. Não foi aplicado noindex global nem criado sitemap com rotas privadas.

Metadata/canonical/robots foram inspecionados no DOM do navegador. O domínio real ainda precisa ser associado e validado antes de alegar publicação/indexação efetiva.

## 9. Testes técnicos

- `npx tsc --noEmit --pretty false`: passou.
- `npx eslint app/page.tsx components/landing tests/landing-migration.test.cjs --max-warnings 0`: passou (incluindo o teste novo).
- `npm run build`: passou; `/` aparece como rota estática, sem conflito App Router. Aviso preexistente: convenção `middleware` depreciada em favor de `proxy`.
- `node --test tests/*.test.cjs`: execução da suíte existente: **575 testes, 574 aprovados, 1 falha**. Falha em `tests/company-sql.test.cjs:63`, comparação do contrato `rate-only` (`IS DISTINCT FROM TRUE` versus `NOT ...`). Esse teste e os SQLs correspondentes não foram alterados nesta migração; nenhuma SQL foi executada.
- Após adicionar regressões: `node --test tests/landing-migration.test.cjs tests/global-navigation.test.cjs tests/plans-presentation.test.cjs tests/paid-module-gate.test.cjs`: **94/94 aprovados**, sendo 19 testes da landing, sem TODOs.
- `git diff --check`: passou, com avisos de normalização LF/CRLF no working tree.

`tests/landing-migration.test.cjs` cobre composição SSR pública, preservação das seções, IDs/âncoras, destinos reais e flag do cadastro, SEO, asset, geometria, isolamento PostCSS, planos, menus, abas, matemática, pedidos, comparação e FAQ. Também cobre a preservação dos arquivos/guardas das rotas existentes.

## 10. Navegador e responsividade

Chrome headless local, controlado via DevTools Protocol nativo (sem instalar ferramentas). Servidor local na porta 3100 com URL/chave Supabase sobrescritas **somente no processo** para um endpoint loopback sem serviço; nenhum Supabase remoto foi acessado nos testes de navegação.

- `/` carregou sem login, fonte Space Grotesk computada, canonical correto, todas as oito seções presentes.
- Larguras **320, 375, 430, 768, 1024 e 1440 px**: `scrollWidth` não excedeu a largura da viewport; screenshots capturados.
- Menu abre, abas de materiais/pedidos, avanço para pago/entregue, comparação manual, tabela expandida e FAQ funcionaram. Slider em 200 g produziu R$ 60,00. Favicon retornou 200.
- `/admin/login`: 200. `/home`, `/planos`, `/meu-plano`, `/admin/products`: 307 para `/admin/login` quando anônimo.
- Zero exceções JavaScript capturadas na execução inicial; sem erro de hidratação observado. Não se trata de auditoria exaustiva de console/performance.
- Comparação visual por screenshots do hero migrado e HTML original em 1440 px (também original em reduced motion), além de inspeção mobile. Não houve homologação pixel-perfect de toda a página ou teste em dispositivos físicos.

Evidências temporárias: `C:\Users\Pichau\AppData\Local\Temp\opencode\landing-*.png` e `landing-browser-results.json`. O primeiro script leu o menu no mesmo tick do clique, antes do commit React; uma verificação separada com espera confirmou `expanded=true` e visibilidade correta.

Não foram usados usuários reais: **login com credenciais, logout efetivo, sessão autenticada, estados empresariais reais e contratação não foram homologados ponta a ponta**. Guardas não alterados e regressões locais aprovadas não substituem essa homologação posterior.

## 11. Segunda revisão

- Todas as seções originais: sim.
- Animações convertidas: sim, incluindo escultura SSR, efeitos com cleanup e reduced motion; diálogos comerciais de prévia substituídos intencionalmente.
- HTML para TSX completo: sim, sem scripts HTML no runtime.
- Assets: favicon validado; desenhos inline/CSS, fonte existente e imagem social real.
- `/` pública: comprovada anonimamente; não há condição que bloqueie usuário autenticado na página. Sessão real autenticada não testada.
- Links reais e valores comerciais: revisados, sem checkout duplicado; onboarding de produção continua pendente por política existente.
- CSS isolado: validado automaticamente em todos os seletores.
- Hub: arquivos e guardas preservados, regressões relevantes aprovadas; homologação autenticada real pendente.
- Responsividade: seis larguras verificadas; sem overflow horizontal.
- Produção: build aprovado; falha SQL preexistente da suíte geral registrada, não ocultada.

## 12. Publicação manual na Vercel e domínio

`vercel.json` usa framework Next.js, `npm ci`, `npm run build` e `npm run dev`, sem redirects/rewrites. Não foi encontrada pasta `.vercel` com vínculo local; o fallback de metadata no layout aponta para `printing-calculator-lovat.vercel.app`, mas isso **não comprova associação atual de nenhum domínio**. Não houve acesso à conta Vercel, verificação de titularidade ou consulta/alteração de DNS. Configuração remota permanece não confirmada.

Responsável pela publicação:

1. Abrir o projeto Next.js correto no dashboard Vercel; conferir repositório, branch, projeto e deployment de produção existente. Conferir se algum dos dois domínios já pertence a outro projeto/time.
2. Em **Settings → Domains**, adicionar `www.modulus3d.com.br` e `modulus3d.com.br` ao mesmo projeto. Definir `www.modulus3d.com.br` como domínio canônico de produção.
3. Configurar no painel da Vercel o redirecionamento do domínio raiz `modulus3d.com.br` para `https://www.modulus3d.com.br`, preservando path/query quando suportado pela opção apresentada. Não é necessário adicionar redirecionamento de `/` no Next.
4. No provedor DNS, copiar **exatamente os tipos, nomes, valores e eventuais registros de verificação que a Vercel apresentar para esse projeto/domínio**. Não usar IP/CNAME genérico presumido. Examinar conflitos antes de remover registros e preservar MX/TXT de e-mail e outros serviços.
5. Aguardar propagação e os dois domínios ficarem válidos na Vercel. Confirmar emissão automática do certificado HTTPS, acesso HTTPS em `www`, redirecionamento do apex e ausência de loops.
6. Antes de alterar qualquer URL/variável, inventariar `NEXT_PUBLIC_SITE_URL`, validação de origem de Server Actions, Site URL/redirect allowlist do Supabase, confirmação/recuperação de senha e URLs de retorno/webhook do billing/Asaas. As configurações remotas não foram inspecionadas ou alteradas. A mudança exige revisão dessas dependências pelo responsável; não trocar callbacks às cegas.
7. Planejar separadamente a habilitação segura de cadastro público. A flag atual não habilita produção. Não anunciar fluxo self-service operacional antes da aprovação e homologação.
8. Após publicação autorizada, repetir testes anônimos/autenticados, login/logout, confirmação/recuperação, `/planos`, contratação e retornos existentes; verificar canonical, imagem social e indexabilidade no domínio final.

**Pendências de aceite operacional:** associação/verificação Vercel, DNS, HTTPS, homologação autenticada real, decisão do onboarding de produção e correção independente da falha SQL da suíte. Nenhuma dessas etapas foi simulada como concluída.
