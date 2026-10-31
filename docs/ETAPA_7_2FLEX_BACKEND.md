# M7.2-D.3 FLEX — backend candidato

## Estado e aplicação

Migration única: `supabase/migrations/20261027120000_orders_stage72flex_delivery_cycles.sql`.
Preparada localmente; **não aplicada e não homologada em PostgreSQL**. Nenhum contrato financeiro, migration histórica ou frontend foi alterado nesta execução.

### Tentativa de homologação local — 27/10/2026

**Parecer: HOMOLOGAÇÃO PARCIAL, bloqueada antes da instalação do banco. Não liberar aplicação.**

- `psql`, `postgres`, `initdb`, `pg_config` e Supabase CLI não encontrados no PATH. A pasta `C:\Program Files\PostgreSQL\16` contém apenas `data`, sem binários; não foi reutilizada ou alterada.
- Docker CLI/Engine 29.7.2, Docker Desktop 4.86.0 e Compose 5.3.1 disponíveis. O Desktop foi iniciado com `docker desktop start`.
- Existia `modulus-postgres`, parado havia três semanas. Não foi iniciado, acessado, removido nem reutilizado.
- `docker pull supabase/postgres:17.6.1.063` falhou em `/var/lib/desktop-containerd/.../data` com `read-only file system`.
- A alternativa com imagem `postgres:17` já em cache, nome exclusivo `modulus-flex-homolog-20261027`, dados em tmpfs e porta loopback 55473 também falhou **antes de criar o container**, ao gravar `io.containerd.metadata.v1.bolt/meta.db`: `read-only file system`.
- Nenhuma migration histórica ou FLEX foi executada. Não existe versão de servidor PostgreSQL ou lista de extensões instaladas a reportar nesta tentativa. A versão 17.6 da imagem escolhida é alvo, não evidência de execução.
- Não houve limpeza global, reparo do armazenamento Docker, remoção de volumes nem uso de credenciais remotas. O Docker Desktop iniciado não foi encerrado para não afetar outros trabalhos.

Correção confirmada: U+FEFF embutido na linha 1150, antes de `deliver_order`, removido. Decodificação UTF-8 estrita e varredura de controles invisíveis adicionadas ao teste estático; nenhum outro caractere dessa classe foi encontrado. Não houve mudança comercial ou segunda migration.

| Grupo | Resultado / evidência |
|---|---|
| UTF-8, BOM e controles invisíveis | Aprovado em teste de bytes/fonte |
| Suite estática FLEX | 11 testes aprovados, 0 falhas; não interpreta SQL |
| `git diff --check` | Sem erro de whitespace; avisos existentes LF/CRLF |
| Instalação histórica e FLEX, COMMIT/rollback de instalação, reinstalação limpa | Não executados — armazenamento Docker somente leitura |
| Transições, primeira entrega, undo, compensação, nova alocação, preservação/D4 | Não executados em PostgreSQL |
| Untracked, mistos, produto repetido, cancelamento, reabertura e downgrade | Não executados em PostgreSQL |
| Replay histórico de todas as RPCs e regressão C.4/D.1 | Não executados em PostgreSQL |
| Concorrência e falhas injetadas intermediárias | Não executadas |
| FKs cruzadas, imutabilidade, ACL/RLS, SECURITY DEFINER e isolamento instalados | Não executados; verificações de fonte não comprovam privilégios efetivos |
| Saldos/reservas/movimentos/settlements/manifestos/compensações/recibos | Sem dados locais de teste; nenhuma conclusão de integridade runtime |

#### Reprodução após correção da infraestrutura

O repositório não contém `supabase/config.toml` nem Compose local, e não fixa versão oficial do PostgreSQL/stack; a imagem 17.6 escolhida não prova equivalência. Não improvisar tabelas Auth/Storage para fazer as migrations passarem. A estratégia em `docs/architecture/products-multitenancy-plan.md` separa a trilha SaaS das sete migrations legadas anteriores ao core de 02/10/2026: carregar todas indiscriminadamente causa conflito com o preflight de `20261015150000_internal_products_multitenancy.sql`. Usar a cadeia SaaS de `20261002000000_create_auth_tenancy_core.sql` até FLEX (55 arquivos, incluindo FLEX), preservando os arquivos originais. Usar Supabase CLI oficial em diretório temporário novo, sem vínculo remoto. O operador deve resolver o armazenamento Docker somente leitura fora desta homologação, sem apagar dados de outros projetos. Não executar `link`, `db push`, `--linked` ou `--db-url` remoto.

Exemplo PowerShell (requer Supabase CLI instalada; ajustar portas exclusivamente no config temporário se houver conflito):

```powershell
$repo = (Get-Location).Path
$test = Join-Path $env:LOCALAPPDATA ('Temp\opencode\flex-homolog-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $test | Out-Null
supabase init --workdir $test
# Conferir database.major_version=17 e portas livres no config temporário.
$dest = Join-Path $test 'supabase\migrations'
New-Item -ItemType Directory -Path $dest -Force | Out-Null
# Trilha SaaS atual: NÃO copiar as sete migrations legadas anteriores ao core.
Get-ChildItem "$repo\supabase\migrations\*.sql" |
  Where-Object { $_.Name -ge '20261002000000_create_auth_tenancy_core.sql' -and
    $_.Name -lt '20261027120000_orders_stage72flex_delivery_cycles.sql' } |
  Sort-Object Name | Copy-Item -Destination $dest
supabase start --workdir $test
supabase db reset --local --workdir $test
# Parar aqui em QUALQUER falha. Não editar migrations históricas nem ignorar erros.
```

Registrar a versão real via `SELECT version()`, extensões via `pg_extension`, hashes dos arquivos e catálogo de referência. Antes da FLEX, criar fixtures históricas autorizadas para testar backfill e guardar recibos antigos. Aplicar então **o arquivo FLEX completo** usando o `psql` do container DB exclusivo, com `-X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose` e `-f`; `docker cp` pode transportar o arquivo sem mudar codificação. Não usar `--single-transaction` para mascarar a transação declarada no arquivo. Registrar SQLSTATE, saída/exit code e inspecionar catálogo/dados, não apenas `CREATE FUNCTION`.

Executar o roteiro manual existente com empresas/usuários reais locais; provisionamento confiável é separado dos comandos de negócio, que devem rodar como `authenticated` com contexto `business_ready`. Não usar `service_role` como substituto desse contexto. Repetir tudo em **outro diretório/stack descartável limpo**, com toda a cadeia histórica seguida da FLEX, para comprovar instalação sem reparos manuais. Esses comandos são procedimento pendente, não evidência de aprovação.

Antes de aplicar manualmente no Supabase **de desenvolvimento**:
1. Fazer backup e confirmar a cadeia A → B/B.1 → C.1/C.2 → event UUID → C.3 → C.4 → D.1 instalada e comparar as definições efetivas do catálogo com os arquivos locais. A existência dos arquivos não prova compatibilidade remota.
2. Executar primeiro em ambiente PostgreSQL descartável equivalente, com roles/autenticação reais e fixtures de duas empresas. Executar a matriz em `supabase/tests/orders_stage72flex_scenarios_manual.md`, incluindo concorrência e rollback.
3. Revisar SQL, ACLs e resultados. Somente após homologação, aplicar **o arquivo inteiro**, preservando `BEGIN`/`COMMIT`, pelo processo manual de migrations do projeto. Não executar trechos nem marcar como aplicada antes do commit.
4. Qualquer erro de preflight/backfill deve interromper a aplicação. Investigar a evidência; não desativar guardas ou fabricar vínculos para forçar sucesso. Após erro, fazer rollback da sessão antes de nova tentativa.

## Modelo e invariantes

- `order_delivery_manifest`: snapshot imutável por confirmação/item. Stock aponta para settlement próprio ou manifesto original herdado; untracked possui confirmação explícita sem movimento. Não referencia o item vivo por FK: edição posterior de itens exclusivamente untracked não destrói replay histórico.
- `order_delivery_undos`: saída única por confirmação, vinculada aos dois eventos, destino, classificação e tentativa.
- `order_delivery_compensations`: compensação integral única por settlement, movimento original e movimento positivo; vinculada ao undo autorizador.
- FKs empresariais, RLS sem policies, revogações de acesso direto, índices e triggers append-only. Novo FK de settlement para evento de entrega da mesma empresa/pedido.
- Helpers privados validam manifesto, recibo, reserva consumida, saída, continuidade de versões/saldos e compensações. Cobertura reutilizável exige saída original `actual_delivery`, identidade integral e ausência de compensação.

Backfill somente para entregas antigas ainda terminais, únicas, com itens demonstravelmente não alterados, recibo/hash original e cadeia física completa. Histórico divergente ou não comprovável aborta a transação. Não são criados movimentos nem eventos retroativos. Esta política conservadora pode exigir reconciliação administrativa antes da instalação.

## Comandos

Assinaturas anteriores preservadas em `transition_order`, `allocate_order_stock`, `cancel_order`, `reopen_order` e `deliver_order`.

- Transição: qualquer par distinto entre em_conversao/orcado/pago/modelando/imprimindo. Apenas retrocesso pela ordem exige motivo; avanço aceita motivo opcional válido. Replay retorna evidência histórica sem aplicar a nova matriz.
- Entrega: untracked sem movimento; reserva integral atual é consumida; cobertura real preservada é herdada sem nova baixa. Make-to-order sem alocação bloqueia. Replay usa snapshot da operação, não totais físicos atuais do pedido.
- Alocação: nova reserva integral com nova identidade, plano pago e disponibilidade; permite histórico finalizado comprovado, mas não item já coberto ou com reserva ativa.
- Cancelamento: mantém `sales.delete`, libera apenas reservas atuais e não compensa inventário. Exige sair de Entregue pela RPC própria.
- Reabertura: mantém `sales.write`; preserva cobertura e não reserva novamente itens cobertos. Obrigações descobertas seguem plano/eligibilidade/disponibilidade; não reativa reservas antigas.
- Pago continua operacional: não gera pagamento. C.4 permanece independente, compartilhando a versão do pedido.

### `undo_order_delivery`

Argumentos, nesta ordem:

```text
p_attempt_id uuid, p_order_id uuid, p_expected_version bigint,
p_delivery_event_id uuid, p_target_status text, p_reason text,
p_classification text
```

Exige contexto business_ready e `sales.write`. Destino comum; motivo aparado com 1–1.000 caracteres. Hash inclui todos os parâmetros brutos. Pedido deve estar entregue, versão atual e confirmação vigente sem saída prévia.

Retorno: `status='delivery_undone'`, `order_id`, `operational_status`, `version`, `event_id`, `source_delivery_event_id`, `physical_effect`.

| Classificação | Efeito |
|---|---|
| `incorrect_record`, baixa própria | `compensated`: entrada integral comprovada somada ao saldo **atual**; reservado permanece inalterado |
| `actual_delivery`, cobertura física | `preserved`: nenhuma movimentação |
| Qualquer classificação, legitimamente sem baixa | `no_physical_movement`: nenhum crédito inventado |

`incorrect_record` sobre confirmação com qualquer cobertura herdada bloqueia com `delivery_reconciliation_required` (D4). Não existe RPC genérica de reconciliação. Após compensação, entrega exige reserva nova integral explícita. Correção comprovada após downgrade não concede acesso geral ao inventário. Motivo integral fica no evento; ledger usa referência curta à operação.

### Leitura física

`get_order_physical_state(p_order_id uuid)`, com `sales.read`, retorna uma linha por item atual:

- `order_id`, `order_version`, `order_item_id`, `product_id`, `quantity`, `fulfillment_mode`;
- `physical_state`: `untracked`, `valid_debit`, `allocated`, `compensated`, `allocation_required` ou `reconciliation_required`;
- `requires_allocation`, `active_reservation_id`, `settlement_id`;
- `source_delivery_event_id` (baixa original), `current_delivery_event_id` (confirmação vigente, apenas em Entregue);
- `can_undo_as_incorrect`: elegibilidade física da confirmação inteira, não autorização final; o comando revalida versão, identidade e permissões.

`compensated` indica histórico compensado **e obrigação atualmente descoberta**. Após nova alocação, o estado é `allocated`. O endpoint não é extrato histórico completo. `reconciliation_required` nunca autoriza mutação nem substitui a validação dos comandos.

## Validação e riscos

Executar: `node --test supabase/tests/orders_stage72flex_static.mjs` (Node built-ins, sem dependências novas).
Esses testes inspecionam código-fonte: **não compilam SQL nem executam PL/pgSQL**. PostgreSQL/psql/initdb indisponíveis; na tentativa de homologação o Docker foi iniciado, mas seu armazenamento interno somente leitura impediu criar um banco. Sintaxe efetiva, runtime, ACL/RLS instaladas, fixtures históricas, concorrência, rollback e todos os fluxos comerciais continuam pendentes de testes reais.

A migration adquire o mutex global já usado pelo sistema e locks de instalação; prever janela de manutenção. Comandos mantêm hierarquia pedido → todos os produtos ordenados → todas as posições ordenadas → reservas. O leitor também mantém o protocolo global existente; não foi introduzido um redesenho de concorrência. Validação integral repetida de históricos pode aumentar custo em pedidos com muitos ciclos: medir planos e latência na homologação.

## Integração posterior D.3a

1. Trocar matriz restritiva do cliente pela ordenação comum; pedir motivo apenas no retrocesso.
2. Manter ações especiais separadas. Saída de Entregue deve consultar estado físico, exigir classificação e confirmação explícita.
3. Usar `order_version` e evento vigente; preservar payload/attempt em resposta perdida. Conflito de versão exige recarregar, não repetir com versão alterada no mesmo attempt.
4. Expor alocação explícita quando descoberta; nunca simular entrega física com transição comum. Tratar D4 e reconciliação como bloqueios.
5. Invalidar detalhes/lista/Kanban/leitura física após sucesso; manter financeiro independente. Nenhuma dessas mudanças visuais foi implementada aqui.
