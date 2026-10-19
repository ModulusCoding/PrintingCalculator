# Módulo FDM de Carretéis

O módulo controla o estoque físico de filamento por empresa. Cada carretel referencia um material, possui identificador interno único, peso original, saldo, preço de compra, versão otimista e estado ativo/arquivado.

## Acesso

- `spools.read`: lista, detalhes, material e histórico.
- `spools.write`: criação e movimentações em carretéis ativos.
- `spools.archive`: edição do identificador, arquivamento e restauração. Operadores não veem estes controles.
- `enterprise.manage`: limite percentual de estoque baixo.

As ações de servidor repetem autenticação e autorização; esconder controles na interface não é o mecanismo de segurança.

## Movimentações e custo

Abertura, consumo, reposição e ajuste formam um livro-razão imutável. Quantidades têm sinal no histórico e registram saldos anterior e posterior. O custo direto de uma movimentação é `abs(quantidade) × preço de compra ÷ peso original`.

Criação e movimentação usam `attempt_id`. Depois de uma incerteza de transporte, a interface congela exatamente os dados enviados e permite repetir somente a mesma tentativa idempotente. Descartar essa tentativa inicia outra identidade e exige que o usuário confira o estado atual. Edição, arquivo e configuração usam versão otimista; em incerteza ou conflito, atualize a página antes de reenviar.

## Navegação

A lista aceita `search` (até 120 caracteres), `status` (`active`, `low`, `empty`, `archived`, `all`) e página positiva. Links de detalhe carregam um `returnTo` validado, limitado à própria lista e aos parâmetros conhecidos. A paginação do histórico preserva esse retorno.

## Listagem e detalhes

A listagem é paginada no servidor e consulta também a configuração de estoque baixo. Exibe material, marca/cor, saldo, percentual e estado. O detalhe exibe custo por grama, preço e peso originais, percentual restante, dados completos do material e histórico localizado em pt-BR. A autoria nunca expõe UUID: mostra `Você` ou `Membro da equipe`.

## Validação

Entradas decimais usam texto e `inputMode="decimal"`, aceitando vírgula pt-BR. Schemas estritos limitam escala, faixa, UUID, versão e combinações válidas. Respostas RPC também são validadas, incluindo invariantes de saldo e versão. Falhas de invalidação de cache não alteram o resultado confirmado de uma escrita.

## Verificação

Execute:

```sh
npx eslint "lib/spools/**/*.{ts,tsx}" "components/spools/**/*.{ts,tsx}" "app/(authenticated)/estoque/carreteis/**/*.{ts,tsx}" "app/(authenticated)/layout.tsx" "app/(authenticated)/AuthenticatedShell.tsx"
npx tsc --noEmit
npm run build
```
