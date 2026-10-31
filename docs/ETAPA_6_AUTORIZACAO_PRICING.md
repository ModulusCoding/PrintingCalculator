# Etapa 6 — Autorização comum de Pricing

## Estado

Implementação incremental para revisão/aplicação manual. Nenhuma migration aplicada pelo agente. **O fluxo autenticado só será considerado confirmado depois da validação no Supabase e no navegador.** A suíte SQL V3 anterior passou em desenvolvimento segundo confirmação do usuário; esse resultado antecede esta migration e não valida o transporte service_role das actions.

## Causa

`saveManualFdmPricingAction` usa o cliente de cookies para `auth.getUser()`, valida o issuer de ambiente e obtém `p_actor` no servidor. Depois chama `lookup_pricing_attempt` e `save_manual_pricing_attempt` por um segundo cliente, `createAdminClient`, sem cookies e com a service key. As RPCs são restritas a service_role.

`private.pricing_actor` validava e travava o ator explícito (Auth identity/issuer ativo, usuário ativo, troca de senha, vínculo ativo único e empresa ativa), mas sua última verificação chamava `can_access_enterprise`. Esse helper resolvia novamente a identidade a partir de `auth.uid()`/`auth.jwt()`. Sem JWT do usuário nessa conexão, a identidade interna era nula e ocorria `42501 / unauthorized` já no lookup. A action transforma 42501 em “Acesso negado”. O mesmo problema afetava a aplicação, inclusive o products.write da exceção manual V3.

A suíte SQL V3 fornecia claims locais de owner no SQL Editor e, por isso, não reproduzia a conexão administrativa sem JWT. O defeito foi confirmado no código; o log genérico sozinho não distingue essa falha dos demais gates legítimos.

## Arquitetura final

- **Entrada JWT:** `private.can_access_enterprise(eid, permission)` resolve `current_internal_user_id()` e delega ao avaliador comum. Sem identidade válida continua negando.
- **Avaliador comum:** `private.can_access_enterprise_for_user(user_id, eid, permission)` contém a expressão anterior integral: vínculo ativo único, usuário ativo/sem troca de senha, empresa ativa, matriz CASE de papéis e `plan_permission_allowed`. Não cria segunda matriz nem redefine planos.
- **Entrada administrativa:** RPCs continuam service_role-only. `pricing_actor` mantém todas as verificações e locks originais e só então passa seu usuário interno validado ao avaliador comum.
- **Apply V3:** usa `x.uid`, retornado por pricing_actor, para products.write. Mantém o gate pricing.apply para os demais caminhos e a exceção estreita de owner Free/manual V3.

O helper não autentica um UUID por si só: recebe identidade já validada por uma entrada confiável. Seu EXECUTE é revogado de PUBLIC, anon, authenticated e service_role; só é invocado internamente no contexto das funções SECURITY DEFINER de postgres. Não há RPC pública nova que aceite usuário interno arbitrário. As RPCs existentes recebem Auth subject/issuer exclusivamente a partir da sessão validada nas Server Actions; posse de UUID não concede EXECUTE. A service key continua sendo um segredo de backend de alta confiança, nunca um token de usuário/browser.

Não se encaminha JWT para um cliente administrativo, não se fabricam claims e não se adiciona exceção `service_role => true`. Também não se exige JWT de usuário para a entrada administrativa validada: essa é precisamente a incompatibilidade corrigida. JWT presente nessa conexão não substitui o ator explícito; no caminho JWT, apenas a identidade da sessão é avaliada. O wrapper não aceita ator interno por parâmetro e nega JWT sem subject/issuer correspondente. Validação criptográfica de token inválido/expirado pertence ao gateway/Auth e ao `getUser()`; alterar claims localmente no SQL Editor não reproduz essa validação criptográfica.

## Migration e alterações

Arquivos desta entrega:
- `supabase/migrations/20261026150000_pricing_actor_authorization.sql` (novo).
- `tests/pricing-actor-authorization.test.cjs` (novo).
- `tests/sql/20261026150000_pricing_actor_authorization_sql_editor.sql` (novo).
- `tests/manual-pricing-persistence.test.cjs` (harness e regressões ampliados).
- `docs/ETAPA_6_AUTORIZACAO_PRICING.md` (este documento).

Nenhuma alteração de implementação TypeScript das actions foi necessária: a sessão já era validada e o ator já era derivado no servidor.

Aplicar manualmente após `20261026140000`:

`supabase/migrations/20261026150000_pricing_actor_authorization.sql`

Funções novas/atualizadas:
1. Novo avaliador privado `can_access_enterprise_for_user(uuid,uuid,text)`.
2. Wrapper JWT `can_access_enterprise(uuid,text)`.
3. `pricing_actor(uuid,text,text)`: apenas substituição da chamada final pelo helper com `u.id`.
4. `apply_pricing_price(uuid,text,uuid,bigint)`: apenas substituição do products.write pelo helper com `x.uid`.

Owner postgres, SECURITY DEFINER, search_path vazio e ACLs são preservados. `current_internal_user_id`, `plan_permission_allowed`, save/lookup, snapshots e tabelas não são modificados. Migrations aplicadas permanecem intactas. Sem mudanças no motor FDM, equipe, cotas ou telas.

## Comparação das regras

| Regra | Antes | Depois |
| --- | --- | --- |
| JWT para fluxos de sessão | Identidade atual obrigatória | Igual, via wrapper |
| Ator explícito de pricing | Validado, mas autorização dependia de outra identidade JWT | Mesmas validações; autorização usa esse ator |
| Usuário ativo / senha obrigatória | Exigidos | Iguais |
| Tenant único / empresa e vínculo ativos | Exigidos | Iguais |
| Matriz de papéis e predicado de plano | CASE + plan_permission_allowed | Mesma expressão em um único helper |
| Owner Aprendiz manual V3 | Permitido pelos gates específicos, porém transporte falhava | Mesmos gates, identidade consistente |
| V1/V2 apply em Free | Negado por pricing.apply | Igual |
| Janela, versão, snapshot e recibos | Gates existentes | Iguais |
| Execução das RPCs administrativas | Service role | Igual; sem grants para usuário/anon |

## Dependências JWT auditadas

Busca estática nas migrations identificou consumidores em policies/RLS e funções de contexto, gerenciamento empresarial/membros, produtos/imagens/Storage, impressoras, materiais, carretéis, inventário de produtos e materiais gerais, configuração de energia/perdas, exclusões, janela gratuita, seleção/uso de plano e capacidade de criação. Todos conservam a mesma assinatura `can_access_enterprise(uuid,text)` e resolução JWT. A matriz não foi copiada para esses consumidores.

Definições-base revisadas: `20261014193600` (identidade JWT), `20261026020000` (pricing_actor/lookup), `20261026060000` (matriz e planos), `20261026100000` (save V3), `20261026140000` (apply corrigido). A lista é auditoria estática de origem, não introspecção do catálogo remoto. Se houver customizações fora das migrations, revisar antes da aplicação.

## Testes

- `tests/pricing-actor-authorization.test.cjs`: equivalência literal da expressão anterior após substituir a fonte de identidade; comparação integral de pricing_actor/apply; ACLs privadas e ausência de manipulação de claims. Testes estáticos, não execução SQL.
- `tests/manual-pricing-persistence.test.cjs`: executa a Server Action, schemas e motor reais com fronteiras Supabase/Auth mockadas. Não prova RLS, JWT criptográfico ou transações PostgreSQL.
- `tests/sql/20261026150000_pricing_actor_authorization_sql_editor.sql`: fixtures próprias e ROLLBACK; chamadas service_role reais sem sub JWT; save/retry/apply/replay e negativas; wrapper JWT, equivalência e ACLs. Claims locais neste script são exclusivamente fixtures de teste no SQL Editor, não código de produção nem teste de assinatura JWT.
- Suíte V3 existente preservada e deve ser reexecutada.

**Executados localmente:** `npx tsc --noEmit` passou; ESLint focado nos dois arquivos de teste passou; `node --test tests/*.test.cjs` terminou com **102 testes, 102 aprovados** (incluindo quatro regressões estáticas e 49 casos no harness manual). Logs técnicos durante as negativas são esperados; não contêm tokens/keys. **Pendentes de execução real:** migration, novo script SQL, suíte V3 após esta alteração, requests HTTP com JWT inválido e navegador autenticado. Os resultados locais não equivalem à aprovação do banco.

## Aplicação e validação manual

1. Revisar snapshot/backup do ambiente e confirmar histórico até `20261026140000`. Se uma execução SQL anterior abortou, executar ROLLBACK antes de continuar.
2. Revisar e aplicar o arquivo inteiro `20261026150000_pricing_actor_authorization.sql` no DEV autorizado. Não selecionar somente partes. Conferir definições instaladas e ACLs: helper privado e pricing_actor sem EXECUTE para roles de API; can_access permanece authenticated; RPCs lookup/save/apply permanecem service_role-only.
3. Executar inteiro `tests/sql/20261026150000_pricing_actor_authorization_sql_editor.sql`, como postgres. Preservar ROLLBACK; em erro, ROLLBACK antes de tentar novamente. Não executar em produção: cria dados transacionais próprios.
4. Reexecutar inteiro `tests/sql/20261026100000_manual_v3_sql_editor.sql`, mantendo seu ROLLBACK.
5. No navegador, entrar como owner Aprendiz ativo com plano escolhido e produto elegível. Calcular manualmente, salvar, confirmar histórico/snapshot e repetir a mesma intenção sem duplicata. Aplicar preço e repetir, confirmando um recibo e nenhuma segunda alteração de versão/preço.
6. Validar owner de outro tenant/produto alheio, operador, usuário inativo, troca de senha obrigatória, plano não selecionado e produto fora da janela. Confirmar negação correta sem mutação.
7. Validar Visionário integrado V1/V2 e respectivos replays, sem mudança de gates. O teste de V1/V2 histórico não substitui os fluxos integrados completos.
8. Testar sessão ausente/expirada/inválida no HTTP e verificar que a action não aceita identidade fornecida no payload. Não colar service keys/JWTs em SQL, logs, screenshots ou relatórios. UUID conhecido com anon/authenticated não deve executar RPC administrativa/helper.
9. Registrar resultados separadamente: testes locais, SQL de desenvolvimento e navegador. Somente após essas confirmações declarar o fluxo autenticado validado.

### Conferência somente leitura do catálogo após aplicar

```sql
SELECT pg_get_functiondef('private.can_access_enterprise(uuid,text)'::regprocedure);
SELECT pg_get_functiondef('private.can_access_enterprise_for_user(uuid,uuid,text)'::regprocedure);
SELECT pg_get_functiondef('private.pricing_actor(uuid,text,text)'::regprocedure);
SELECT pg_get_functiondef('public.apply_pricing_price(uuid,text,uuid,bigint)'::regprocedure);

SELECT role_name, signature,
       has_function_privilege(role_name, signature, 'EXECUTE') AS can_execute
FROM unnest(ARRAY['anon','authenticated','service_role']) AS roles(role_name)
CROSS JOIN unnest(ARRAY[
  'private.can_access_enterprise(uuid,text)',
  'private.can_access_enterprise_for_user(uuid,uuid,text)',
  'private.pricing_actor(uuid,text,text)',
  'public.lookup_pricing_attempt(uuid,text,uuid,text)',
  'public.save_manual_pricing_attempt(uuid,text,uuid,text,text,jsonb,uuid,bigint,numeric)',
  'public.apply_pricing_price(uuid,text,uuid,bigint)'
]) AS functions(signature);
```

Execute como postgres no SQL Editor. O resultado esperado é: wrapper JWT apenas authenticated; helper/pricing_actor nenhum dos três; RPCs públicas listadas apenas service_role. A permissão de função isolada não substitui USAGE de schema nem as validações internas.

## Riscos residuais

- Equivalência estática não substitui execução em PostgreSQL nem revisão de drift do catálogo.
- Qualquer RPC futura que use o helper precisa validar a identidade antes e manter ACLs compatíveis; não expor um endpoint que autorize UUIDs internos arbitrários.
- A service key continua uma credencial privilegiada: comprometimento dela está fora da garantia de autenticação de usuário oferecida pelas Server Actions. Nenhum helper a torna segura para o browser.
- Recibos e janelas mantêm sua ordem anterior; não transformar essa correção em nova regra de plano ou alteração de idempotência.
