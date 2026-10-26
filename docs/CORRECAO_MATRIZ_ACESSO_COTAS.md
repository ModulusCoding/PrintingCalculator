# Acesso não é cota de criação

## Diagnóstico confirmado no código

- `/admin/products` já usa `products.*`, sem `paid:true`, e não recebe selo pago. Não foi confirmado gate pago acidental nessa rota. Já `/estoque/produtos` é um domínio distinto de produtos prontos, restrito explicitamente por `inventory.*`; não foi ampliado por associação.
- Actions de produtos não reconheciam PlanAccessError no catch, convertendo seleção/membro/regularização em erro técnico. Detalhe confundia erro de query com indisponibilidade do registro. UI não distinguia cota de módulo pago.
- Cota SQL já restringe somente criação: três produtos não excluídos no Free; 15 carretéis + materiais gerais não excluídos no Intermediate. Arquivados contam, `public.materials` não participa. Não foi removido enforcement nem inventada cota de impressoras.
- `businessAccessSchema` aceitava access_state arbitrário: agora rejeita estados desconhecidos/inconsistentes como erro técnico, nunca inferindo plano Free.
- RPCs SECURITY DEFINER de mutação de produto/imagem não aplicavam janela embora leitura RLS aplicasse. Corrigido incrementalmente antes de mutação/divulgação de versão.
- Equipe excedente segue regularização existente: owner Free com membros legados conserva operação gratuita, não-owner Free bloqueado; não foi liberado globalmente team_regularization_required no pago.

## Implementação

- Matriz paga explícita central em `lib/plans/permission-capabilities.ts`, consumida pelo contexto e pela apresentação comercial. Produtos, sales legado e pricing snapshots não herdam gate pago de grupo.
- Helper `getCreationCapacity` somente para apresentação de criação, sem depender de página filtrada/janela. Falha de capacidade não impede listagem existente. Não usa endpoint de dashboard owner-only para operadores: nova RPC agrega apenas o recurso que o papel pode criar, sem tenant fornecido pelo cliente.
- Produto: listagem/detalhe/edição continuam operacionais; novo bloqueado quando total não excluído >=3, aviso e /planos. Erro real mantém referência. Produto oculto/ausente não expõe atributos.
- Novos carretéis/materiais gerais: aviso de cota separado de PaidModuleNotice. Listagem/detalhe/movimentação não consultam capacidade nem dependem dela. Actions e quota transacional continuam revalidando criação.
- PaidModuleNotice visual preservado para os módulos realmente pagos. Precificadora, snapshots V1/V2/V3, retries e PRC-001 não alterados.
- Pedidos/clientes de planos ainda não implementados; limites futuros permanecem apresentados como indisponíveis, sem reutilizar closed_sales.

## Migrations novas (não executadas)

- `20261026080000_product_window_rpc_enforcement.sql`: janela em update/active/delete, helpers de imagem/storage; preserva locks, assinaturas e receipt de exclusão antes da janela.
- `20261026090000_creation_capacity.sql`: agregado autorizado por permissão de criação (owner/admin/operador segundo matriz), não altera quota transacional nem libera gestão administrativa.

Aplicar apenas em desenvolvimento identificado após revisão. Nenhuma migration anterior foi alterada. SQL não executado remotamente nem localmente nesta tarefa; teste manual com placeholders está em `supabase/tests/product_window_capacity_manual.sql` e exige fixtures locais.

## Verificações

- TypeScript e lint focado executados.
- Harness Node de capacidade, gates, actions, páginas de novos materiais e precificadora: 36 testes passaram (fronteiras mockadas, não banco real).
- Testes FDM/manual existentes preservados.
- Não houve navegador autenticado, confirmação do plano recebido por uma conta real nem validação SQL integrada. Não confundir revisão das policies/RPCs com execução funcional.

## Teste manual curto

1. Aplicar incrementais em desenvolvimento autorizado; confirmar plano por RPC autenticada, sem service_role na aplicação.
2. Aprendiz owner: listar/editar três produtos; quarto cadastro bloqueia apenas criação. Após downgrade com mais registros, buscar antigo/abrir URL não revela dados. Verificar arquivado ocupa janela e excluído libera posição.
3. Aprendiz: impressoras/carretéis/materiais gerais mantêm apresentação paga; precificadora abre manual sem fontes pagas.
4. Visionário: módulos operacionais; com 15 materiais compartilhados listar/mover/editar permanece possível; 16º cadastro rejeitado. Operador não recebe privilégios administrativos.
5. Pedidos/clientes continuam futuros. Estado desconhecido/erro de banco é indisponibilidade com referência, nunca upgrade falso.
6. Conferir pricing integrado e histórico por snapshots, sem alteração de fórmulas ou ledgers.
