# Módulo FDM de Carretéis

O módulo controla o estoque físico de filamento por empresa. Cada carretel é um cadastro completo: possui identificador interno único, tipo de filamento, marca e cor opcionais, peso original, saldo, preço real de compra, versão otimista e estado ativo/arquivado.

`materials` permanece como entidade de referência da precificadora durante a transição. Carretéis antigos podem manter `material_id`; carretéis novos não o exigem nem criam material oculto. Alterações posteriores em `materials` não modificam atributos próprios do carretel.

## Acesso

- `spools.read`: lista, detalhes e histórico.
- `spools.write`: criação e movimentações em carretéis ativos.
- `spools.archive`: edição do perfil (identificador, tipo, marca e cor), arquivamento e restauração. Operadores não veem esses controles.
- `enterprise.manage`: limite percentual de estoque baixo.

As ações de servidor repetem autenticação e autorização; esconder controles na interface não é o mecanismo de segurança.

## Campos e edição

A criação exige identificador (1–120), tipo (1–80), peso original, saldo inicial e preço. Marca (até 120) e cor (até 80) são opcionais. Texto é normalizado; gramas aceitam até três casas e preço até duas.

A edição de perfil é atômica e usa versão otimista. Peso original e preço de compra continuam estruturais/imutáveis: não são alterados pela edição de perfil nem por movimentos. Em carretéis legados sem atributo retropreenchível, o campo permanece vazio, sem valor fictício.

## Movimentações e custo

Abertura, consumo, reposição e ajuste formam um livro-razão imutável. Quantidades têm sinal no histórico e registram saldos anterior e posterior. O custo direto de uma movimentação é `abs(quantidade) × preço de compra ÷ peso original` e permanece histórico.

Criação e movimentação usam `attempt_id`. Depois de uma incerteza de transporte, a interface congela exatamente os dados enviados e permite repetir somente a mesma tentativa idempotente. Edição, arquivamento e configuração usam versão otimista; em incerteza ou conflito, atualize a página antes de reenviar.

## Navegação e compatibilidade

A lista aceita `search` (até 120 caracteres), `status` (`active`, `low`, `empty`, `archived`, `all`) e página positiva. A busca considera identificador, tipo, marca e cor. Links de detalhe carregam um `returnTo` validado e a paginação do histórico preserva esse retorno.

A precificadora ainda lê `materials`, e seus snapshots não são modificados por este módulo. Carretéis novos não são selecionáveis nela até a etapa de integração específica.

## Verificação

Após aplicar a migration em banco local isolado, execute:

```sh
npx eslint "lib/spools/**/*.{ts,tsx}" "components/spools/**/*.{ts,tsx}" "app/(authenticated)/estoque/carreteis/**/*.{ts,tsx}"
npx tsc --noEmit
npm run build
```

A migration `20261021000000_complete_filament_spools.sql` deve ser aplicada manualmente no desenvolvimento; não foi aplicada remotamente por esta etapa.
