# Produtos internos multiempresa — primeiro incremento

> Plano revisado para o dev que contém somente o núcleo SaaS (`users`, `auth_identities`, `enterprises`, `enterprise_members` e operações privadas). As migrations históricas da calculadora **não são pré-requisitos**. A migration `supabase/migrations/20261015150000_internal_products_multitenancy.sql` cria diretamente as tabelas internas de produtos, ainda não foi aplicada e não comprova o estado remoto. Não é um plano de migração de produção.

## Escopo e evidências

- Código existente: `app/(authenticated)/admin/products/{page.tsx,new/page.tsx,[id]/page.tsx}`, `components/admin/{ProductForm,ImageUpload,DeleteProductButton}.tsx`, `lib/products/actions.ts`, `lib/storage/actions.ts`, `lib/image/process.ts` e `lib/validations.ts`. A navegação já está no shell, mas as actions antigas só validam sessão Auth, não empresa/papel, e executam várias queries não transacionais. **Não foram adaptadas nesta tarefa.**
- Migrations existentes: `20260818000000_create_catalogs_and_products.sql` (`products`, catálogos, relações, buckets/policies), `20260831000000_make_product_price_nullable.sql`, `20260901000000_create_product_images.sql`, `20261001000000_create_catalog_filters.sql`, `20260826000000_create_closed_sales.sql`, `20261014193600_create_auth_tenancy_access_context.sql` (helpers `private.can_access_enterprise` e `get_my_access_context`) e `20261015140000_enterprise_member_management_hardening.sql` (ordem de locks). `lib/auth/context.ts` confirma `products.read`/`write` para owner/admin/operator e `products.delete` para owner/admin.
- A fonte do tenant é a identidade Auth (`auth.uid()` + issuer configurado), usuário interno e exatamente um vínculo ativo em empresa ativa; nunca um UUID de empresa enviado pelo navegador. O helper SQL central decide a permissão e os estados de senha/identidade; o helper novo somente bloqueia e revalida esses mesmos registros, não cria outra matriz.
- A migration verifica primeiro se `public.products` ou `public.product_images` já existem e aborta com mensagem clara; não usa `IF NOT EXISTS` nem apaga/recria estruturas. Depois cria somente essas duas tabelas. Não cria nem exige catálogos, associações, filtros ou vendas. Usuários, identidades, empresas, membros e operações privadas permanecem intactos. Não aplicar automaticamente na produção: produção necessita inventário, mapeamento aprovado dos dados legados, migration própria e estratégia de continuidade. Ordem do dev: núcleo SaaS já aplicado → esta migration → adaptação posterior de actions/telas. Não executar indiscriminadamente as migrations históricas da calculadora.

## Modelo e comandos preparados

- `products`: `enterprise_id UUID NOT NULL` com FK; `id` UUID preservado; `version BIGINT NOT NULL DEFAULT 0` incrementado por trigger em cada UPDATE; nome, descrição, preço nullable com limites do cadastro existente; `active=true` disponível **internamente**, `false` arquivado. Sem DELETE de produto por cliente. `slug` continua obrigatório por compatibilidade, gerado internamente a partir de UUID, sem unicidade adicional ou semântica pública. Imagens continuam representadas por `image_url` legada e `product_images`, mas novas RPCs não aceitam URL arbitrária.
- `product_images`: `enterprise_id UUID NOT NULL`; FK `(enterprise_id,product_id)` para UNIQUE `(enterprise_id,id)` de produto, UNIQUE `(enterprise_id,product_id,url)` e UNIQUE legada `(product_id,display_order)`, com CHECK de ordem 1–3. Trigger impede mover imagem entre produtos/empresas; trigger de produto impede mudança de empresa. Índice `(enterprise_id,active,created_at DESC)` atende listagem empresarial; índices PK/UNIQUE não são duplicados.
- Leitura: sessão `authenticated` com SELECT de colunas explícitas e RLS `private.can_access_enterprise(enterprise_id,'products.read')`; sem leitura pública das tabelas internas.
- Mutações: apenas RPCs estreitas SECURITY DEFINER, `postgres`, `search_path=''`, EXECUTE somente authenticated; sem `service_role` no CRUD. `create_internal_product(p_name,p_description,p_price,p_images DEFAULT '[]')` retorna `(status,product_id,version)`; `update_internal_product(p_id,p_expected_version,p_name,p_description,p_price,p_images DEFAULT '[]')` idem; `set_internal_product_active(p_id,p_expected_version,p_active)` idem. As versões são comparadas sob lock do produto. Estados previstos: `success`, `invalid_input`, `permission_denied`, `product_unavailable`, `version_conflict`. Produto de outra empresa não revela existência (`product_unavailable`). `products.delete` é exigido para arquivar **e restaurar**; `products.write` não altera `active` por UPDATE direto.
- Imagens: `p_images` é por ora contrato **fechado**: somente JSON `[]` é aceito; qualquer URL, path ou objeto retorna `invalid_input`. Criação/edição sem imagens ocorre numa transação PostgreSQL. Edição preserva registros de imagem existentes. Na próxima etapa, após implementar upload empresarial comprovável, ampliar esse parâmetro/contrato para aceitar somente paths registrados e pertencentes ao produto/empresa, validar até três imagens, ordem 1–3 e duplicações, e atualizar produto/imagens na mesma RPC/transação. Não chamar Storage dentro da transação nem presumir rollback de objetos externos. Por ora nenhum upload está autorizado.

## Autorização concorrente e integridade

RPCs primeiro validam entrada e então adquirem advisory lock global `modulus:enterprise-management:all-members`, antes de qualquer linha de domínio; a seguir contexto inicial, advisory lock do ator `modulus:employee-provisioning:actor:<issuer>:<uid>`, identidade ativa, usuário ativo sem troca de senha pendente, vínculo ativo, empresa ativa e revalidação do contexto e permissão SQL. Só depois a edição/arquivamento bloqueia o produto da empresa com `FOR UPDATE`. Isso segue a ordem dos comandos de empresa/membros e do provisionamento/retomada; o lock global serializa as mutações administrativas locais mesmo quando dois atores de empresas distintas têm vínculos cruzados. Não é mantido em operações externas de Storage. Os triggers/FKs protegem tenant e o controle de versão impede sobrescrever edições/arquivamentos obsoletos. Alterações administrativas diretas fora desses comandos precisam respeitar seus próprios protocolos de autorização.

## RLS, grants e Storage

| Superfície | Mudança nesta migration |
|---|---|
| `products`, `product_images` | Tabelas novas: RLS habilitada, SELECT somente a `authenticated` com `products.read`, grants explícitos de leitura por coluna e nenhuma escrita direta para cliente. Não há policies públicas ou antigas a remover neste dev. |
| `catalogs`, relações, filtros e `closed_sales` | Nenhuma referência, criação, revogação ou fechamento: não existem no dev e estão fora desta migration. Se aparecerem em outro ambiente, exigem revisão e migration própria; não fazer backfill automático. |
| `storage.objects`, buckets `products` e `catalogs` | Somente se `storage.objects` existir: remove os nomes conhecidos de policies legadas de escrita e instala policies RESTRICTIVE por operação que bloqueiam escrita nesses nomes de bucket para anon/authenticated. Não cria bucket, não toca objetos e não afeta outros buckets. Leitura pública eventual por URL não é confidencial. |

Antes de aplicar, conferir ownership e policies de Storage efetivamente presentes. A migration não altera, move ou renomeia objetos de Storage.

## Impacto temporário e próximas tarefas

As telas antigas de produto ainda enviam `slug`, `catalog_ids` e URLs de imagem; essas actions fazem INSERT/UPDATE direto e **não funcionam contra o novo modelo** até a adaptação às RPCs. Páginas/actions de catálogos, filtros e vendas e o leitor `/catalogo/[slug]` continuam no código, mas suas tabelas não existem neste dev; bloquear suas entradas de navegação/execução na próxima etapa, antes de oferecer a aplicação como funcional. Não há vitrine pública no MVP. Adaptar telas existentes ao shell único, sem criar outra administração. Não publicar ou vincular produtos a catálogos, nem adicionar estoque, precificação, impressoras ou pedidos. Nenhuma alteração na aplicação em produção nesta entrega.

## Roteiro essencial de validação controlada (após aprovação)

1. Aplicar somente no dev comprovadamente vazio; inserir uma linha em cada tabela operacional em ambiente descartável e confirmar erro claro + rollback integral. Conferir que identidade/membros/operações de teste permanecem inalterados.
2. Criar owner/admin/operator nas empresas A e B; validar leituras próprias e negar leitura por ID e queries diretas cruzadas, inclusive `product_images` e leitura anon.
3. Os três papéis criam/editam produtos; operator não arquiva/restaura; owner/admin conseguem via RPC `products.delete`. Tentativa de UPDATE direto em `active`, empresa, imagens ou DELETE físico deve falhar.
4. Concorrência: duas versões iguais, primeira alteração vence e segunda retorna `version_conflict`; incluir disputa edição × arquivamento e conferir que a versão só avança em mudança realizada.
5. Testar identidade, usuário, vínculo e empresa inativos, `must_change_password`, ator com dois vínculos ativos, sessão sem issuer válido; negar mutações mesmo com JWT ainda válido.
6. `p_images` não vazio, preço negativo/alto, nome/descrição fora dos limites e versões nulas/negativas retornam `invalid_input`; URLs sem ownership são rejeitadas; nenhuma chamada toca Storage.
7. Testar FK composta e imutabilidade cross-tenant. Se `storage.objects` existir, testar o bloqueio de escrita nos nomes `products` e `catalogs` sem afetar outro bucket; não presumir buckets ou URLs legadas.
8. Após adaptação de UI, conferir fluxos no shell e bloquear as telas legadas que dependem de tabelas ausentes.

## Decisões pendentes e limitações

- Aprovar que imagens fiquem **temporariamente indisponíveis para novos produtos** até o upload com ownership verificável; não usar URL recebida do cliente como prova. Definir contrato de objeto/path do próximo incremento.
- Confirmar quando adaptar/bloquear as rotas legadas em dev, antes de uso por usuários finais; a migration isolada interrompe essas rotas intencionalmente.
- Produção exige inventário/mapeamento de legado e migration própria; esta migration foi desenhada para **abortar** com dados operacionais existentes, jamais atribuí-los automaticamente à primeira empresa.
- Nenhum SQL ou migration foi executado; o estado remoto, grants por coluna, policies extras e arquivos nos buckets não foram consultados. Lint, TypeScript e build não executam nem demonstram validade das funções PostgreSQL.
