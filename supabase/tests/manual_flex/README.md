# FLEX — homologação manual em projeto Supabase descartável

**PREPARADO, NÃO EXECUTADO.** Este diretório não homologa a migration por sua existência nem pelos testes Node. Nesta execução não houve SQL, acesso Supabase, credenciais, instalação de ferramentas ou mudança de infraestrutura. Não executar contra desenvolvimento compartilhado ou produção.

## 1. Projeto e autorização explícita

1. O responsável cria manualmente **um novo projeto Supabase**, exclusivamente descartável, pelo Dashboard, em organização autorizada. Não importar dados reais nem conectar a aplicação de produção. Registrar project ref, URL, data, responsável e identificador UUID novo de execução.
2. Confirmar em canal independente que o project ref pertence ao projeto descartável. SQL Editor administrativo não oferece uma prova portátil e infalsificável do project ref. A combinação de confirmação externa + autorização explícita + issuer configurado é a barreira operacional; **não é sandbox contra um administrador malicioso**.
3. Não preencher os templates usando credenciais/IDs de ambientes existentes. Usar o mesmo `REPLACE_RUN_UUID` e `REPLACE_PROJECT_REF` em cópias locais de todos os scripts. Manter tokens/senhas fora do repositório e dos resultados SQL.
4. A instalação histórica e a FLEX são passos administrativos explícitos separados. Sua autorização não é fornecida automaticamente pelos testes. Nunca colar todos os arquivos em uma execução única.

O `01_fixture_setup.sql` instala o registro de autorização `flex_manual_test.config`, atores, objetos, chamadas e checkpoints. Cada script mutável subsequente exige `assert_run(run, project_ref)` **antes de mudanças**. Sem configuração correta os templates devem falhar. Não remover guardas para fazer um teste passar. O harness fica fora de `public`, sem endpoints PostgREST e sem helpers SECURITY DEFINER de mutação de negócio. Não é um componente de produção.

## 2. Construção do schema — ordem exata

Referência: `docs/architecture/products-multitenancy-plan.md`. As sete migrations legadas anteriores a `20261002000000` **não pertencem à instalação limpa SaaS**. A migration de produtos internos aborta se as tabelas legadas já existirem; não ignorar esse erro, não apagar tabelas para continuar.

Todos os caminhos abaixo são relativos a `supabase/migrations/`. Executar **01–54 em ordem**, cada arquivo completo no SQL Editor, salvando sucesso/erro e hash local. Arquivos já contêm suas próprias transações quando necessário; não retirar `BEGIN`/`COMMIT` e não aplicar somente funções isoladas. Não marcar versões artificialmente em `supabase_migrations`.

<!-- MIGRATION_CHAIN -->

**55 só depois de `00_preflight.sql` aprovado.** Aplicar a migration FLEX original inteira, uma única vez; não é um teste reversível. Em qualquer erro: registrar SQLSTATE, mensagem e linha; se sessão abortada, executar rollback manual; interromper e criar outro projeto limpo para repetir depois de correção aprovada. Não alterar migrations históricas, desativar triggers ou enfraquecer preflights.

### Dependências externas reais

Um projeto Supabase fornece a plataforma, mas **não o schema da aplicação**. Antes dos arquivos verificar papéis `postgres`, `anon`, `authenticated`, `service_role`, schemas/funções reais `auth.users`, `auth.uid()`, `auth.jwt()`, `storage.buckets`, `storage.objects` e `storage.objects.owner_id`. Auth e Storage devem ser versões suportadas pelo projeto. Não criar mocks dessas estruturas. A migration de imagens cria/verifica bucket privado `internal-product-images`, 5 MiB, MIME `image/webp`.

A trilha SaaS usa `gen_random_uuid()` e funções nativas modernas, inclusive SHA-256 no hash C.1; a declaração `uuid-ossp` da migration legada não justifica instalá-la ou carregar o legado. Registrar `version()` e `pg_extension`; nenhum número de versão local anterior prova equivalência com o projeto escolhido. Se falta função/tipo/owner/permissão, interromper e investigar, não instalar extensões arbitrárias.

Não há bootstrap oficial local nem seed de aplicação no repositório. O SQL Editor pode aplicar os arquivos SaaS **se** os recursos Supabase e privilégios necessários estiverem disponíveis e não houver limites de tamanho/timeout. Não há evidência de que toda a cadeia já tenha sido instalada dessa forma. Se o Editor rejeitar tamanho/tempo, alternativa manual segura: cliente PostgreSQL autorizado pelo responsável, conectado somente ao projeto descartável, aplicando os mesmos arquivos inteiros em ordem, com parada no primeiro erro. Não quebrar a atomicidade da FLEX para caber no Editor.

## 3. Execução dos testes

| Ordem | Arquivo | Objetivo / critério |
|---|---|---|
| A | `00_preflight.sql` | Antes da FLEX: contratos históricos e reconciliação; ausência da FLEX |
| B | migration FLEX, item 55 | Instalação administrativa única, integral |
| C | `00b_postflight.sql` | Depois: tabelas, funções, constraints, índices, triggers, RLS/ACL |
| D | `01_fixture_setup.sql` | Autorização explícita, atores reais de teste e preparação administrativa separada |
| E | `01b_business_fixtures.sql` | Produtos, inventário e pedidos por RPCs sob `authenticated` |
| F | `02_transition_tests.sql` | Saltos, retrocessos, motivo, destinos especiais, versão; estoque/financeiro inalterados |
| G | `03_delivery_tests.sql` | Entregas A/B/misto/untracked e cadeias físicas |
| H | `04_undo_incorrect_tests.sql` | Crédito exato, motivo, unicidade e reservas consumidas preservadas |
| I | `05_undo_actual_tests.sql` | Preservação sem crédito/reserva nova |
| J | `06_redelivery_tests.sql` | Nova alocação, segunda baixa; herança sem baixa e bloqueio D4 |
| K | `07_cancel_reopen_tests.sql` | Liberação só de ativos e reabertura sem duplicar cobertura |
| L | `08_idempotency_tests.sql` | Resultado histórico e payload conflitante das seis operações |
| M | `09_security_tests.sql` | Tenant, contexto inválido, operator, ACL, FK e imutabilidade |
| N | `10_financial_regression.sql` | Pagamento por C.4; operações não geram pagamento/estorno |
| O | `11_final_integrity.sql` | Reconciliação, cadeias, compensações, eventos/recibos |
| P | `12_http_concurrency.mjs` + roteiro abaixo | Complemento de Auth real e concorrência; opcional para explorar, obrigatório comprovar critérios críticos |
| Q | `99_cleanup.sql` | Inventário final; não apaga evidência imutável; descarte do projeto pelo responsável |

Todos os arquivos SQL devem ser colados **inteiros**, após preencher parâmetros. Não usar `\i`, `\set` ou `\gset`: são metacomandos psql, não SQL Editor. Parar no primeiro erro. Sucesso só é válido se assertions e COMMIT completarem, seguido de inspeção persistida. Não interpretar uma tabela vazia de resultados como aprovação automática. Guardar labels e resultados do harness. Reexecutar arquivo com labels existentes não é estratégia de reset; usar outro projeto para repetir.

### Auth, usuários e planos

Criar contas fictícias novas e confirmadas pelo Supabase Auth/Dashboard (ou API Auth normal) do projeto descartável, nunca por `INSERT` inventado em `auth.users`. O setup exige seus UUIDs reais desse projeto e os valida. Pré-requisitos concretos de e-mail/labels/autorizações estão no cabeçalho do setup. São necessários owner Visionário A, owner Aprendiz B, operator de A e identidade sem vínculo ativo. Todos os papéis válidos do negócio possuem sales.read/write: ausência dessas permissões exige identidade/vínculo inativo ou ausente, não um novo papel comercial inventado. Operator possui read/write, mas não sales.delete.

Provisionamento administrativo e autorização de plano são fixtures explícitas, não ações de usuário final. Onde RPC de onboarding/billing é exclusiva do backend confiável, o setup registra a preparação administrativa separadamente; não usar `service_role` para simular comandos de Pedidos. Empresas e usuários internos precisam corresponder à identidade Auth, issuer ativo e exatamente um vínculo ativo. Aprendiz/Free e Visionário/Intermediate são nomes de produto/códigos efetivos distintos: conferir `resolve_enterprise_plan` e `business_ready`, não só o nome visual.

`set_actor` coloca `request.jwt.claims` em escopo **local à transação**; `SET LOCAL ROLE authenticated` remove os privilégios administrativos para a chamada. Isso testa o resolvedor de identidade e permissões SQL, **não valida assinatura JWT, login, expiração, PostgREST ou Server Actions**. O SQL Editor como postgres pode forjar claims: não apresentar esse teste como Auth fim a fim. Atores reais registrados no Auth continuam obrigatórios. `RESET ROLE` volta ao inspector só para assertions em tabelas privadas; não para alterar pedido/estoque em nome do usuário.

Cada arquivo abre sua própria transação. Claims, role e tabelas temporárias não são mecanismo de persistência entre cliques. O registro permanente do harness armazena somente dados fictícios, payloads e resultados, sem tokens.

## 4. Testes complementares — não executados

### Autenticação real e duas requisições

Usar login normal no projeto descartável para obter dois access tokens de usuários reais de teste. Não usar JWT criado manualmente, service_role, secret key ou token de outro projeto. Executar requisições autenticadas `POST https://<ref>.supabase.co/rest/v1/rpc/<rpc>` com anon/publishable key e Bearer de usuário. Repetir leitura/mutação da própria empresa, ID da outra empresa, operator sem delete, usuário sem vínculo e sessão expirada. Guardar status, SQLSTATE e mensagem do corpo, sem cabeçalhos de autorização.

O script independente `12_http_concurrency.mjs` usa Node/fetch nativos e não foi executado. Copiar `12_http_case.example.json` para arquivo de trabalho fora do repositório e preencher IDs registrados pelo harness, versões efetivamente atuais e dois attempts novos. O `0` do exemplo **não é versão presumida**. Configurar variáveis apenas no terminal do responsável:

```text
FLEX_PROJECT_REF=<ref descartável>
FLEX_RUN_ID=<UUID autorizado no harness>
FLEX_CONFIRM=DISPOSABLE:<ref>:<UUID>
FLEX_ANON_KEY=<anon ou publishable; nunca service_role/secret>
FLEX_TOKEN_A=<access token owner A>
FLEX_TOKEN_B=<access token operator A>
FLEX_CASE_FILE=<caminho JSON preenchido>
FLEX_EVIDENCE_FILE=<arquivo local novo, sem tokens>
node supabase/tests/manual_flex/12_http_concurrency.mjs
```

O script **faz chamadas mutáveis quando executado pelo responsável**, mas não nesta preparação. Verificação local de claims é só barreira contra erro de configuração; o Supabase deve verificar a assinatura. O run_id vincula o caso e a confirmação humana; não prova sozinho propriedade dos IDs. Conferir cada ID no harness antes de chamar.

Casos separados, cada qual em fixture ainda elegível:

| Corrida | Resultado crítico esperado |
|---|---|
| Dois usuários, mesma entrega/versão, attempts diferentes | Um undo; outro conflito de versão/estado conforme ordem; um crédito integral |
| Mesmo ator, mesmo attempt, payload diferente | Um resultado persistido; outro `23505 idempotency_conflict` |
| Mesmo ator, mesmo attempt/payload | Mesmo resultado histórico; um efeito |
| Entrega × cancelamento / alocação | Serialização válida; nunca cadeia parcial nem baixa duplicada |
| Dois pedidos disputando estoque | Reserva integral de quem obtém capacidade; outro falha sem parcial/negativo |
| Compensação × movimentação de inventário | Crédito soma ao saldo corrente serializado, não restaura saldo antigo |

A ordem de quem vence não é predeterminada. HTTP simultâneo não prova sobreposição de locks; registrar horários, SQLSTATE, versão e auditoria após ambas. Timeout/rede deixa resultado desconhecido: recuperar pelo mesmo attempt/payload, nunca assumir rollback. Não aprovar simplesmente porque uma requisição falhou.

### Rollback e fronteiras não cobertas automaticamente

O SQL Editor sozinho não garante sessões paralelas independentes nem commit perdido. Para inspecionar bloqueios reais usar duas conexões independentes autorizadas ao projeto descartável, ou as chamadas HTTP acima, e observação administrativa de `pg_locks`/`pg_stat_activity`. Não abrir transação num clique esperando continuar no próximo.

Falha intermediária precisa de fixture específica e mecanismo reversível que não altere triggers históricos (por exemplo trigger de teste adicional que RAISE em tabela de destino, estritamente no projeto autorizado, removido após rollback). **Não fornecemos instalação automática desse mecanismo**: escolher ponto exato e revisar impacto. Testar após evento, primeiro consume/movimento/settlement, primeira compensação, atualização do pedido e recibo. Capturar snapshots completos antes/depois e provar ausência de qualquer delta. Sem isso, atomicidade fica pendente.

Casos adicionais obrigatórios antes da aprovação completa: saldo insuficiente por movimento legítimo; teto de saldo e versão; plano Aprendiz bloqueando nova reserva; compensação histórica após downgrade; reabertura descoberta no Aprendiz versus coberta; encomenda sem alocação; versão errada e confirmação não vigente no undo; múltiplos produtos; pagamento preexistente durante os ciclos; edição incompatível. Usar modelos das RPCs/payloads registrados e assertar SQLSTATE/mensagem da fonte efetiva. Não alterar saldo/settlement diretamente para fabricar sucesso.

### Replay anterior à FLEX e backfill

Os scripts sequenciais criam fixtures **depois** da FLEX; não provam sozinhos compatibilidade histórica. Para esse critério é necessária segunda instalação limpa: parar após arquivo 54, criar pedidos e entregas pelas RPCs antigas com identidades reais; guardar attempts/payloads/recibos e snapshots. Somente então aplicar FLEX uma vez, conferir manifestos backfilled e repetir exatamente os payloads antigos após ciclos novos. Incluir transição antiga com motivo opcional/obrigatório pela matriz antiga, alocação, cancelamento, reabertura, create/update e C.4. Não inserir recibos artificiais nem "corrigir" hashes. Se não executado, resultado obrigatoriamente PARCIAL.

## 5. Evidências, aprovação e encerramento

Para cada arquivo/caso salvar: project ref e run (sem segredos), PostgreSQL/extensões, lista/hash das migrations, horário, ator/role, payload exato, resultado esperado/observado, SQLSTATE/mensagem, contagens e saldos antes/depois, commit/rollback. Erro inesperado: **REPROVADO naquele caso**, não capturar `WHEN OTHERS` e aceitar qualquer erro. Os testes negativos comparam estado e mensagem específicos.

- **HOMOLOGADA:** instalação integral + reinstalação limpa, todos os critérios críticos funcionais, históricos, financeiros, segurança e concorrência comprovados com execução real; nenhuma falha alta/crítica pendente.
- **PARCIAL:** qualquer cenário crítico não executado, incluindo Auth real, histórico pré-FLEX, rollback ou concorrência. Testes estáticos nunca elevam o parecer.
- **REPROVADA:** instalação falhou ou comportamento viola invariantes; investigar antes de aplicação em desenvolvimento.

`99_cleanup.sql` não apaga ledger/eventos/recibos nem remove estruturas FLEX. Evidência append-only não é lixo a apagar para repetir. Exportar evidências e **descartar o projeto inteiro pelo Dashboard**, após confirmar novamente o ref e que não há dados reais. Não incluir comandos de exclusão automática. A aplicação no Supabase de desenvolvimento depende de revisão humana das evidências; não é autorizada por este roteiro.
