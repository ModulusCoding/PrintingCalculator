# Auditoria etapa 6: V3 e equipe

## Evidências e limites

As migrations 20261026100000 e 20261026110000 foram aplicadas em desenvolvimento conforme confirmação do usuário. Nesta execução não consultei catálogo remoto nem executei SQL/ações autenticadas. Não houve correção de equipe, migration nova/modificada ou alteração das telas/matriz aprovadas. Alterações preexistentes preservadas.

Executados: TypeScript, lint focado V3/histórico/testes, 61 testes Node e testes FDM/manual-form: passaram. Não equivalem a integração SQL/navegador. Não há psql/CLI Supabase, URL de banco nas variáveis verificadas, nem Docker daemon disponível. As chaves API existentes não são conexão SQL e não foram usadas para contornar esse limite.

## Assertions V3

Original `tests/sql/20261026100000_manual_v3_assertions.sql` usa BEGIN/ROLLBACK e fixtures aleatórias, sem auth.users. O helper compara SQLSTATE exato; não aceita qualquer exceção. Entretanto NÃO está pronto para certificar V3:

- fixture compartilhada insere operador sem plano pago: trigger de INSERT rejeita quota zero; operador inativo também passa pelo guard que ignora status;
- faltam claims JWT necessárias ao helper de autorização;
- linhas179/182 tentam UPDATE em pricing_calculations imutável (trigger 42501);
- linha198 espera janela negar cálculo já aplicado: receipt retorna idempotente antes da janela;
- conflito por versão antiga num cálculo ainda não aplicado não estava testado;
- não contém validação end-to-end de V1/V2.

Criada SOMENTE cópia autocontida `tests/sql/20261026100000_manual_v3_sql_editor.sql`: expande includes, remove metacomandos psql, usa bootstrap pago temporário antes dos vínculos, operador inativo primeiro, JWT local, fixtures distintas para preço fora do limite/janela, teste de imutabilidade, versão concorrente, inativo e replay sem mudança adicional. Preserva rollback e triggers. Não executada em banco: pode revelar incompatibilidades adicionais do catálogo real.

### Execução manual

1. Confirmar projeto Supabase DESENVOLVIMENTO e migrations, nunca produção. Usar SQL Editor como postgres em horário sem operações concorrentes de equipe/precificação; os helpers usam locks globais e podem causar espera temporária.
2. Abrir arquivo standalone, copiar TODO conteúdo e executar uma única vez. Não executar fragmentos nem substituir ROLLBACK por COMMIT. lock_timeout=3s, statement_timeout=60s são locais.
3. Se qualquer erro, executar ROLLBACK; registrar SQLSTATE/linha/mensagem sem segredos. Não desabilitar triggers nem conceder privilégios para fazer passar.
4. Sucesso exige terminar no ROLLBACK sem assertions falhando. Fixtures são UUIDs aleatórios, somente dados próprios; não cria Auth nem chama APIs externas. Escritas transacionais não permanecem. Locks/carga/WAL temporários ainda existem; não é read-only.
5. Claims do owner são simulação para testar a lógica SQL: NÃO provam o caminho HTTP service-role usado pela action nem RLS sob papel authenticated. Testar esses caminhos separadamente.

### Cobertura/pêndencias

Unitários: action com schemas/motor reais, sem fontes pagas, rejeição de totais do browser, hash e retry antes do reload, invisibilidade simulada por retorno null, selection_required; UI review transporte; histórico manual com unidades opcionais.

Standalone SQL (pendente execução): new save Free, inválidos/NULL, mesma intenção, conflito23505, retry após mudança de versão/plano, aplicação preço persistido, replay sem alteração extra, versão concorrente, inativo/excluído/janela e saldos/ledger. V1/V2 têm fixtures históricas apenas para negação Free, NÃO cobertura de save legítimo integrado ou compatibilidade completa.

Navegador pendente: owner Free calcular/salvar/histórico/revisar/aplicar, perda de resposta e retry mesma tentativa, versão alterada em segunda sessão antes confirmar, produto inativo/excluído/janela, sessão de operador após downgrade, V2 integrado e abertura V1/V2 antigos. Rede deve mostrar ausência de fontes pagas no manual. Testar incerteza e locks sem duplicação. Não reabrir visual/matriz sem regressão demonstrada.

## Defeito adicional V3: ator explícito versus JWT da conexão (alto)

`persistence-actions.ts:202–212,329–334` autentica cliente de sessão, mas chama RPC por createAdminClient. `lib/supabase/server.ts:36–57` instancia service-role sem cookies/token do usuário. `private.pricing_actor` (26020000:20–75) valida p_actor/p_issuer, mas ao final chama can_access_enterprise; a definição final (26060000:68–79) usa current_internal_user_id, que lê auth.jwt/auth.uid (20261014193600:40–58). Não há propagação/derivação de claims nesse caminho. Bypass RLS não elimina a checagem explícita.

Consequência estática: service-role sem identidade do usuário pode receber42501 já no lookup, inclusive para retry, e no apply. Unitários mockam RPC; standalone usa JWT owner e não reproduz transporte real. Não é bypass: é negação indevida. Falta reprodução autenticada. Não corrigido nesta auditoria; qualquer correção deve autorizar o ator explícito com identidade/tenant/papel/plano sob locks, não liberar service-role indiscriminadamente nem remover controles.

## Equipe: funções/arquivos analisados

- 20261002000000_create_auth_tenancy_core.sql: enterprise_members/constraints/RLS/privilégios.
- 20261014193600_create_auth_tenancy_access_context.sql: current_internal_user_id/get_my_access_context.
- 20261014193700_complete_public_onboarding.sql: complete_public_onboarding.
- 20261015100000_employee_provisioning.sql: start_employee_provisioning/finish_employee_provisioning.
- 20261015110000_employee_provisioning_resume.sql: resume_employee_provisioning.
- 20261015140000_enterprise_member_management_hardening.sql: update_my_enterprise_member/set_my_enterprise_member_status/list_my_enterprise_members.
- 20261025000000_stage6_plans_entitlements.sql: limits/resolver/confirm/cancel.
- 20261026000000_stage6b_access_restrictions.sql: stage6b_team_limit_guard/triggers.
- 20261026060000_plan_business_regularization.sql: plan_permission_allowed/can_access_enterprise/business access.
- lib/employees/provisioning.ts; lib/enterprise/actions.ts e management.ts; lib/auth/context.ts, onboarding.ts, password-change.ts; lib/rate-limit.ts.
- app/conta/equipe/novo/EmployeeProvisioningForm.tsx e app/(authenticated)/empresa/equipe/novo/page.tsx; scripts/prepare-employee-provisioning-resume.mjs (não executado: cria Auth real).

## Matriz de cenários

| Cenário | Esperado | Proteção encontrada / conclusão estática |
|---|---|---|
| Criar operador Free | negar | trigger BEFORE INSERT, limite0; transacional |
| Criar primeiro operador pago | permitir | start reserva pending; finish revalida e insere |
| Criar segundo operador pago | negar | advisory lock por empresa + conta active/pending no start |
| Duas criações simultâneas | uma vaga | locks serializam; falta teste em duas conexões |
| Reativar operador excedente/Free | negar | FALHA: UPDATE sem guard de quota |
| Admin ativo -> operador com vaga cheia | negar | FALHA: UPDATE sem quota |
| Criar admin adicional | não expandir composição aprovada | FALHA: schema/start/finish aceitam admin; trigger limita só operator |
| Operador -> admin e criar outro operador | não ampliar equipe operacional | FALHA: admin não conta e opera no pago |
| Promover a owner / alterar owner ou self | negar | RPC aceita só admin/operator; protege self e owner |
| Dois owners por escrita privilegiada | impedir estruturalmente | falta unique owner por empresa; fluxo normal não expõe promoção |
| Desativar funcionário autorizado | permitir e bloquear próximas operações | status RPC + helper exige vínculoativo; Auth permanece |
| Downgrade | preservar registros e negar não-owner | resolver Free e helper nega; vínculos podem continuar active armazenados |
| Anonymous/operador/outra empresa gerenciar | negar sem mutação | grants/RPC revalidam identidade, alvo, tenant, papel e versão antes UPDATE |
| Magnata | não ativar | estado persistido/confirm exigem intermediate; enum não libera advanced |

## Achados de equipe e criticidade

### Alta — quota não cobre reativação/alteração de papel

Hardening20261015140000:171–176 e225–227 atualiza role/status sem contar quota. Trigger26000000:69–87 é só INSERT. Owner tem remediação members.* mesmo Free/seleção/excesso (26060000:15–17). Logo reativação ou admin->operator viola composição mesmo sequencialmente. Lock existente não substitui validação ausente. Free ainda nega acesso empresarial ao membro: não confundir registro active indevido com autorização operacional.

### Alta — admin adicional permanece criável e operacional

provisioning.ts:15,194–197,223–226 aceita admin; SQL original:178–179,267–273,522–528,665–675 aceita/cria. Guard26000000:75 retorna imediatamente para nãooperator;26060000:29–31 conta apenasoperators, e73–79 preserva admin operacional pago. Não é só legado passivo. Recomenda-se definir política explícita para legados e impedir nova expansão sem remover automaticamente registros/permissões aprovadas.

### Média — pending sem expiração e recuperação parcial

Start reserva pending; trigger soma pendências sem TTL (26000000:80). Falhas Auth em provisioning.ts:260–275 não liberam operação. Finish rejeitado preserva conta Auth e operação para revisão (278–292). Não excluir conta cegamente é prudente, mas não garante inexistência de órfãos. Resultado inválido de start vira technical; branch270–271 perde operationId conhecido. Requer reconciliação auditada e recuperação por ator/empresa.

### Média — owner único não é constraint

Tabela core:106–113 garante somente UNIQUE(enterprise_id,user_id). RPCs não promovem owner e protegem existentes; não há exploit authenticated identificado. Escritas privilegiadas/futuros imports podem criar múltiplos/zero owners. Índice parcial para máximo1 não resolve sozinho mínimo1 nem saneamento de legados.

### Interação de provisionamento com onboarding público

Auth parcial é confirmada com app_metadata da operação (provisioning.ts:260–262). completePublicOnboardingAction:47–69 aceita no_active_internal_identity, e complete_public_onboarding:95–123 lê conta/e-mail confirmado sem consultar marca de provisionamento. Há lacuna estática de separação dos fluxos quando onboarding público habilitado: conta pendente pode entrar no fluxo público; reproduzir com usuário descartável e checar conflito na retomada. Não há evidência de acesso à empresa original ou elevação nessa empresa.

### Baixa/média — UX/erros/limite de tentativas

EmployeeProvisioningForm:59 recarrega URL com operationId, mantendo terminal ao clicar cadastrar outro. Erros PlanAccessError e negação de papel perdem semântica em provisioning/actions. Rate limit em Map local e x-forwarded-for é best-effort, não coordena instâncias; spoof depende proxy. Não identificado vazamento explícito de senha/service-key nos logs/retornos: logs usam códigos e paths, senha só vai Auth, replaycompleted não redefine senha. Observabilidade externa não auditada.

## Ordem recomendada (não implementada)

1. Validar SQL standalone em desenvolvimento e reproduzir caminho HTTP/ator V3; corrigir exclusivamente defeito de autorização confirmado por esse teste, com migration incremental futura, sem reescrever aplicadas.
2. Testes negativos transacionais de reativação/papel/admin, inclusive ação direta fora da UI e duas conexões. Corrigir guard em transições que aumentam consumo, respeitando locks/reservas e permitindo desativação/remediação.
3. Alinhar criação admin à composição aprovada e decidir tratamento explícito de admins legados, sem exclusão automática ou ampliação de privilégios.
4. Reconciliação de pending/Auth parcial, incluindo mudança de plano/papel entre start/createAuth/finish e bloqueio da colisão com onboarding público.
5. Auditar legados antes de invariante de owner; corrigir recuperação/operationId/erros e navegação.
6. Executar navegador e testes reais de concorrência; só então avaliar fechamento da etapa6. Não há evidências suficientes para declará-la concluída.
