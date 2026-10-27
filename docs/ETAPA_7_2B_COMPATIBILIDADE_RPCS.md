# M7.2-B / B.1 — Matriz de compatibilidade das RPCs

**Estado:** M7.2-B informada como aplicada em desenvolvimento; M7.2-B.1 é apenas candidata e NÃO APLICADA. A referência principal é o JSON `pg_get_functiondef` fornecido pelo usuário nesta conversa; não houve conexão remota independente. A migration B.1 foi escrita contra esses corpos fornecidos; ainda depende da conferência de que o banco-alvo não mudou depois da extração.

| RPC | Original remoto fornecido | B.1 proposta | Mudanças explícitas | Contrato preservado / ressalvas |
|---|---|---|---|---|
| `move_product_inventory(uuid,uuid,bigint,text,numeric,numeric,text)` | 7 args; resultado 5 colunas `(status,movement_id,product_id,balance,version)`; SECURITY DEFINER/search_path vazio; contexto central; recovery por actor/attempt antes do produto/versão; produto `active`; produto → posição; versão; `no_change`; movimento físico + ledger transacional. | Mesmo cabeçalho/retorno e corpo fornecido, com coluna `reserved_balance` inicializada como zero para posição virtual e guarda abaixo. | Movimento negativo bloqueia se `abs(q) > balance-reserved`; valida agregado; pós-saldo deve ser >= reservado. Entrada continua permitida se limites atendidos. | Idempotência, auth/context, active, versões, códigos originais e ledger preservados. Conflito reutiliza `insufficient_stock` (`P0003`), código já reconhecido pela action. Posição nova registra `reserved_balance=0`. Não valida visibilidade de plano além do contrato remoto original. |
| `set_internal_product_active(uuid,bigint,boolean)` | 3 args; 3 colunas; context products.delete; janela stage6b; version; no-op success; update e trigger de versão. | Corpo original com ramo somente para transição efetiva para false: lock posição depois produto, checa reservation active, lança `product_has_active_reservations` (`P0001`). | Adicionados lock de posição e EXISTS apenas em archive efetivo. | Assinatura, autorização, janela, retorno/version e activate/no-op preservados. A action atual não mapeia o código novo; poderá apresentar erro genérico. UI/action deliberadamente não alteradas. |
| `delete_internal_product(uuid,uuid,bigint)` | 3 args; 3 colunas; auth + permission; receipt recovery antes de janela; product lock; janela/version; saldo zero; upload; tombstone; soft-delete + receipt. | Corpo original com lock da posição; guarda de reserva adicionada após o bloqueio por saldo físico e antes de upload/soft-delete. | Nova exceção `product_has_active_reservations` depois de product e position locks. | Receipt/idempotência e regras existentes preservadas. Tentativa bloqueada falha sem receipt/product write. Erro não mapeado hoje por Product Action. |

## Locks e premissas

As três funções mantêm contexto central primeiro. Movimento: contexto → receipt (como original) → produto → posição. Archive: contexto → produto → posição → reserva query. Delete: contexto → receipt recovery (como original) → produto → posição → saldo físico → reserva query → upload → update/receipt. Reserva B/M7.2-C precisa serializar no produto antes da posição (e no pedido antes disso) e só então inserir/alterar reservas. Assim, reserve contra movement/archive/delete se serializa no produto; movement também serializa no position. Uma simples EXISTS sem barreira comum não bastaria.

O helper de reserva em B, isoladamente, não prova esse protocolo: o caller M7.2-C deve obter order, produto e posição locks antes de escrever; nenhuma RPC externa de pedido foi implementada ainda. Grants de DML devem continuar negados a API roles e não deve haver outro writer privilegiado de reservas fora do protocolo. B.1 não adiciona trigger para tentar adquirir produto durante DML de reservation: tal trigger poderia inverter locks com command que já segura reserva/posição.

Cancelamento/reabertura: após release (`active→released`), o índice parcial de A permite novo ciclo; item guard de B deixa alteração após resolver a reserva. Entrega consome e grava ledger + settlement apenas quando futuro comando M7.2-C os fizer na mesma transação. A B.1 não altera esses fluxos.

## Diferenças locais / implantação

Comparação com as fontes locais: `move_product_inventory` local está no migration histórico de inventário e coincide estruturalmente com corpo remoto fornecido. `set_internal_product_active` local efetivo está em `20261026080000_product_window_rpc_enforcement.sql` e coincide com o corpo remoto fornecido. `delete_internal_product` local nessa mesma migration usa corpo compacto e coincide semanticamente com o fornecido, incluindo receipt-before-visibility e checks citados. Isso é comparação textual/estática; não confirma estado remoto atual além das definições fornecidas pelo usuário.

B.1 usa `CREATE OR REPLACE`, que preserva ACLs existentes no PostgreSQL; ownership e search_path são explicitamente reafirmados como `postgres` e vazio, compatíveis com as definições fornecidas. Não adiciona grants/revokes. Confirmar o owner e ACL remoto via catálogo antes de aplicação.

## Riscos pendentes

- Não houve parse/execução PostgreSQL, teste funcional ou sessão concorrente real.
- Sem confirmação independente de que B está aplicada nesse banco e de que as definições fornecidas são atuais.
- M7.2-C ainda deve provar que todos os writers de reserva usam locks order → product (UUID) → position (UUID) → reservation e hold até commit. Roles API não podem DML direto.
- `set_internal_product_active`/delete novo erro não é traduzido para erro semântico em `lib/products/actions.ts`; front-end não foi alterado conforme escopo.
- B.1 usa consulta à tabela de reservas após lock da posição, preservando a hierarquia pedida, mas concorrência depende obrigatoriamente da barreira product row em todos os reservation writers.
