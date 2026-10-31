# Etapa 6 — Correção de equipe e provisionamento

## Escopo e estado

Correção incremental de equipe, sem aplicação automática de migrations, reset, commit, push ou deploy. O relatório `AUDITORIA_ETAPA_6_V3_EQUIPE.md` permanece como registro histórico dos achados anteriores. Não foram alteradas nesta execução a precificadora V1/V2/V3, as policies gerais, a arquitetura de autenticação, pedidos ou pagamentos. Alterações de pricing já presentes no worktree são trabalho preexistente e não fazem parte desta entrega.

**Implementado e revisado estaticamente; ainda não validado em PostgreSQL nem navegador autenticado.** A aprovação final depende dos procedimentos abaixo. Nenhum dado legado foi saneado automaticamente.

## Falhas corrigidas

- O antigo guard apenas de INSERT não cobria reativação ou transição de papel. O novo guard cobre INSERT/UPDATE de membros e reservas.
- Novos admins e promoções para admin são negados tanto em DML quanto nas RPCs/validações do aplicativo. O enum e os admins existentes permanecem.
- Reservas pending de operador concorrem pela mesma capacidade que admissões diretas/reativações. Uma inserção direta não pode tomar emprestada uma reserva.
- Finish deixa de contar duas vezes sua própria reserva, sem isenção implícita por metadata, GUC ou papel de serviço.
- Start repetido, finish e resume revalidam elegibilidade atual; uma reserva paga não autoriza concluir após downgrade para Aprendiz.
- O backend consulta recuperação antes de criar Auth. Somente `auth_account_not_found` permite tentar criação. Resultado incerto/inconsistente não provoca recriação nem exclusão de conta.
- Erros após uma operação conhecida preservam `operationId` para retomada. Novo cadastro limpa o ID da URL. Resultado de start desconhecido não incentiva repetição cega.
- Conta Auth com marcador confiável de provisionamento de funcionário não consegue iniciar onboarding público para virar owner. Marcador inválido, ausente no catálogo, stale ou JSON null também é bloqueado; metadata editável pelo usuário não é autoridade.

## Composição e admins legados

- Aprendiz: limite de operadores zero; não-owner continua sem acesso empresarial pela matriz existente.
- Visionário: limite de um operador ativo, com pending reservando capacidade.
- Magnata: nenhuma ativação introduzida.
- Para **novo consumo**, contam admins ativos + operadores ativos + pending de operador. Assim, um admin legado ativo não permite contratar mais um operador além da composição operacional aprovada.
- Admin legado ativo permanece ativo e com seu papel/permissões; editar nome sem mudar papel, manter papel/status ou desativar não exige regularização de quota.
- Reativação de admin legado não cria novo papel admin, mas consome capacidade compartilhada e só passa quando há vaga no plano atual. Não há conversão/desativação automática.
- Admin ativo → operador é neutro no total de vagas, porém verifica separadamente operadores ativos + pending: não pode produzir segundo operador nem operador no Aprendiz. Se não ultrapassar esse sublimite, a conversão explícita continua possível mesmo com excesso legado total; não se exige saneamento automático prévio.
- Operador → admin e owner → admin são negados. Promoções para owner são negadas; primeiro owner continua permitido no onboarding, segundo owner novo é negado prospectivamente.
- Não se criou índice de unicidade de owner: conflitos históricos são apenas relatados pelo preflight e exigem revisão humana.

## Enforcement transacional

1. Start/finish/resume adquirem o advisory lock global já usado no gerenciamento (`modulus:enterprise-management:all-members`) **antes** de locks de ator/linhas. Triggers BEFORE STATEMENT fazem o mesmo em INSERT/UPDATE direto.
2. O guard BEFORE ROW adquire `modulus:team-limit:<enterprise_id>`, resolve o plano atual e conta membros/reservas do mesmo tenant. A serialização global é conservadora e já limita concorrência entre empresas; não foi removida para uma otimização fora de escopo.
3. Novas admissões são negadas com `P0001 / team_limit_reached`. Operações neutras e redutoras não são bloqueadas só porque existe excesso legado.
4. Finish mantém todas as verificações originais de ator, tenant, issuer, Auth confirmado, marker, e-mail e correlação. Imediatamente antes de inserir o membro, troca **somente sua própria operação** de pending para failed, estado transitório que não reserva vaga e respeita o CHECK original. O guard passa a contar membros + todas as outras reservas.
5. Sucesso marca a operação completed com seus IDs. Qualquer exceção desfaz inserções e mudança transitória: a reserva continua pending, sem usuário/identidade órfãos causados pela transação. Nenhum commit intermediário ou efeito Auth externo ocorre nessa RPC.

Os nomes `failed`/`completed` persistidos não foram redefinidos: o uso de failed durante finish é exclusivamente transacional. Futuros triggers de auditoria/outbox não devem interpretar esse estado intermediário como falha externamente confirmada.

Clientes privilegiados devem respeitar a ordem global → empresa/ator/linhas e não pretravar linhas arbitrárias antes de chamar DML/RPCs de equipe. O trigger de statement não pode desfazer inversão já iniciada por um cliente privilegiado. Nenhum sistema resiste a superusuário que desabilite triggers; esse cenário não integra o contrato de acesso normal.

As três RPCs recebem alterações cirúrgicas da definição instalada via `pg_get_functiondef`, mantendo assinatura, ACLs e verificações existentes. Os anchors devem aparecer exatamente uma vez, com normalização de CRLF. Divergência de catálogo **aborta toda a migration**, em vez de instalar parcialmente: investigar a definição instalada, não remover a proteção para forçar aplicação.

### Contratos de erro

| SQLSTATE | Mensagem | Uso |
| --- | --- | --- |
| P0001 | team_limit_reached | Sem capacidade no plano atual |
| 42501 | team_role_not_allowed | Novo admin, promoção, recuperação de pending admin ou segundo owner |
| 42501 | team_identity_immutable | Tentativa de mover/reidentificar vínculo ou reserva |
| 42501 | employee_provisioning_requires_resume | Onboarding público de conta marcada como funcionário |

O aplicativo distingue mensagem + código para quota; P0001 sozinho possui outros significados históricos. Recibos completed mantêm a idempotência autorizada original, inclusive os de admins históricos. Pending admin não pode ser finalizado ou retomado como novo admin.

## Arquivos desta correção

### Migrations novas, em ordem de aplicação manual

1. `supabase/migrations/20261026120000_team_capacity_enforcement.sql`
2. `supabase/migrations/20261026130000_employee_pending_onboarding_guard.sql`

Pré-requisito: histórico anterior instalado, incluindo as migrations `20261026100000` e `20261026110000` já confirmadas em desenvolvimento. Nenhuma migration aplicada anteriormente foi editada nesta correção.

### Aplicativo

- `lib/employees/provisioning.ts`
- `lib/enterprise/actions.ts`
- `lib/enterprise/management.ts`
- `app/(authenticated)/empresa/equipe/novo/page.tsx`
- `app/conta/equipe/novo/EmployeeProvisioningForm.tsx`
- `app/conta/equipe/novo/NewEmployeeContent.tsx`

### Testes e roteiro

- `tests/employees-provisioning.test.cjs`
- `tests/sql/20261026120000_team_preflight.sql`
- `tests/sql/20261026120000_team_capacity_sql_editor.sql`
- `tests/sql/20261026120000_team_capacity_concurrency.md`
- `tests/sql/20261026130000_employee_pending_onboarding_guard_assertions.sql`

## Verificação local versus validação pendente

Executados localmente: `npx tsc --noEmit` (passou), ESLint focado nos seis arquivos TypeScript/TSX da correção e no teste novo (passou), suíte `node --test tests/*.test.cjs` (71 testes, 71 passaram, incluindo 10 testes de provisionamento). A suíte usa mocks nas fronteiras Supabase/Auth: não comprova enforcement real no PostgreSQL nem comportamento visual.

**Não executados:** migrations em banco, assertions SQL, concorrência real, testes de admins legados pré-migration e navegador autenticado. Não havia conexão SQL autorizada disponível; Docker indisponível. Inspeção de SQL e conferência de anchors não substituem aplicação e execução.

## Roteiro manual em desenvolvimento

1. Fazer backup/snapshot conforme política do ambiente. Executar o preflight somente leitura no SQL Editor. Revisar owners ausentes/duplicados, admins legados e reservas; não corrigir dados automaticamente.
2. Para os casos legados, preparar clone descartável com fixtures anteriores à migration, conforme guia de concorrência. Não desabilitar triggers no banco atual para fabricar admins.
3. Revisar e aplicar manualmente as duas migrations, na ordem acima. Se houver erro de anchor, parar e revisar drift. Inspecionar definições finais instaladas e ACLs.
4. Executar **cada arquivo SQL inteiro** no SQL Editor DEV: primeiro `team_capacity_sql_editor.sql`, depois `employee_pending_onboarding_guard_assertions.sql`. Eles criam fixtures próprias e terminam em ROLLBACK. São testes de escrita, não consultas somente leitura. Se houver erro, executar ROLLBACK antes de tentar novamente; não trocar por COMMIT. Os fixtures Auth são inserções locais transacionais, sem convite/e-mail/API Auth.
5. Executar o guia em duas conexões persistentes para confirmar bloqueio/commit e rollback concorrentes. Timeout isolado é inconclusivo, não PASS. Supabase SQL Editor pode não manter a mesma sessão entre execuções; utilizar conexões persistentes quando necessário.
6. Validar clone legado: papel/permissões preservados, edição neutra, desativação sobre quota, reativação sem/com capacidade, admin → operador com/sem outro operador ou reserva. Registrar resultados separadamente do PASS standalone.
7. Navegador: owner Visionário cria primeiro operador; segundo recebe aviso de quota. Confirmar que novo cadastro oferece só operador. Owner Aprendiz não cria operador. Chamada direta tentando admin é negada no banco.
8. Simular interrupção após Auth e antes de finish em ambiente controlado: preservar operationId, retomar e obter o mesmo vínculo, sem nova conta nem redefinição de senha. Repetir retomada concluída. Falha de transporte deve conservar ID e avisar resultado incerto.
9. Entre start e finish, fazer downgrade controlado: finish/resume/start repetido negam pela quota atual; pending e Auth permanecem para revisão. Conta parcial marcada não conclui onboarding público. Não limpar contas automaticamente.
10. Verificar outro tenant, operador e ator inativo: nenhuma mutação/conta Auth nova. No downgrade, owner consegue desativar vínculo; não-owner perde acesso empresarial sem exclusão de dados.

## Riscos e decisões ainda abertas

- **Reserva abandonada não expira.** O ID/idade não provam abandono: pode existir Auth externo já criado ou requisição ainda em andamento. Pending continua ocupando vaga até revisão segura; não foi criado botão/RPC de cancelamento.
- Produto deve decidir entre cancelamento manual auditado com reconciliação Auth, TTL com reconciliação e fencing transacional, ou manutenção de reservas até suporte resolver. Qualquer opção deve definir destino de contas Auth parciais e proteção contra finish tardio. Não implementar DELETE Auth automático.
- Pending admin histórico fica bloqueado. Recibos completed existentes seguem idempotentes; encerramento/reclassificação de pending admin exige política explícita, sem conversão automática.
- Excesso legado de admins/owners não é saneado. Preservação não equivale a expansão da equipe. Transferência de ownership, conflitos multi-owner e eventuais exceções de composição exigem decisão separada.
- Conta marcada com referência inválida/stale fica bloqueada no onboarding público de forma fail-closed; exige reconciliação administrativa, não remoção automática de metadata.
- O problema histórico de pricing com JWT/service-role descrito na auditoria continua fora deste escopo; nenhuma permissão de pricing foi ampliada para contorná-lo.
