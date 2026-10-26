# Correção da precificadora Aprendiz

## Evidência e limite do diagnóstico

`searchProductsAction` emite `stage=query products.select` apenas quando o Supabase retorna erro; falhas Zod têm catch separado. A consulta usa `deleted_at` na projeção e no filtro. A migration `20261015150000_internal_products_multitenancy.sql` concede SELECT por coluna e a migration `20261024000000_stage5_deletion_counts.sql` adiciona `deleted_at` sem conceder sua leitura. Não há grant posterior anterior à correção. Isso é um defeito confirmado do contrato SQL versionado, compatível com SQLSTATE 42501. O erro original da conta não foi reproduzido remotamente; o logger anterior descartava código/mensagem de objetos PostgREST.

A janela continua sendo aplicada por RLS via `private.stage6b_product_visible`, antes de busca/filtro/paginação. Arquivados ocupam a janela; excluídos não. Não foi concedida leitura de `deleted_by`, acesso irrestrito à tabela ou bypass RLS.

A migration incremental `20261026070000_pricing_read_access_fix.sql` concede a coluna e reafirma os atributos seguros do wrapper de plano, sem substituir seu corpo. O wrapper já está declarado SECURITY DEFINER na migration fonte; não foi confirmado defeito invoker no banco.

## Fluxo

- Página resolve autorização antes dos produtos e monta componente manual separado no Aprendiz.
- Manual consulta apenas produtos. Impressora, filamentos, energia e embalagens são parâmetros manuais, sem IDs fictícios.
- Novo salvamento exige plano selecionado e autorização operacional; receipt idempotente é recuperado antes de carregar fontes. V3 é recalculado no servidor.
- Retry integrado preserva intenção V2 e pode recuperar receipt após downgrade sem consultar fontes pagas; nova gravação continua paga.
- A regra SQL existente de owner Free com equipe legada permanece; não-owner bloqueado. Não houve alteração de memberships, saldos ou ledgers.
- Nenhuma alteração nas fórmulas do motor. O contrato V3 de novas gravações tem schema estrito no servidor e migration SQL por estágios; V1/V2 e snapshots históricos permanecem legíveis.
- Histórico identifica V3 manual e usa nomes/unidades armazenados no próprio snapshot; unidades estão ausentes apenas em V3 históricos gravados antes desse campo, sem reconstrução por fontes atuais.
- Aplicação V3 usa somente preço persistido e confirmação da versão revisada. A exceção Free é local à RPC de apply para V3 manual elegível; V1/V2 mantêm a autorização anterior. A aplicação não recalcula nem mexe em saldos/estoque.

## Verificações executadas

- `npx tsc --noEmit`: passou.
- ESLint focado nos arquivos TS/TSX alterados e harness CJS: passou após ajuste das regras do harness.
- `node --test tests/*.test.cjs`: 61 testes passaram; includes action com schemas e motor reais, gates e UI; fronteiras Supabase/Next são mockadas, não integração real de banco.
- ESLint focado nos arquivos V3/histórico/UI: passou.
- `npx --no-install tsx lib/pricing/manual-form.test.ts`: passou.
- `npx --no-install tsx lib/pricing/fdm.test.ts`: passou.

Migrations incrementais V3 (`20261026100000`, `20261026110000`) e assertions SQL (`tests/sql/20261026100000_manual_v3_assertions.sql`) não foram executadas. O ambiente não tem conexão de desenvolvimento autorizada identificada; não alegar SQL validado. Nenhum SQL remoto/reset foi executado. Não houve validação em navegador autenticado.

## Roteiro local/homologação

1. Em destino local conhecido, aplicar migrations incrementais pendentes, incluindo a regularização `20261026060000` e a correção `20261026070000`. Não aplicar indiscriminadamente em produção.
2. No banco local descartável com migrations aplicadas, executar `tests/sql/20261026070000_pricing_read_access_assertions.sql` via psql a partir da raiz. Usa fixture e rollback.
3. Owner Aprendiz: abrir `/precificadora`, verificar apenas fontes manuais e produtos. Usar mais de três registros, arquivar um recente e buscar nome antigo: não pode promovê-lo à janela. Excluído nunca selecionável.
4. Sem produtos ativos acessíveis: ver orientação/link autorizado, simular manualmente sem salvar nem criar produto automaticamente.
5. Preencher máquina, tarifa, lote, filamento preço/peso original/consumo, perda e embalagens por lote/peça. Testar campo vazio, NaN, infinito e zero explícito. Salvar e conferir histórico V3 e resultado.
6. Simular perda de resposta de salvamento e repetir sem recalcular: mesma tentativa, uma gravação. Não mudar intenção nem converter V2 em manual.
7. Owner Free com equipe legada: página operacional; membro Free bloqueado. `selection_required`: encaminhamento para `/planos`. Visionário: seletores integrados e snapshot V2.
8. Em teste isolado, induzir erro PostgREST e resposta inválida: log de query com código original vs interpretation com caminhos/códigos Zod, sem lista vazia falsa.
