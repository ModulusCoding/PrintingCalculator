# Equipe: SQL Editor DEV, concorrência e legado

## Limites e segurança

**Não executado em banco nem em duas conexões nesta implementação.** A suíte `20261026120000_team_capacity_sql_editor.sql` é standalone, sem metacomandos psql; executar inteira como postgres, somente DEV com migrations até 20261026120000. Nunca trocar seu `ROLLBACK` por `COMMIT`. Ela usa UUIDs próprios, claims locais e chamadas sob os papéis reais `service_role`/`authenticated`, insere contas `auth.users` transacionais próprias sem senha e não chama Auth/API/email. Há locks, carga e WAL temporários. Em erro executar `ROLLBACK`, registrar SQLSTATE/linha sem segredos. Não desabilitar triggers, alterar guard, conceder priviléggios ou reutilizar tenant/conta real para passar testes.

Ela cobre primeira reserva e finalização consumindo a própria reserva, segundo operador negado (pending e active), Free, novo admin, promoção, reativação paga/Free, registros preservados no downgrade/acesso revogado, finish/resume idempotentes, ator de outro tenant e RPC de membro com alvo externo/ator inativo. Inclui INSERT direto que não pode consumir a reserva alheia e finish após downgrade de reserva pending, sem resíduos de usuário/identidade e mantendo a reserva pending. Assertions de quota comparam **SQLSTATE P0001 + MESSAGE_TEXT exatamente `team_limit_reached`**; demais negações comparam SQLSTATE ou status exato. Snapshot inclui membros/operações próprios e **todas** as linhas de `public.users` e `public.auth_identities`, para detectar órfãos sem membership; esse JSON fica interno, nunca é impresso. Executar em DEV sem escritas concorrentes não relacionadas (podem causar falso negativo no snapshot). Não prova transporte HTTP, browser ou isolamento entre duas conexões.

## Duas conexões reais: reserva versus reserva

Duas abas do SQL Editor podem usar conexões diferentes entre execuções; não assumir afinidade de conexão nem que um `BEGIN` sobreviva ao próximo clique. Preferir duas conexões SQL persistentes ao banco DEV. Se o editor não preservar transações e sessão, usar cliente SQL gráfico com duas conexões (não simular com duas chamadas sequenciais). Confirmar `pg_backend_pid()` distinto e estável. Timeout por bloqueio **não é** prova da quota após commit.

Este procedimento separado precisa de fixture **commitada** para ser visível à outra conexão; ao contrário da suíte rollback-only, deixa dados se interrompido. Usar banco DEV descartável, registrar todos os UUIDs antes do commit e executar limpeza mesmo se houver falha. Não executar nenhum teste de concorrência com tenants preexistentes.

1. Na conexão A, copiar somente o bootstrap da suíte: do `BEGIN` até a criação de `_team_result`, parando **antes do primeiro `DO` de cenários**. Conferir que somente fixtures novas foram criadas. Executar `SELECT k,id FROM _team_ids; SELECT pg_temp.issuer(); SELECT pg_backend_pid();` e guardar os valores. Neste procedimento separado, finalizar bootstrap com `COMMIT`. Não executar o restante da suíte nesta transação.
2. Na conexão A persistente, iniciar e reservar sem commit:

   ```sql
   BEGIN;
   SET LOCAL lock_timeout='10s';
   SET LOCAL statement_timeout='120s';
   SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
   SELECT pg_temp.rpc(pg_temp.start_sql('owner_a','race-a'));
   -- Esperado pending; manter transação ABERTA.
   ```

3. Na conexão B, substituir `<OWNER_A_UUID>`, `<ISSUER>` e `<UNIQUE_EMAIL_B>` pelos dados próprios registrados. Email B deve ser distinto de todos os outros e usar `example.test`.

   ```sql
   BEGIN;
   SET LOCAL lock_timeout='90s';
   SET LOCAL statement_timeout='120s';
   SET LOCAL ROLE service_role;
   SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
   SELECT * FROM public.start_employee_provisioning(
     '<OWNER_A_UUID>'::uuid,'<ISSUER>',
     '<UNIQUE_EMAIL_B>','Concurrency B','operator');
   ```

   A chamada B deve **esperar** enquanto A mantém locks. Pode esperar primeiro no lock de ator/identidade/empresa, não necessariamente no advisory de quota. Isso ainda é serialização real.
4. Enquanto B espera, executar `COMMIT` em A. B deve então falhar com **P0001 / team_limit_reached**, pois agora enxerga a reserva pending commitada. Executar `ROLLBACK` em B. Se B expirar antes do commit A, o teste é inconclusivo, não aprovado.
5. Como postgres, A verifica exatamente uma operação pending/operator no tenant próprio e zero operadores active; nenhuma operação para email B. Nunca contar dados globais.
6. Variante independente: limpar somente a operação `race-a` de fixture, repetir A/B, mas executar **ROLLBACK em A** no passo 4. B deve prosseguir e retornar `pending` (vaga liberada); registrar resultado e **ROLLBACK em B**. Nesse caso nenhuma reserva da corrida deve permanecer. Esta variante distingue release de lock de validação sobre estado commitado.
7. Limpeza na conexão A (mesma sessão do bootstrap):

   ```sql
   BEGIN;
   DELETE FROM private.employee_provisioning_operations
    WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'),pg_temp.f('free'));
   DELETE FROM public.enterprise_members
    WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'),pg_temp.f('free'));
   DELETE FROM public.auth_identities
    WHERE user_id IN (pg_temp.f('owner_a'),pg_temp.f('owner_b'),pg_temp.f('owner_free'),pg_temp.f('spare'),pg_temp.f('direct_user'));
   DELETE FROM public.users
    WHERE id IN (pg_temp.f('owner_a'),pg_temp.f('owner_b'),pg_temp.f('owner_free'),pg_temp.f('spare'),pg_temp.f('direct_user'));
   DELETE FROM public.enterprise_plan_access
    WHERE enterprise_id IN (pg_temp.f('a'),pg_temp.f('b'),pg_temp.f('free'));
   DELETE FROM public.enterprises
    WHERE id IN (pg_temp.f('a'),pg_temp.f('b'),pg_temp.f('free'));
   DELETE FROM private.auth_issuer_config WHERE issuer=pg_temp.issuer();
   COMMIT;
   ```

   O bootstrap não insere `auth.users` e esta corrida não chama finish. Se a conexão A se perder, usar **somente UUIDs registrados** na limpeza; não procurar/apagar por prefixos amplos. Não executar limpeza acima após cenários de finalização: há outros FKs e contas Auth e seria outro procedimento.

## Legado: preservação e admin → operator com quota cheia

O guard novo deliberadamente impede inserir admin, inclusive como postgres. Portanto não é possível fabricar admin legado numa suíte **pós-migration**, sem burlar a proteção. Não usar `DISABLE TRIGGER`, `session_replication_role`, redefinição temporária da função ou gravações em tenants reais. Os dois cenários seguintes são **pendentes e separados**, não aprovados pela mensagem PASS do standalone.

Em clone DEV descartável ainda na migration 20261026110000:

1. Criar fixture própria de empresa paga, owner, admin legado ativo e operador ativo (um); identidades/issuer próprios e owner sem obrigação de senha. Guard antigo permite essa composição. Guardar UUIDs e snapshots completos de todos os membros/usuários/operações.
2. Commitar apenas essa fixture, aplicar normalmente 20261026120000 nesse clone. Comparar snapshots: **roles/status/IDs não mudaram** pela migration. Não exigir igualdade de tabelas de catálogo/migration.
3. Abrir `BEGIN`, JWT authenticated do owner fixture, invocar `update_my_enterprise_member(admin_membership_id, nome_atual, 'admin', version_atual, nome_atual)`: esperado `success`, preservando papel admin (version pode incrementar conforme RPC). Edição do nome sem mudança de papel também deve continuar permitida conforme autorização anterior.
4. **Contrato final da migration (`operator_increases` antes do early return):** admin ativo → operator ativo não aumenta o total de vagas, mas só é permitido quando **operadores ativos + reservas pending/operator < limite**. Com o operador existente ativo, esperar **SQLSTATE P0001 e MESSAGE_TEXT exatamente `team_limit_reached`**, sem mudança de nome/papel/version/updated_at nem resíduos em usuários/identidades. Usar SAVEPOINT/ROLLBACK TO SAVEPOINT para recuperar da exceção. Desativar o operador existente e repetir admin ativo → operator: esperado `success` no pago. No Free (limite zero), a conversão deve continuar negada mesmo sem outro operador. Voltar ao snapshot legado via `ROLLBACK TO SAVEPOINT`, não por promoção, que é proibida.
5. Desativar somente o admin legado via RPC: esperado `success`. Trocar admin **inativo** → operator inativo: esperado `success` (não aumenta consumo). Agora reativar esse operator com o outro operador ativo: esperado **P0001 / team_limit_reached**. Usar SAVEPOINT/ROLLBACK TO SAVEPOINT para a exceção; comparar linhas completas do membro **e pessoa** antes/depois, incluindo nome/version/updated_at. Variante: manter papel admin inativo e tentar reativar: mesma negação exata. Desativar o operador ativo e repetir a reativação com vaga livre: `success`. Promoção de operator para admin deve falhar **42501**, sem mutação.
6. `ROLLBACK` dos cenários. Descartar o clone (ou limpar somente fixtures previamente registradas em ordem de FK). Nunca reaplicar/voltar migrations num projeto compartilhado para fabricar legado.

Registrar evidência de execução (ambiente DEV, migration, backend PIDs, resultados, SQLSTATE e limpeza), sem tokens/emails reais. Somente depois classificar os cenários legado/concorrência como executados.
