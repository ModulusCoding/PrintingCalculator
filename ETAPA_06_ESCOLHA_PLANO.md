# Escolha inicial e Meu plano — incremento 6

## Implementado neste checkout

- `/planos`: rota autenticada fora do layout operacional; apresenta Aprendiz (gratuito), Visionário (R$ 39,90/mês, sem fidelidade) e Magnata (R$ 79,90/mês, em breve).
- Somente o owner pode confirmar o Aprendiz. Visionário não possui checkout, seleção persistida, cartão nem autorização temporária. Magnata não é ativável.
- `/meu-plano`: owner pode consultar plano selecionado/efetivo, estado, validade, limites e uso agregado mesmo com seleção/regularização pendente.
- Layout operacional consulta `get_my_plan_access`: ausência de seleção encaminha a `/planos`; as páginas de plano, conta, troca obrigatória de senha e logout não dependem desse layout. Sem contexto empresarial válido, permanece o fluxo `/conta`/onboarding existente.
- `/home` oferece entrada para a precificadora; o modo manual e os bloqueios pagos existentes não foram substituídos por controle de menu.

## Migration incremental

`supabase/migrations/20261026050000_initial_free_plan.sql`

`public.select_initial_free_plan()` não recebe parâmetros. Usa sessão Supabase/contexto empresarial, confirma identidade interna ativa, usuário sem troca obrigatória de senha, membership owner único e empresa ativa sob a ordem de locks administrativos existente. Retorna uma linha `status`:

- `selected`: criou/atualizou a ausência de seleção para `free/free/free`, incrementou a versão e gravou uma auditoria `free_selected`.
- `no_change`: Aprendiz já confirmado; nenhuma mudança de versão/timestamp/auditoria.
- `conflict`: estado já não elegível (incluindo pago, expired, cancelled ou histórico de autorização); a interface deve atualizar sua leitura, sem downgrade.
- Falha de identidade/permissão: SQLSTATE `42501`.

A função não recebe empresa, ator ou plano do navegador. `SECURITY DEFINER`, `search_path=''`, owner postgres, EXECUTE somente authenticated (revogado também de service_role). Não altera recibos, concessão paga ou cancelamento. A seleção usa o mesmo lock global que as mutações de planos, incluindo quando ainda não existe linha.

`public.get_my_plan_usage()` também não recebe parâmetros e só permite owner empresarial válido. Retorna contagens agregadas `products`, `shared_materials`, `operators`, `printers`. Produtos/carretéis/materiais gerais não excluídos incluem arquivados; `public.materials` não entra na soma compartilhada. Impressoras não possuem soft-delete no schema atual: conta todos os cadastros da empresa. Operadores são memberships ativos, não operações pendentes. Não expõe listas/atributos de materiais pagos. Falha de consulta não é apresentada como zero.

Pedidos e clientes continuam não implementados; nenhum módulo ou contagem foi criado. A cota comercial de pedidos é informação do plano, não funcionalidade disponível.

## Segurança da action

A confirmação usa cliente autenticado e `resolveMinimalIdentity`, sem exigir escolha prévia de plano. Resposta é validada. Falhas de transporte/retorno inválido são resultado incerto e permitem repetir a mesma operação idempotente. Sucesso revalida o layout e permite seguir ao Hub. Conflito atualiza o estado exibido.

## Validação / pendências

O usuário informou que as migrations anteriores da etapa 6 foram aplicadas no banco exclusivo de desenvolvimento. Isso não equivale a testes funcionais aprovados. Nenhuma migration ou assertion deste incremento foi executada por este agente: não foi identificada conexão PostgreSQL autorizada disponível (`psql` ausente e nenhuma DATABASE_URL/DIRECT_URL/SUPABASE_DB_URL/PGHOST configurada em `.env.local`). Não houve reset, commit, push ou deploy.

As assertions novas usam fixtures próprias e rollback. Concorrência real exige duas conexões ao mesmo banco de desenvolvimento e permanece pendente até execução autorizada. Também permanecem pendentes navegação real com sessão, seleção/retry, carregamento manual e bloqueios pagos, RLS, regularização e demais testes funcionais anteriores de 6B/6C. Pendências conhecidas de V3, equipe/provisionamento e policies não foram resolvidas ou declaradas validadas por esta entrega.

Verificações executadas: `npx tsc --noEmit` passou; ESLint focado nas novas rotas/action, layout/shell/home, conta e lib/plans.ts passou; `git diff --check` passou com avisos de conversão LF/CRLF. Assertions SQL não executadas. Os documentos antigos descrevem o estado histórico dos incrementos; este arquivo registra o estado atual desta implementação.
