# Estoque de produtos prontos

Implementação da interface e Server Actions para o saldo físico de peças prontas por produto.

## Rotas

- `/estoque/produtos`: listagem paginada, busca literal e filtros independentes de saldo e situação do produto.
- `/estoque/produtos/[id]`: detalhe do saldo, entrada, saída, ajuste por conferência e histórico paginado.

As páginas são Server Components. Formulários de movimentação são Client Components e usam somente as Server Actions/RPCs autorizadas.

## Contratos RPC usados

Não há acesso direto às tabelas de estoque. O módulo usa exclusivamente:

- `list_product_inventory` e `count_product_inventory`;
- `get_product_inventory_detail`;
- `list_product_inventory_movements` e `count_product_inventory_movements`;
- `move_product_inventory`.

A posição inexistente é apresentada como saldo e versão `0`. O detalhe distingue a linha completamente nula de produto indisponível de respostas parcialmente nulas, tratadas como falha técnica.

## Regras de movimentação

- Unidades inteiras: entrada/saída de `1` a `1.000.000.000`; saldo contado de `0` a `1.000.000.000`.
- A entrada inicial pode registrar peças existentes antes do Hub; ela não comprova produção.
- As movimentações são manuais, não movimentam carretéis e não alteram precificações.
- Produto arquivado preserva saldo e histórico, mas bloqueia novas movimentações até ser restaurado em Produtos.
- Não há custo médio, FIFO, custo de produção, valorização, pedidos ou reservas neste incremento.

## Concorrência e idempotência

O formulário envia `inventory_version`, não `products.version`. A confirmação congela produto, tipo, valor, motivo normalizado, versão e `attemptId`.

Após despacho, uma falha de transporte ou uma resposta inválida é `uncertain`: os campos ficam congelados e a única repetição disponível usa exatamente a mesma tentativa. Não há retry automático nem novo `attemptId` para contornar incerteza. Resultado `created`/`idempotent` é histórico e não é usado como saldo atual; a página é atualizada separadamente.

`no_change` é informado sem movimento criado. Como essa operação não é persistida pela RPC, uma repetição após outra alteração pode receber `version_conflict`.

## Permissões

`inventory.read` e `inventory.write` são exigidas em cada leitura/action relevante. Owner, admin e operator possuem ambas. A navegação é apenas conveniência; a autorização final é da action e da RPC.

## Limitação conhecida do SQL aplicado

A migration aplicada deve permanecer inalterada. Caso seja necessário alterar contratos ou regras de banco, isso requer uma migration incremental revisada; a interface não executa SQL nem usa service role.
