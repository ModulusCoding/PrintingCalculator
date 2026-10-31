# Dados Empresa — perfil institucional

## Escopo

Refatoração visual de `/empresa`, preservando leitores, Server Actions, RPCs, permissões e contratos de versão existentes. Nenhuma migration, SQL, dependência ou alteração global de branding foi adicionada nesta etapa.

Referência de marca: adendo de identidade oficial em `design-references/stitch_modulus_3d_editor/README.md`, tokens de `app/globals.css` e composição clara das telas de conta/plano. Azul elétrico #2B00FF, azul escuro #152336, lilás #A6B4FF, superfícies claras e Space Grotesk já carregada globalmente. Logo oficial de `public/`, sem representar a marca Modulus como se fosse a logo da empresa do usuário.

## Organização

- Cabeçalho de perfil com nome/identificação institucional e iniciais; sem inventar campos ou status de empresa verificada/ativa ausentes no DTO.
- Informações empresariais separadas dos parâmetros de energia/perda.
- Contexto auxiliar e resumo dos valores salvos, sem expor identificadores internos.
- Admin legado continua limitado ao ramo de perda, sem receber nome/data que sua consulta não fornece.
- Formulários e ações existentes preservados; inputs claros, foco visível, mensagens acessíveis e estados de salvamento.
- Loading local com skeleton responsivo e anúncio acessível; falhas de leitura com mensagem amigável e opção de recarregar quando técnica.
- Nenhuma seta em ações/links.

## Arquivos

- `app/(authenticated)/empresa/page.tsx`: wrapper e composição de erro reutilizável; fluxo de autorização/leitura preservado.
- `app/(authenticated)/empresa/CompanyForm.tsx`: perfil e edição por seções.
- `app/(authenticated)/empresa/CompanyProfile.module.css`: estilos locais responsivos.
- `app/(authenticated)/empresa/loading.tsx`: skeleton da rota.
- `tests/company-page.test.cjs`: ajusta o teste que mocka o formulário, pois o título agora pertence ao perfil client.
- `tests/company-profile.test.cjs`: regressões da apresentação/interação real com dependências controladas.
- Este relatório.

## Limitações preservadas

- O erro SQL de autorização já diagnosticado depende da aplicação manual da migration local previamente preparada. Esta refatoração não aplica nem altera SQL e não contorna a falha com dados fictícios.
- A política de perda no Aprendiz e a diferença preexistente entre a RPC dedicada e o overload completo continuam conforme o backend; não foram ampliadas permissões para acompanhar o layout.
- Não se acrescentaram e-mail, telefone, CNPJ, upload de logo, transferência/exclusão de empresa ou status inventado.
- A leitura composta ainda usa duas RPCs; snapshot atômico continua assunto separado.

## Verificações

- `npx tsc --noEmit`: aprovado.
- ESLint direcionado aos TSX e testes alterados: aprovado. O CSS local não possui linter CSS configurado no projeto; foi revisado e é processado pelo build.
- `node --test tests/*.test.cjs`: 485 testes, 484 aprovados e 1 falha em `tests/company-sql.test.cjs` (“rate-only retains the exact current identity/locking/authorization sequence”). A comparação textual espera o predicado antigo `NOT private.can_access_enterprise(...)`, mas a migration local atualmente contém o predicado fail-closed `IS DISTINCT FROM TRUE`. Nenhum SQL nem esse teste SQL foi alterado nesta refatoração; a divergência foi preservada para revisão do trabalho de banco, sem esconder a falha.
- `npm run build`: aprovado, `/empresa` compilada; somente aviso preexistente de depreciação da convenção `middleware`.
- `git diff --check`: aprovado; avisos de normalização LF/CRLF no workspace.
- Reexecução direcionada de página, perfil, gestão e consumidores de autorização: **106/106 aprovados**.
- Conferência isolada no Chrome nativo: **12 cenários** (owner, admin restrito e nome longo em 320/375/768/1440 px), sem overflow horizontal e com logo carregada. Foi usado HTML SSR do componente real + CSS real, actions substituídas e logo inline local, com fonte Arial fallback. Evidência de layout isolado, não homologação hidratada/autenticada no shell. Artefatos em `C:/Users/Pichau/AppData/Local/Temp/opencode/company-native-smoke/`.
- Os 20 novos testes do perfil passaram na execução completa. Validam ramos owner/admin, contrato das três actions, vírgula/NULL, atualização de versão, nome salvo no perfil, feedbacks e bloqueio global de submissões.

Revisão independente final não identificou bloqueadores no perfil e reexecutou 80/80 testes de perfil/página/consumidores. O build e o lint foram repetidos após o ajuste final do texto explicativo e passaram.

Pequenos ajustes de UX funcionais: drafts controlados preservam a edição diante de falhas; cabeçalho/resumo refletem apenas dados confirmados; lock compartilhado impede submissões concorrentes dos formulários; mensagens de rede, acesso e conflito são amigáveis e acessíveis. Não foi adicionado cancelar/desfazer porque o escopo não precisava introduzir semântica nova de descarte de rascunhos.
