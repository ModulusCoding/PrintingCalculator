# Etapa 02 — Carretéis completos — revisão final

## Resultado

A interface está concluída para o contrato aprovado: criação sem `material_id`, edição do perfil próprio, listagem e detalhe. Novos carretéis usam `internal_identifier`, `material_type`, `brand` e `color`; carretéis legados podem continuar com `material_id` e campos próprios nulos quando não houver dado seguro para preencher.

Nenhum material oculto é criado. A precificadora continua usando `materials`; sua integração com carretéis permanece fora desta etapa. PRC-001 não foi alterado.

## Permissão efetiva da edição

A migration anterior de carretéis (`20261017000000_fdm_filament_spools.sql`) define `update_filament_spool_identity` com `private.lock_filament_spool_context('spools.archive')`. A mesma migration define `spools.write` para owner/admin/operator e `spools.archive` para owner/admin. Portanto, editar identificação já era uma operação administrativa, enquanto movimentar era permitido ao operador.

A edição de perfil mantém `spools.archive`, tanto na Server Action `updateSpoolProfile` quanto na RPC `update_filament_spool_profile`. A interface só mostra esse controle quando `canArchive` (owner/admin). Isso não amplia privilégios nem bloqueia uma capacidade previamente concedida; preserva exatamente a regra existente para identificação e estende o mesmo contrato aos novos atributos de perfil.

A função legada `update_filament_spool_identity` continua existindo na migration anterior e continua recebendo grant para `authenticated`; a action local deixou de usá-la, pois o perfil novo atualiza identificação, tipo, marca e cor atomicamente. Não foi removida: consumidores externos ou instalações anteriores podem depender dela. Ela mantém empresa, `FOR UPDATE`, versão, identificador único e `spools.archive`.

## Backfill e constraints

A migration incremental adiciona `material_type`, `brand`, `color` e `create_profile`, torna `material_id` nullable e preserva a FK composta para referências antigas não nulas. O backfill:

- usa `COALESCE` para não sobrescrever atributo próprio já existente;
- aplica `btrim` e `NULLIF(..., '')` aos valores legados, inclusive opcionais;
- não inventa dados nem trunca silenciosamente;
- mantém valores fora do limite detectáveis pelo constraint e aborta atomicamente se houver incompatibilidade; o diagnóstico deve apontar a coluna/material incompatível antes da aplicação;
- preserva IDs, empresa, saldos, peso, preço, versões, timestamps, custos e ledger;
- desabilita apenas `filament_spools_touch` durante o backfill e o reabilita antes do commit.

Os limites atuais dos campos antigos são compatíveis: `materials.material_type` até 80, `brand` até 120 e `color` até 80. Valores vazios são normalizados para `NULL`. Valores ausentes permanecem `NULL` em carretéis legados; novos cadastros exigem tipo.

## Concorrência e idempotência

`private.lock_filament_spool_context('spools.write')`, da migration anterior, adquire o advisory lock global de gerenciamento e o lock por ator, além de revalidar identidade, membership e empresa. A tabela possui `UNIQUE(enterprise_id, actor_id, create_attempt_id)` e `UNIQUE(enterprise_id, internal_identifier)`.

Assim:

- mesma empresa/ator/tentativa/payload: a segunda chamada espera o lock, encontra a criação e retorna `idempotent`;
- mesma tentativa com payload diferente: encontra `create_profile` diferente e retorna `idempotency_conflict`;
- tentativas diferentes com mesmo identificador: o primeiro commit vence e a segunda retorna `identifier_conflict` pela verificação/constraint;
- resposta perdida após commit: a repetição usa o mesmo `attempt_id`, recupera a linha e retorna idempotente;
- empresas diferentes não compartilham a chave composta nem o contexto de acesso.

A Server Action mantém códigos conhecidos separados: `identifier_conflict` e `idempotency_conflict` não são colapsados. Erros desconhecidos após dispatch retornam `uncertain`, mantendo o payload congelado na interface.

## Triggers, histórico e retentativas

- Perfil não insere movimento e não recalcula custos.
- Peso original, preço de compra, payload inicial e campos estruturais permanecem imutáveis no trigger.
- `create_profile` representa o payload original e não muda quando o perfil é editado.
- Backfill não atualiza `version`/`updated_at` porque o trigger é desabilitado apenas durante a atualização controlada.
- A transação da migration (`BEGIN`/`COMMIT`) torna a aplicação atômica; falha provoca rollback.
- Snapshots de precificação e movimentos anteriores não são recalculados.

## Correções realizadas nesta revisão

- Normalização explícita de atributos legados opcionais vazios para `NULL`.
- Conferência e documentação da permissão `spools.archive`, mantendo a matriz anterior.
- Conferência do overload legado e preservação de `update_filament_spool_identity`.
- Ajuste da documentação para refletir a proteção concorrente real e o destino das funções antigas.

## Pontos conferidos sem alteração

- Isolamento por `enterprise_id` e FK composta legada.
- Ledger, locks, saldo, capacidade, custos históricos e versão.
- Retry da criação com o mesmo payload/UUID após resultado incerto.
- Arquivamento/restauração e alertas de estoque.
- `get_my_access_context` e matriz de papéis.
- Snapshots e contratos atuais da precificadora.

## Verificações executadas

- Inspeção final do diff, status Git, migrations antecedentes, RPCs, grants, helpers, actions, schemas e telas.
- Lint restrito aos arquivos de carretéis: passou.
- `npx tsc --noEmit`: passou.
- `git diff --check`: sem erros; o Git apenas informa conversão LF/CRLF no Windows.
- `npm run lint`: falha globalmente com erros/avisos em calculadoras e componentes legados; não foram identificados erros adicionais nos arquivos de carretéis na execução restrita.
- Não foi executado `build` nem testes SQL: não há script de testes no `package.json` e a migration não foi aplicada a banco local/remoto.

## Estado da migration e roteiro manual

`20261021000000_complete_filament_spools.sql` continua untracked e não há registro local de aplicação/distribuição. Isso não prova o estado remoto; apenas confirma que ela não foi aplicada por esta sessão. Não foi executado SQL remoto, `db push`, reset ou migration compartilhada.

Para desenvolvimento local isolado:

1. confirmar migrations antecedentes e destino do banco;
2. executar a migration manualmente;
3. verificar schema, constraints, trigger habilitado, versões/timestamps e backfill;
4. criar sem `material_id`, repetir tentativa igual e diferente;
5. testar identificadores concorrentes, isolamento entre empresas, edição com versão atual/antiga, movimentação e custo histórico;
6. conferir carretéis legados incompletos e snapshots antigos.

A etapa está pronta para o usuário aplicar e testar no desenvolvimento, mas **não está funcionalmente validada** até a execução real da migration e dos cenários de banco.

## Fora do escopo e dependências

Materiais gerais, integração com precificadora, perda, embalagens, pedidos, planos, cotas, cobrança, dashboard, exclusão para liberar vagas e correção do PRC-001 permanecem para etapas posteriores.
