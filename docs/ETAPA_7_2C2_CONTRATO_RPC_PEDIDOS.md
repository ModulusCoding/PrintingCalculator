# Etapa 7.2-C2 — contrato de criação com estoque e alocação

## Escopo e estado de validação

Divisão aprovada: **C2a** amplia `create_order` com decisão de estoque; **C2b** introduz `allocate_order_stock`; **C2c** redefine exclusivamente `update_order` para impedir substituição integral de itens físicos. Este documento é contrato para implementação/revisão, não uma migração nem comprovação de funcionamento. As migrations históricas C1, B e B1 não são alteradas. Revisar/aplicar manualmente as três candidatas em ordem de timestamp.

A/B/B1/C1 foram **informadas como aplicadas manualmente em desenvolvimento**; isso não foi confirmado por consulta remota. Os comentários históricos `NOT APPLIED` dos arquivos não constituem inventário do ambiente. PostgreSQL local indisponível e daemon Docker indisponível; testes PostgreSQL expressamente adiados, **nenhum teste PostgreSQL executado**, nenhum resultado funcional aprovado e nenhuma segurança concorrente comprovada. Assertions de fonte sem dependências foram executadas separadamente; não validam SQL. Não executar SQL remoto nesta etapa. O documento geral “Modulus — Documento de Projeto | 2026” não foi encontrado no workspace.

Fontes locais: `supabase/migrations/20261026160000_orders_stage72a_schema.sql`, `20261026170000_orders_stage72b_inventory_reservations.sql`, `20261026171000_orders_stage72b1_reservation_guards.sql` e `20261026172000_orders_stage72c1_create_edit.sql` (todos sob `supabase/migrations/`).

## Regras comuns

- Contexto autenticado `business_ready`, tenant e ator derivados no servidor; exigir `sales.write`. Não conceder `inventory.write` ao vendedor como efeito dessas RPCs, nem exigir essa permissão para reservar por pedido.
- **Operações físicas novas: somente plano efetivo `intermediate` com `access_state = 'paid'`**. Não tratar `advanced`, trial, seleção pendente, expiração ou cancelamento como autorização física implícita.
- Criação `untracked` mantém regras comerciais C1, inclusive limite Free histórico de três pedidos por empresa: arquivar/cancelar não devolve cota. Replay não consome cota.
- Identidade, isolamento de empresa e permissão são revalidados em replay. Replay não dá autorização a outro ator/tenant nem a usuário que perdeu `sales.write`.
- Transação única para pedido, itens, contador, reservas, agregado, evento e recibo. Qualquer erro desfaz tudo. Não capturar erro de reserva e prosseguir com efeitos parciais.
- Não há consumo físico nesta etapa: `balance`, ledger `product_inventory_movements` e settlements não mudam. `reserved_balance` aumenta pela soma reservada; versão de inventário aumenta **uma vez por reserva**, não uma vez por produto/pedido.
- Corrigir a leitura de documentos antigos: a igualdade entre agregado e reservas é mantida pelo **protocolo confiável dos helpers e chamadores**, não por trigger agregador. CHECK limita `0 <= reserved_balance <= balance`; não prova igualdade com `sum(active.quantity)`. Reconciliação é diagnóstico, não reparação automática.
- Helpers privados continuam sem EXECUTE para papéis de API; tabelas sem DML direto. RPCs públicas `SECURITY DEFINER`, proprietário confiável, `search_path` vazio, nomes qualificados e EXECUTE apenas para `authenticated`, conforme padrão C1.

## C2a — `create_order` stock-aware

Preservar assinatura e retorno C1:

```sql
public.create_order(
  p_attempt_id uuid, p_buyer_name text, p_buyer_phone text,
  p_buyer_email text, p_buyer_address text, p_notes text,
  p_items jsonb, p_discount_type text, p_discount_input text,
  p_shipping_amount text
) RETURNS TABLE (
  status text, order_id uuid, display_number bigint, version bigint,
  subtotal numeric, discount_amount numeric, shipping_amount numeric,
  total_amount numeric
)
```

Sucesso: `status = 'created'`, versão do pedido `0`; manter recibo `command_name = 'create'`, evento `created` e resposta financeira C1. Decisão física não muda preço, quantidade, descontos, frete ou snapshots comerciais.

### Decisão por produto

| Modo solicitado | Modo persistido / reserva |
| --- | --- |
| `untracked` | Continua `untracked`, sem reserva. |
| `make_to_order` explícito | Continua `make_to_order`, **nunca reservar automaticamente**, mesmo com saldo suficiente. |
| `stock` | Agrupar apenas linhas solicitadas como `stock` por `product_id`. Se a soma do grupo cabe no disponível, todas ficam `stock` e cada item recebe reserva integral. Se não cabe, **todas** ficam `make_to_order`, sem reserva para nenhuma linha do grupo. |

Disponível = `balance - reserved_balance` sob locks; posição inexistente equivale a falta de disponibilidade, não cria saldo/posição artificial. Igualdade exata cabe. Produtos diferentes decidem independentemente. Exemplo: duas linhas `stock` do mesmo produto, quantidades 4 e 4, disponível 6: ambas `make_to_order`; não reservar a primeira e não fracionar. Uma terceira linha explicitamente `make_to_order` não entra na soma e nunca é auto-reservada.

Qualquer modo físico exige produto válido da própria empresa, ativo, não excluído e visível pela regra existente. Produto ausente/inválido/inacessível é erro, não fallback silencioso. Custom sem produto somente `untracked`; custom com produto obedece a mesma política física. Preservar validação estrita C1 de JSON, UUID, quantidades, decimais, limites e origem.

### Normalização e sequência transacional

1. Validação sintática, mutex global `modulus:enterprise-management:all-members`, contexto/permissão, plano; manter serialização de cota e mutex de tentativa C1. Ler/validar recibo existente antes de consultar versão/estado atual de produto ou executar efeitos novos.
2. Converter e validar o payload uma única vez em array efêmero tipado `public.order_items[]` (variável de linha `%ROWTYPE`), com IDs/linhas e valores comerciais. Identificar produtos distintos e adquirir **todos** os locks de produto em ordem UUID; não reconstruir JSON/reinterpretar valores no INSERT.
3. Adquirir **todas** as posições afetadas em ordem determinística UUID antes de reservar qualquer item; decidir os grupos com disponibilidade protegida. Produto é barreira também para ausência/criação de posição. Finalizar snapshots de catálogo a partir dos produtos já bloqueados e validar seus limites antes da primeira escrita.
4. Manter produtos/posições **antes do contador**, como no posicionamento aprovado; validar cota/plano e contador sem `MAX()+1`. Não mover contador para antes dos produtos para acomodar helper.
5. Inserir pedido novo e todos os itens normalizados; somente depois chamar `private.reserve_order_item_stock(uuid,uuid,uuid,uuid,bigint)` para cada item elegível, integralmente. Pedido recém-inserido é privado e pertencente à transação: não precisa de lock de pedido preexistente. Nenhuma outra sessão pode tratar seus itens como publicados antes do commit.
6. Evento e recibo C1, retorno e commit atômicos. Reserva não acrescenta evento `stock_allocated` de C2b à criação nem incrementa versão do pedido recém-criado.

O helper B já valida item completo e atualiza `reserved_balance`/versão do inventário. Não criar outro helper de reserva; os locks externos continuam responsabilidade da RPC. Falha por teto de versão, inconsistência ou helper deve abortar, não ser convertida em falta normal de estoque.

## C2b — alocação explícita posterior

```sql
public.allocate_order_stock(
  p_attempt_id uuid,
  p_order_id uuid,
  p_order_item_id uuid,
  p_expected_version bigint
) RETURNS TABLE (
  status text,
  order_id uuid,
  order_item_id uuid,
  reservation_id uuid,
  version bigint
)
```

- Comando do recibo: **`allocate_stock`**. Sucesso: **`allocated`**.
- Aloca **um único item inteiro**, atualmente `make_to_order`, vinculado ao pedido e empresa corretos, com produto elegível e disponibilidade integral. Não parcial, não multiproduto, não soma automática de outros itens do pedido. Não aloca `untracked` nem duplica item já `stock`/com reserva ativa.
- Rejeitar pedido terminal (`entregue`/`cancelado`), versão esperada divergente, versão fora do limite, parâmetros nulos/inválidos, item ausente/estrangeiro e produto indisponível. Não oferecer transição operacional, pagamento, entrega ou reabertura por essa RPC.
- Na mesma transação, mudar **somente esse item** de `make_to_order` para `stock` **antes** de chamar o helper B para reserva integral. O helper aceita ambos os modos; essa ordem evita alterar modo depois de criar reserva ativa se o guard implantado diferir. Falha na reserva desfaz também a mudança de modo. Após sucesso, incrementar versão do pedido em 1 e emitir um evento `stock_allocated`, com `from_status IS NULL` e `to_status IS NULL`, na nova versão. Estado operacional e valores financeiros permanecem iguais.
- Evento/recibo devem identificar item e reserva de forma verificável; resposta contém exatamente as cinco colunas acima. `reservation_id` corresponde à reserva criada, não a uma reserva consultada arbitrariamente após o fato.

### Ordem de locks e replay

Ordem aprovada: **mutex global de gestão → contexto → resolução/serialização de plano → mutex da tentativa e leitura do recibo → pedido `FOR UPDATE` → leitura do item → produto → posição → reservas → evento/recibo**. A leitura do item é protegida pelo lock do pedido; não inventar lock de reserva antes do produto/posição. Manter locks até commit e usar o mesmo protocolo dos writers B/B1. Não usar o helper para estabelecer autorização ou toda a hierarquia.

A resolução do plano acontece antes do recibo, mas a rejeição por falta de entitlement físico para **nova alocação** ocorre depois da oportunidade de replay válido. Replay deve anteceder comparação com versão atual, modo atual e elegibilidade atual do produto. Owner que fez a operação e sofreu downgrade pode repetir seu recibo, desde que ainda tenha contexto válido e `sales.write`; uma tentativa nova após downgrade deve falhar.

Chave de idempotência: `(enterprise_id, actor_id, 'allocate_stock', attempt_id)`. Hash vincula os argumentos `order_id`, `order_item_id`, `expected_version` na representação canônica existente. Mesma tentativa/payload retorna o resultado **histórico** sem mudar estoque, versão, evento ou recibo; mesma chave com payload diferente: `idempotency_conflict` (`23505`). O `expected_version` antigo é parte do payload: não atualizá-lo para repetir uma tentativa já concluída.

Recibo inválido deve produzir `receipt_result_unavailable` (`P0002`), sem tentar reexecutar. Validar forma/tipos, status, UUIDs, faixa de versão, identidade de pedido/item/reserva e escopo tenant/ator/comando/tentativa. Conferir vínculos históricos e quantidade integral contra item/reserva e evidência de alocação; não basta objeto JSON ou UUID bem formado. A versão do recibo não pode ser futura, mas não precisa ser igual à versão atual. Não exigir produto hoje ativo, plano hoje pago ou reserva hoje `active` para devolver uma resposta histórica legítima. Um validator privado específico é opcional; validação inline é aceitável. Não há outro novo helper planejado.

## C1 preservado e evidências pendentes

### C2c — proteção da substituição integral

`20261026175000_orders_stage72c2c_physical_edit_guard.sql` redefine somente `public.update_order`, com assinatura/retorno/ACL/search_path C1 preservados. Para novas mutações: contexto e `sales.write` → recibo → resolução do plano sob mutex global → pedido `FOR UPDATE` e versão esperada/teto → estado operacional → histórico de reservas → modos físicos persistidos → validação dos novos itens e escrita comercial.

Qualquer item existente `stock` ou `make_to_order`, inclusive demanda sem reserva, impede substituição integral: `physical_order_edit_unsupported` / `P0001`. Payload novo inteiramente `untracked` não contorna essa guarda. Pedidos mistos também são bloqueados. Não modifica nem apaga os itens físicos, reservas, inventário ou histórico. Pedidos inteiramente `untracked` sem histórico conservam o fluxo comercial C1.

Reservas são verificadas antes dos modos físicos, preservando `active_reservation_edit_unsupported` e `reservation_history_edit_unsupported`. A consulta é de rejeição, ordenada por ID como C1, mas sem adquirir lock de reserva antes da barreira produto/posição: o lock do pedido já serializa writers cooperantes. Ao encontrar qualquer reserva, aborta antes de seguir para produtos ou escrita. Se houver estados misturados, conserva o erro correspondente à primeira reserva ordenada, como C1.

Replay legítimo C1/C2c é recuperado antes de novas verificações de versão, estado, reservas ou modos. O JSON de resultado e hash usam os mesmos contratos C1; não gera outro evento nem reexecuta edição. Validações sintáticas iniciais do payload continuam iguais às da C1. Para conflito de versão e pedido terminal simultâneos, versão divergente tem precedência; com versão correta, estado terminal é rejeitado antes de histórico/modo.

Edição física preservando identidade permanece fora do escopo, inclusive alterações exclusivamente comerciais em pedido físico. Uma operação separada poderá ser discutida futuramente; não se libera reserva nem apaga história para viabilizá-la.

O validator de recibos create/update C1 é preservado: verifica identidade, limites e aritmética, mas **não autentica o snapshot monetário histórico original**. Um snapshot financeiro adulterado coerente pode passar; não alegar proteção exaustiva contra corrupção C1. O replay de alocação, por sua vez, deve ser vinculado ao evento histórico e à reserva correspondentes.

Validação manual planejada em `supabase/tests/orders_stage72c2_functional_manual.md`; catálogo/ACL/reconciliação em `supabase/tests/orders_stage72c2_structure_manual.sql`. Os arquivos não aplicam C2 nem autorizam execução remota. Antes de implantação, comparar corpos efetivos, constraints, grants e hierarquia de todos os writers; execução manual futura deve registrar resultado real, não converter este contrato em alegação de aprovação.
