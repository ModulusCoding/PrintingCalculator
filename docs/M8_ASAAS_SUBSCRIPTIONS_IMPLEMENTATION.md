# M8 Asaas subscriptions — candidata local, NÃO APLICADA

## Estado e parecer

Política de cobertura integrada em código local: owner contrata cartão hospedado ou assinatura Pix mensal manual por R$39,90; webhook persiste inbox; reconciliação consulta GET autoritativo; ledger autoriza intervalos; cancelamento preserva dados/equipe. **Apta somente à revisão após correções de fonte. Bloqueada para aplicação/produção até PostgreSQL real e Asaas sandbox autorizados.**

Relatório completo obrigatório em [`M8_SQL_COMPATIBILITY_REVIEW.md`](M8_SQL_COMPATIBILITY_REVIEW.md): dependências e assinaturas reais, defeitos, segurança, concorrência, comandos e bloqueadores. Migration `supabase/migrations/20261027130000_m8_saas_billing_foundation.sql` permanece não aplicada. Fonte/mocks/build não equivalem a homologação financeira, SQL ou RLS.

## Preservação e escopo

Status inicial continha alterações em `app/(plans)/meu-plano/page.tsx` e arquivos novos M8 em app/api, components, lib/billing, docs, tests e migration candidata. Preservados. Auditoria alterou somente candidata, testes dependentes e documentação. Não alterou autenticação central, planos comerciais, Pedidos, migrations históricas, infraestrutura, env ou dependências. Nenhum SQL/parser SQL, Supabase remoto, Asaas financeiro, instalação, Docker/WSL, commit/push/deploy.

## Contrato financeiro e calendário

CONFIRMED e RECEIVED concedem igualmente após GET verificado pelo servidor. Primeiro início é a primeira observação persistida transacionalmente (`statement_timestamp()`), nunca callback, webhook bruto, dueDate ou meia-noite inferida. Intervalo **[from,until)** em timestamptz, mês calendário America/Sao_Paulo preservando hora local e âncora original: 31/jan→28/fev→31/mar; 30/jan→28/fev→30/mar; bissexto e dezembro/janeiro. Projeção `lib/billing/calendar.ts` é referência de testes, não fonte de autorização; JS Date não prova microssegundos SQL.

Renovação antecipada agrega após último fim da geração. Exemplo: pagamento 25/fev, vigente até 28/fev, acrescenta 28/fev→31/mar. Receipt atual muda para o novo pagamento, mas resolver mantém o ciclo anterior até 28/fev, pois considera todos os ciclos não revertidos da geração. Após atraso, nova âncora começa na observação, sem cobrir gap; no fim exato a renovação pode ser contínua. Sem renovação, expira sem job no limite exclusivo.

## Compatibilidade e correções auditadas

`private.resolve_enterprise_plan` continua autorizador único com assinatura/retorno histórico; `lib/plans.ts` permanece inalterado. Grants não-M8 conservam semântica original. M8 vincula access ao authorization_id atual da conta e procura cobertura na geração atual, não apenas no ciclo do receipt mais recente.

`private.m8_grant_verified_payment` **não limpa paid_from antes do confirmer**. O fim novo é maior que o anterior, logo o início anterior segue compatível com o CHECK durante o UPDATE histórico. Exige retorno `confirmed` do confirmer; replay `idempotent` não cria ledger novo e aborta. Grant manual independente ainda vigente gera conflito explícito em vez de sobrescrita silenciosa. Receipt, origem, ciclo e observação persistem na mesma transação fenced. FKs compostas garantem enterprise/generation/payment/authorization coerentes; origem/ciclo/reversão são imutáveis. Pagamento persiste generation NOT NULL e identidade valor/vencimento/empresa/geração não pode mudar.

Reversão é append-only por payment, inclusive antes de confirmação: esse payment nunca volta a autorizar. Refund antigo exclui somente seu intervalo, sem cancelar ciclo posterior independente. Cancelamento é separado: downgrade imediato apenas após resultado remoto verificado; nunca refund automático.

## Orquestração e segurança

Owner reserva tentativa durável antes de rede. customer/resource/complete e unknown impedem POST repetido cego. Busca customer por `m8:<enterprise>` exige unicidade e ausência de hasMore. Recurso usa attempt UUID. Fase resource compare-and-set impede dois POSTs concorrentes; recuperação Pix lista externalReference e faz GET. Timeout de checkout sem ID conhecido exige revisão operacional, sem endpoint inventado.

Contexto SQL deriva identidade ativa/empresa/membro/role sem IDs arbitrários browser. Owner browser só consulta/reserva; commits service-only. Funções SECURITY DEFINER têm search_path vazio, REVOKE/grants explícitos; tabelas privadas RLS sem grants diretos browser/service. Precondição exige owner postgres/baseline histórico. Service-role permanece credencial privilegiada e só fica no módulo server-only billing.

Mutações checkout/cancel/progress adquirem advisory global antes de contexto e row locks; financeiras usam a mesma chave histórica. Cancel subscription vincula tentativa à geração. Cancel/recontratação invalidam lease financeiro, impedindo snapshot antigo. Fences financeiros exigem token/versão/prazo sob lock. Scan tem lease separado, SKIP LOCKED, ticket justo e checkpoint atômico com notificações; rejeita NULL/array inválido/versão/token/geração/assinatura/offset obsoletos. Inbox pode duplicar GET entre workers, pois seu SKIP LOCKED não é lease longo; fence/ledger impedem duplicar grant. Não se promete transporte exactly-once.

## Métodos e recuperação

- Cartão: POST checkout oficial CREDIT_CARD/RECURRENT, MONTHLY, callback HTTPS configurado no servidor, item R$39,90 e customer vinculado. Modulus não coleta cartão/CVV/token. Link allowlisted por ambiente.
- Pix: POST subscription PIX/MONTHLY; cada fatura é paga manualmente na invoiceUrl oficial. Não é Pix Automático nem QR local; não se recria assinatura mensalmente.
- Webhook autentica token constante e limita corpo streamed 64KiB; salva envelope mínimo antes de 200, falha DB retorna 503. Não guarda payload/cartão/documento/email/segredos no ledger.
- Worker faz hint GET para descobrir vínculo, claim durável e novo GET para aplicar. Valida ID/customer/sub/checkout/preço/método/ciclo. 404 não é prova de exclusão.
- Cancel subscription reserva unknown antes de DELETE e confirma ID + deleted:true. Timeout não repete DELETE nem cancela localmente; GET deleted/INACTIVE recupera. Cancel checkout pré-pagamento usa POST `/checkouts/{id}/cancel` e status CANCELED; timeout sem GET oficial de recuperação exige procedimento operacional.
- Recontratação troca geração/desvincula IDs antigos; eventos antigos não reativam. ACTIVE atrasado nunca desfaz cancelamento.

## Fila e endpoints

`POST /api/billing/asaas/reconcile` usa Bearer administrativo independente (>=32 caracteres). Não aceita tenant/customer/offset arbitrários browser. Cada chamada processa até 4 páginas de 100 faturas + 20 notificações. Resposta `scan_pages`/`resumable:true` não afirma fila esgotada. Repetir invocações para progresso; não foi provisionado cron. Refresh owner deriva enterpriseId da identidade server e limita scan/inbox ao tenant.

Ticket avança mesmo em falha; offset só avança junto de eventos duráveis. Crash repete página com dedup. hasMore=false retorna offset zero para revisitar alterações. Mudança geração/subscription reinicia cursor e bloqueia commit antigo. Paginação Asaas por offset não fornece snapshot consistente; mutações deslocam itens, exigindo passagens completas repetidas. Leases expiram em 45s. Sem promessa de ausência de starvation/locks reais sem ensaio DB.

## UI e configuração

UI owner mantém consulta/seleção/faturas/checkout/intervalos/estados separados; query string não concede acesso; falha de leitura não é histórico vazio. Nome/CPF-CNPJ/email são enviados ao Asaas sem persistência no ledger; validação local de dígitos não prova identidade cadastral. Sem alteração de UI nesta auditoria.

Nomes de variáveis somente: `ASAAS_ENVIRONMENT` (sandbox default), `ASAAS_API_KEY`, `ASAAS_PRODUCTION_ENABLED`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_RECONCILE_TOKEN`, `ASAAS_CALLBACK_ORIGIN`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`. Nenhuma env real lida/usada/editada. Habilitar produção apenas após homologação independente.

## Documentação de referência anterior

Implementação anterior registrou leitura da documentação Next instalada para actions e docs públicas oficiais Asaas: checkout recorrente, criar checkout/cliente/assinatura, listar assinaturas/cobranças, GET payment/subscription, DELETE subscription, webhook e cancelar checkout. Auditoria atual não fez chamadas HTTP financeiras nem tratou essas referências como prova de integração real.

## Preflight e ensaios pendentes

`docs/M8_PREFLIGHT_READ_ONLY.sql` contém SELECTs de catálogo/ACL/assinaturas/enums/constraints/indexes/triggers e agregados guardados por existência. Pode ser revisado antes de M8 sem referenciar estaticamente tabelas saas ausentes; não expõe IDs/payloads/PII. **Preparado, não executado.** Confirmar baseline, owner postgres, signatures/return types, grants sem browser confirm/cancel/helper e consistência legacy antes de autorização de aplicação.

Bloqueia produção: aplicar/compilar em PostgreSQL isolado autorizado; roles anon/authenticated(owner/admin/member)/service; RLS/ACL herdadas; duas sessões com grant/cancel/recontract/stale fence/scan/duplicates; rollback induzido entre receipt/origin/cycle; calendários/microssegundos/timezone; sandbox Asaas para ambos métodos, timeout/replay/refund atual/antigo/cancelamento concorrente e webhook ausente. Não realizado. Unknown de checkout sem ID e grant independente exigem resolução auditada operacional. Monitoramento, retenção/LGPD e rate limits distribuídos continuam requisitos operacionais.

## Verificações locais desta auditoria

- `node --test tests/m8-*.test.cjs tests/paid-module-gate.test.cjs tests/pricing-access.test.cjs`: **95/95**, exit 0.
- `node --test tests/plan-capacity.test.cjs tests/pricing-actor-authorization.test.cjs`: **9/9**, exit 0.
- `npx tsc --noEmit`: exit 0.
- `npx eslint lib/billing tests/m8-*.test.cjs`: exit 0.
- `npm run build`: exit 0, output disponível `Finished TypeScript in 8.1s ...`; não prova DB/E2E.
- Reexecução final conjunta dos testes acima com `--test-reporter=dot`: exit 0, **104 testes**; ESLint repetido exit 0.
- `git diff --check`: exit 0, aviso LF→CRLF na página preexistente. Esse comando não verifica arquivos untracked (incluindo candidata); não é validação SQL.

Novos testes são modelos de intervalos e verificações de fonte (sem parser SQL), incluindo renovação 25/fev vigente até 28/fev→31/mar, receipt substitution/replay, FKs/imutabilidade, ordem de locks e NULL scan. Não se declara PostgreSQL executável/homologado. Relatório completo inclui bloqueios e resultados finais de diff/testes.
