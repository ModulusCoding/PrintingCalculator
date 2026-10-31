# Home — diagnóstico da indisponibilidade financeira

## Evidência e causa

A migration local atual `20261028140000_home_dashboard_reads.sql` contém sete chamadas `pg_catalog.coalesce(...)`. COALESCE é uma construção especial SQL, não função ordinária qualificável por schema. Em PostgreSQL padrão, a resolução como função qualificada falha com `42883` (function does not exist). O primeiro caso está na soma de saldo pendente, antes da montagem do JSON; também afeta buckets, recentes e inventário.

Esse é um defeito concreto do SQL local, compatível com o sintoma. **Não foi observado o erro da instalação real**: sem conexão/execução SQL, não se comprova qual definição está instalada nem que esse seja o único impedimento no ambiente. PL/pgSQL pode aceitar o CREATE e só preparar a instrução problemática na execução. Referência: https://www.postgresql.org/docs/current/functions-conditional.html (COALESCE não é função ordinária).

A migration original foi preservada por já ter sido instalada segundo o usuário. Criada `20261028150000_home_dashboard_coalesce_fix.sql`, NÃO APLICADA: mesmos corpos/ACLs/transação da versão local atual, com apenas sete substituições de `pg_catalog.coalesce` por `COALESCE` e cabeçalho corretivo. Nenhuma regra financeira, autorização, lock ou índice alterado. `search_path=''` permanece correto: palavras/construções SQL não exigem prefixo; funções reais continuam qualificadas.

## Onde a falha era descartada

`loadHomeDashboard()` → RPC → parse/tenant → `read()` → catch retornava somente `{status:'error',message}`. O objeto Supabase, erro de transporte e ZodError eram descartados, sem console/log. `HomeDashboard` recebia esse resultado e mostrava a mensagem amigável. `page.tsx` usa apresentação central para erros de acesso propagados; erros financeiros já convertidos não chegam ao catch da página.

`format.ts` e os componentes não consultam o banco: recebem dados validados. Não há evidência de falha deles para o sintoma informado. Nenhum fallback numérico foi adicionado.

## Diagnóstico adicionado

`lib/dashboard/reader.ts` agora usa a infraestrutura existente `createLogger` + `safeErrorDiagnostic`, somente no servidor. Cada falha é registrada no limite onde ocorre e relançada para o tratamento existente:
- `context`: sales.read, inventory.read, spools.read e criação do cliente de sessão.
- `rpc`: nome exato da RPC, erros SQL/PostgREST e transporte.
- `interpretation`: Zod, configuração/contagens, transformação e tenant mismatch.

Cada log inclui scope dashboard, operação, stage, código, technical_detail sanitizado e correlation_id gerado pelo logger. Zod registra caminhos e códigos de issues, não valores recebidos nem mensagens que possam incorporar payload. Mensagem/detalhes/hint técnicos usam o sanitizador existente: remove JWTs, URLs, emails, UUIDs, valores entre aspas, detalhes de linhas/chaves e padrões de credenciais, com limites de tamanho. Nenhum payload, argumento RPC, sessão, stack bruto, dado financeiro ou nome de cliente é passado ao logger. A mensagem amigável e o contrato de erro no browser permanecem iguais, sem código SQL ou informação interna.

O logger existente pode ser localizado pelo correlation_id no terminal do servidor. A referência não foi acrescentada ao frontend nesta correção.

## Compatibilidade JSON ↔ Zod

| Campo SQL | JSON esperado | Validação |
|---|---|---|
| enterprise_id | UUID string | UUID e igualdade ao tenant autenticado |
| as_of | timestamptz convertido nativamente para string ISO com offset | datetime offset, aceita microssegundos |
| current_month | to_char YYYY-MM string | mês válido e série consecutiva |
| sales_cents | numeric(100,0)::text | string inteira canônica >=0 |
| receipts_cents | numeric(100,0)::text | string inteira canônica, pode negativa |
| pending_cents | numeric(100,0)::text | string inteira canônica >=0 |
| month_orders_count / active_orders_count | bigint convertido em número JSON | inteiro não negativo e seguro JS |
| months | array JSON, seis buckets mesmo sem dados | seis objetos estritos, mês/vendas/recebimentos/contagem; último igual aos totais mensais |
| recent_orders | array JSON, COALESCE para [] | até cinco objetos estritos; UUID, display_number textual, buyer_name não nulo, status real, centavos textuais, created_at ISO offset |

Sem campos nullable nesse contrato. `[]` em recentes é válido; `months=[]`, null financeiro e números em vez de strings de centavos são inválidos. Dinheiro não passa por float na UI. Contagens além do inteiro seguro falham explicitamente.

Fixture `tests/fixtures/home-dashboard-postgres-json.json` derivada manualmente das expressões SQL (não gerada pelo schema), com número JSON em contagens, dinheiro textual, offset -03:00, +00:00 e microssegundos. É sintética, **não captura de execução PostgreSQL**. Não se encontrou incompatibilidade ordinária que justifique relaxar o schema.

## Dependências verificadas localmente

- `private.orders_c4_reader()` sem argumentos → UUID, C4:333–349, contexto/identidade/empresa/sales.read.
- `private.orders_c4_financial(uuid,uuid)` → pending_amount numeric e demais campos C4:37–69; retorna uma linha ou exceção, valida ledger completo inclusive cancelados.
- orders total_amount, enterprise_id, created_at, operational_status, display_number, buyer_name e id presentes no schema 72a.
- order_payments enterprise_id, effective_at, amount e entry_type receipt/refund presentes; valores positivos somados/subtraídos pela própria data efetiva até anchor.
- Matriz de permissões de `20261026150000_pricing_actor_authorization.sql` delega plano ao predicado vigente em `20261026060000_plan_business_regularization.sql`. Nenhum bypass de sales.read ou inventário foi criado.
- Helpers/ACLs continuam SECURITY DEFINER owner postgres, search_path vazio, tenant explícito. Existência local não prova instalação/ACL efetiva.

## Verificação em desenvolvimento

1. Abrir /home com sessão/empresa autorizadas e observar terminal do Next, filtrando `dashboard:`. Registrar operação, stage, code, correlation_id e detalhe sanitizado; não compartilhar payloads/credenciais.
2. `stage=rpc code=42883` mencionando pg_catalog.coalesce confirma o defeito na execução instalada. PGRST202 indica assinatura/cache/função ausente; 42501 indica autorização, não deve ser contornada. `interpretation/ZOD_PARSE_ERROR` indica caminho exato do campo incompatível.
3. Revisar e aplicar **manualmente, com autorização**, a migration corretiva separada no ambiente apropriado. Nenhum comando de aplicação foi executado pelo agente.
4. Atualizar /home, conferir valores contra pedidos/ledger reais, tenant/plano e ausência de mensagens técnicas no browser. Se persistir, usar novo log para identificar a etapa; não substituir por zero ou relaxar autorização.

## Validação local

`npx tsc --noEmit`, ESLint direcionado, `npm run build` e `git diff --check` passaram. `node --test tests/home-dashboard.test.cjs tests/paid-module-gate.test.cjs tests/paid-action-errors.test.cjs`: **31 testes passaram (19 do dashboard)**. Os testes cobrem retorno representativo, vazio, PostgREST/SQL errors, schema inválido, ausência de sessão, autorização e não vazamento no resultado. SQL é examinado textualmente, incluindo regressão de COALESCE e equivalência da correção. Nenhum SQL, Supabase remoto, Docker/WSL, dependência, commit/push/deploy. Sem homologação de banco: sintaxe executada, resolução de função instalada, ACLs, concorrência e dados reais dependem de PostgreSQL autorizado.
