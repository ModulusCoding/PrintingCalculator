# Etapa 03 — Materiais gerais

## Normalização de entradas numéricas

Corrigida a fronteira das Server Actions para aceitar números enviados por `FormData` como texto, sem alterar os schemas de resposta do banco. `expected_version` agora aceita `"0"` e `0`, mas rejeita vazio, nulo, frações, negativos, NaN, infinito e valores fora do inteiro seguro. Quantidades e preços preservam validação de escala, faixa e positividade; campos vazios não são convertidos em zero e entradas parciais como `20abc` são rejeitadas. A vírgula decimal pt-BR é normalizada somente após a validação da forma completa.

As mensagens de validação são associadas aos campos e os logs registram apenas caminhos/códigos dos problemas, sem payload completo. O `attempt_id` e a versão original permanecem congelados em retries incertos. Foi adicionado `lib/general-materials/verify-validation.ts`, com assertions para versões, consumo textual de 20 centímetros, zero em ajuste, zero em consumo, campos vazios e referências de custo.


## Escopo e estado da revisão

A migration principal inspecionada é `supabase/migrations/20261022000000_general_materials_inventory.sql`. A revisão foi feita por leitura estática, em comparação com os padrões já preservados no repositório, incluindo `supabase/migrations/20261020000000_finished_product_inventory.sql` (fonte anterior preservada). Não houve aplicação da migration nem validação funcional em banco.

O módulo de aplicação expõe a rota `/estoque/materiais-gerais`. As funções de listagem e de histórico aceitam `limit` entre 1 e 100 e `offset` não negativo; a listagem geral usa 20 como limite padrão. Esses limites são contratos observados na migration, não resultado de teste funcional.

## Correções e pontos ainda não comprovados

A tabela abaixo substitui afirmações anteriores de que todos os pontos estavam resolvidos. Ela separa o que foi observado no SQL do que ainda precisa de execução e revisão.

| Issue | Observação atual | Estado / ação necessária |
|---|---|---|
| **Regressão em `can_access`** | A migration redefine `private.can_access_enterprise` e concentra a autorização em `stock.materials.read`, `stock.materials.write` e `stock.materials.archive`, com papéis owner/admin/operator (archive exclui operator). Redefinir uma função compartilhada pode regredir contratos de outros módulos ou divergir do contexto de autorização existente. | **Não validado.** Comparar com a implementação/políticas vigentes e testar leitura, escrita, archive e isolamento entre empresas antes de afirmar compatibilidade. |
| **Política / `EXECUTE`** | As tabelas têm RLS, há políticas de leitura e o SQL revoga `EXECUTE` e depois concede `EXECUTE` das RPCs públicas a `authenticated`. Isso ainda depende da assinatura exata criada no banco e de o contexto autenticado satisfazer as funções SECURITY DEFINER. | **Não validado em banco.** Testar grants efetivos, chamadas autenticadas e negação para anon/usuários sem a permissão. |
| **Escala de conversão** | `general_num` rejeita valores cuja escala textual exceda 6 antes da conversão; `general_convert` também compara o resultado com `round(x,6)`. A combinação precisa ser verificada para divisões e multiplicações, especialmente valores representáveis após conversão e valores que perdem precisão. O teste preparado usa `0.333333333333` e não foi executado. | **Pendente.** Confirmar a regra de escala desejada e cobrir conversões em ambos os sentidos; não declarar a precisão como resolvida. |
| **Snapshot/custo antigo** | Os movimentos possuem `reference_quantity_snapshot` e `reference_price_snapshot`, mas a existência desses campos não prova que todos os caminhos gravem o snapshot correto. A alteração de referência também possui `general_material_cost_history`; é necessário conferir se o histórico preserva corretamente os valores antigos antes da atualização. | **Não validado.** Executar casos com mudança de referência e verificar ledger, custo e histórico; não afirmar que o snapshot antigo está correto sem isso. |
| **Ambiguidade em PL/pgSQL** | Há funções PL/pgSQL densas que usam parâmetros, variáveis e colunas com nomes próximos (notadamente em `move_general_material` e nas consultas de atualização). A inspeção textual não substitui o parser e a execução no PostgreSQL. | **Revisão/execução pendente.** Qualificar nomes de colunas/parâmetros se necessário e compilar a migration em banco compatível. |
| **`p_type` nulo** | `move_general_material` rejeita `p_type` nulo por `p_type NOT IN (...)` combinado com a validação, mas o comportamento deve ser confirmado no PostgreSQL e coberto explicitamente no teste. | **Não validado.** Adicionar/confirmar caso de entrada nula e erro esperado. |
| **Constraint de custo** | As constraints verificam sinais, saldo e `cost_signed` para os tipos de movimento, mas não demonstram sozinhas que o custo corresponde ao snapshot/preço correto em todos os caminhos. `unit_cost`, `reference_*_snapshot` e `cost_signed` devem ser verificados conjuntamente, inclusive no ajuste e no movimento de abertura. | **Pendente.** Testar invariantes de custo e considerar constraints mais fortes se o contrato exigir igualdade, não apenas sinal. |

Também foi constatado que o script preparado em `supabase/tests/general_materials_manual.sql` contém chamadas antigas para as RPCs administrativas (por exemplo, sem `p_attempt_id`, e ainda tenta alterar `control_unit` no perfil), incompatíveis com as assinaturas atuais da migration. Portanto, ele não pode ser tratado como teste executável sem atualização.

## Compatibilidade dos schemas de leitura e logs

As RPCs `get_general_material` e `list_general_materials` retornam linhas completas de `public.general_materials`, que incluem `enterprise_id`, `create_actor_id`, `create_attempt_id` e `create_payload`. O schema real consumido pelas actions era `materialSchema` (também reutilizado como `materialListSchema`) e rejeitava extras com `.strict()`. Ambos agora usam o objeto Zod com stripping padrão (`.strip()`), mantendo os campos de apresentação e suas validações; metadados internos são descartados antes dos objetos chegarem aos componentes. Movimentos e histórico também retornam linhas completas; após conferir os campos adicionais da migration, seus schemas de leitura foram ajustados para stripping sem remover validações dos campos requeridos.

A listagem separa erros Supabase (`stage=rpc`) da interpretação inválida da resposta (`stage=interpretation`) e registra cada falha uma única vez, com o mesmo identificador de correlação retornado à UI. A leitura do detalhe também valida explicitamente material, movimentos e histórico, sem devolver campos internos.

Foi adicionado o verificador `lib/general-materials/verify-schemas.ts`, executável com `node_modules/.bin/tsx` quando disponível ou via runner TypeScript já configurado no ambiente. Ele verifica stripping dos extras, rejeição de campo ausente/unidade/saldo inválidos e parsing de lista, movimento e histórico.

## Correção de navegação, erros e diagnóstico

A sidebar apontava para `/materiais-gerais`, embora as páginas existentes estejam em `/estoque/materiais-gerais`. O link foi corrigido e o destaque ativo passou a considerar a rota canônica. Os links de cadastro, detalhe, cancelamento e retorno continuam usando a rota canônica; `normalizeReturnTo` mantém apenas destinos internos válidos e preserva busca, status e paginação.

A inspeção confirmou que “retornar” significa principalmente o link determinístico `Voltar` do detalhe e `Cancelar`/volta do cadastro, não `router.back`. Não foi encontrada causa comprovada de erro de histórico; o problema observável da sidebar era o 404. Erros de leitura anteriormente eram convertidos em lista vazia ou `notFound` indistinto. Agora falhas técnicas têm estado próprio, tentativa novamente e código de correlação; apenas material ausente continua sendo `notFound`.

As Server Actions agora registram operação, etapa, RPC, código sanitizado e correlação no terminal do Next.js, sem payload, tokens ou respostas integrais. Falhas de interpretação e revalidação são diferenciadas. Resultado confirmado com falha de atualização informa para reabrir o material e não repetir a movimentação; resultado incerto mantém o mesmo payload congelado e `attempt_id`.

## Correção pontual da tabela de recibos

A tabela `private.general_material_receipts` persiste exatamente as colunas `payload` e `result`. As variáveis PL/pgSQL permanecem distintas (`v_payload`, `v_result`, `v_stored_payload`) e as consultas usam aliases explícitos, por exemplo:

```sql
SELECT r.result, r.payload
INTO v_result, v_stored_payload
FROM private.general_material_receipts AS r
WHERE r.enterprise_id = e AND r.actor_id = a AND r.attempt_id = p_attempt_id;
```

Os quatro caminhos de mutação que consultam recibos — movimentação, perfil, referência de custo e arquivamento/restauração — usam INSERT com lista explícita de colunas. O teste manual agora cobre primeira execução, retry equivalente e payload conflitante em cada operação. A migration permanece não aplicada; estes pontos foram verificados estaticamente.

## Verificações de aplicação conhecidas

Nesta revisão também foram corrigidos: a matriz compartilhada de `can_access_enterprise` foi preservada a partir de `20261020000000_finished_product_inventory.sql` e recebeu apenas `stock.materials.*`; `EXECUTE` de `private.can_access_enterprise(uuid,text)` foi concedido a `authenticated` para as policies; `general_convert` normaliza somente após verificar perda; o histórico captura valores antigos antes do update; consultas de recibos usam aliases e variáveis distintas; `p_type IS NULL` é explícito; e o ledger compara custo pela fórmula dos snapshots, não pelo `unit_cost` arredondado.

O script `supabase/tests/general_materials_manual.sql` foi atualizado com assertions e fixtures substituíveis. Ele continua preparado, mas não executado.

- `npx tsc --noEmit`: passou.
- `npm run build`: passou uma vez antes das alterações finais somente de SQL.
- Lint restrito: anteriormente reportou 3 warnings; depois houve edições de código e o lint precisa ser executado novamente pelo agente principal.

Esses resultados são apenas da aplicação. Não constituem validação da migration, RLS, grants ou comportamento das RPCs.

## SQL e ambiente

O script SQL de testes está preparado no repositório, mas **não foi executado**. Não é conhecido neste ambiente um Supabase CLI configurado nem uma configuração local/remota de Supabase disponível para aplicar a migration. Assim, não há resultado de testes SQL, teste de permissões, teste de concorrência ou validação funcional a reportar.

## Próximos passos

1. Corrigir o script manual para as assinaturas atuais e remover o cenário que tenta mudar unidade imutável.
2. Compilar/aplicar a migration em um banco PostgreSQL/Supabase local isolado.
3. Executar os casos de autorização (`can_access`, RLS e `EXECUTE`), conversão, `p_type` nulo, snapshots/custos e constraints.
4. Só após esses passos registrar resultados funcionais e confirmar se os pontos da tabela foram resolvidos.

Até essa execução, a entrega deve ser considerada **inspecionada estaticamente, sem validação funcional**.
