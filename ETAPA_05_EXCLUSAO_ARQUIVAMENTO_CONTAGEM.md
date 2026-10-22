# Etapa 5 — Exclusão, arquivamento e contagem

> **Estado:** implementação local preparada; migration e assertions SQL **não executadas**. Não houve SQL remoto, `db push`, reset, deploy, commit ou alteração de plano/cota.

## Estados e transições

Os três domínios — produtos internos, carretéis e materiais gerais — têm dois estados independentes:

- **Ativo:** disponível para as operações normais.
- **Arquivado (`active = false`):** preservado, continua na contagem e pode ser restaurado pelo fluxo administrativo já existente.
- **Excluído logicamente (`deleted_at`, `deleted_by`):** linha, ID, movimentos, referências de custo, snapshots e aplicações são preservados; o cadastro deixa de participar de seletores e operações. Não há restauração de excluído nesta etapa e o fluxo comum de desarquivamento deve rejeitá-lo.

Nenhuma exclusão faz `DELETE` físico ou libera nome/identificador: as constraints de unicidade existentes continuam se aplicando inclusive a registros arquivados/excluídos.

## Elegibilidade e autorização

A exclusão revalida contexto, empresa e papel, bloqueia a linha e exige `expected_version` válido (inclusive `0`).

- Produto: posição ausente vale saldo zero no modelo atual; qualquer posição com saldo diferente de zero impede a exclusão.
- Carretel: `current_balance_grams = 0`.
- Material geral: `current_balance = 0`.
- Histórico de ledger, custo, snapshot ou aplicação de preço isoladamente não impede exclusão.
- Não foram encontradas tabelas de reservas nem operações pendentes no domínio novo. Não foram criadas tabelas fictícias: a migration deixa o ponto explícito para guards transacionais quando esses módulos forem introduzidos.
- Produto usa `products.delete`; foram adicionadas permissões específicas `spools.delete` e `stock.materials.delete`, concedidas apenas a owner/admin. Operator não pode excluir.

## Contrato, concorrência e idempotência

Cada RPC de exclusão recebe `attempt_id`, ID e versão esperada. O recibo privado por empresa, ator, tentativa e entidade guarda payload e resultado:

- repetição com o mesmo payload retorna o resultado persistido sem alterar auditoria ou versão;
- reutilização da tentativa com payload distinto retorna `idempotency_conflict`;
- resultado após despacho que não pôde ser interpretado é `uncertain`, para repetição com a mesma tentativa;
- versão antiga retorna `version_conflict`.

A exclusão usa o mesmo contexto bloqueado antes da linha do domínio. Mutações e entradas de estoque precisam rejeitar a marca de exclusão mesmo se não houver posição prévia; detalhes/históricos continuam autorizados conforme os fluxos existentes.

## Contagem autoritativa para a etapa 6

`get_my_deletion_counts()` deriva a empresa do contexto autenticado, numa única consulta estável, e retorna:

- `products`: produtos internos com `deleted_at IS NULL`, ativos ou arquivados;
- `filament_spools`: carretéis com `deleted_at IS NULL`, ativos ou arquivados;
- `general_materials`: materiais gerais com `deleted_at IS NULL`, ativos ou arquivados;
- `shared_material_registrations`: soma de carretéis e materiais gerais.

Não conta `public.materials` (materiais FDM de referência), unidades, movimentos, posições de estoque ou relações de material. Saldo zero e arquivamento continuam contando; exclusão reduz a contagem.

Essa consulta é uma leitura para a futura etapa 6, **não** enforcement de cota. A futura criação limitada deve testar a cota na mesma transação que cria o cadastro.

## Caminhos operacionais

Foram preparados guards/filtros para edição, movimentação, criação de posição de estoque, seletores da precificadora, salvamento e aplicação de preço. Os registros excluídos não voltam por desarquivamento. Consultas de histórico e snapshots antigos permanecem legíveis sem reintroduzir os registros em seletores operacionais.

O produto é compartilhado com recursos públicos legados; a exclusão lógica não altera `active` nem remove automaticamente um produto público. A visibilidade pública deve continuar obedecendo ao contrato legado e ser revisada separadamente antes de qualquer mudança de catálogo.

## Interface

As telas administrativas apropriadas recebem exclusão com confirmação explícita: indisponibilidade operacional, preservação de histórico, liberação da vaga de contagem e inexistência de restauração comum. Falha por saldo, alteração concorrente, permissão ou resultado incerto tem estado próprio. Sucesso retorna à rota válida e revalida listas/contagem.

## Migration e testes

- Migration incremental: `supabase/migrations/20261024000000_stage5_deletion_counts.sql`.
- Assertions preparadas: `tests/sql/20261024000000_stage5_assertions.sql`.

As assertions devem ser executadas **somente** em banco local isolado após aplicar migrations sequencialmente. Elas cobrem contagem (ativo, arquivado, saldo zero, exclusão, compartilhada, material FDM e posição ausente), saldo, histórico, tenant, papel, versão, replay, payload conflitante, guards operacionais e concorrência. Elas não foram executadas neste ambiente.

## Pendências e etapa 6

- Não há planos, assinatura, limite comercial, bloqueio por cota, pedidos, reservas, fabricação, entrega ou cobrança nesta etapa.
- A validação funcional completa de salvamento, histórico e aplicação de preço da etapa 4 continua **pendente de confirmação do usuário**; não é declarada concluída aqui.
- Reservas/operações pendentes devem acrescentar suas próprias verificações transacionais de elegibilidade antes de permitirem exclusão.
- A etapa 6 deve usar a contagem como base, mas aplicar o limite atomically com cada criação.
