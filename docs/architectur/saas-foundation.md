# Modulus — Fundação do SaaS/CRM

> **Data:** 14/10/2026  
> **Status:** Direção inicial aprovada; detalhes de implementação pendentes  
> **Destino no repositório:** `docs/architecture/saas-foundation.md`

## 1. Objetivo

Estabelecer a base para evoluir a aplicação existente para um SaaS/CRM de gestão de impressão 3D, com módulos integrados e isolamento entre empresas.

A jornada principal será **Produto → Precificação → Inventário → Pedido**. Os cadastros de materiais e impressoras fornecerão parâmetros para a precificação; os pedidos conectarão estoque, produção e análise de resultados.

Este documento registra decisões e limites para iniciar a implementação. Não representa funcionalidades já entregues nem autoriza alterações em produção.

## 2. Referência do estado atual

A referência é o `relatorio.txt` produzido pelo OpenCode em 13/10/2026:

- **Repositório:** `ModulusCoding/PrintingCalculator`.
- **Branch analisada:** `dev`.
- **Commit analisado:** `b4b26efeae1a6a14459697b5735708097775e1f0`.
- **Base existente:** Next.js, TypeScript, Supabase Auth, PostgreSQL, Storage e Server Actions.
- **Recursos aproveitáveis:** login, produtos, catálogos, imagens, registro manual de vendas e calculadoras.

O relatório não executou build, lint ou testes e não inspecionou o banco de produção. Os achados devem ser confirmados no ambiente de trabalho antes de alterações.

**Bloqueio principal:** as políticas RLS descritas no relatório permitem acesso amplo a usuários autenticados e não separam empresas. O cadastro público depende da implementação e verificação do isolamento.

## 3. Decisões adotadas

| Assunto | Direção inicial | Motivo |
| --- | --- | --- |
| Aplicação | Manter Next.js e o repositório atual | Aproveitar a base existente e evoluir incrementalmente |
| Backend | Organizar regras em módulos no servidor | Separar domínio, interface e integrações |
| API separada | Não criar NestJS nesta etapa | Reavaliar quando houver necessidade concreta |
| Autenticação | Utilizar Supabase Auth | Aproveitar os fluxos de identidade e sessão do fornecedor |
| Identidade interna | Criar ID próprio para o usuário do Modulus | Preservar relações de domínio numa troca de provedor |
| Empresas | Banco compartilhado com `enterprise_id` | Simplificar operação e migrations iniciais |
| Participação | Vínculo usuário–empresa com papel e situação | Separar identidade de acesso à empresa |
| Autorização | Permissões gerenciadas pelo Modulus | Evitar dependência exclusiva das claims do token |
| Assinatura | Plano por empresa, com uso compartilhado | Atender equipes e operações de impressão |
| Migrations | SQL versionado como fonte da verdade | Aproveitar a estrutura atual e evitar ferramentas concorrentes |
| Segurança dos dados | Validação no servidor e RLS | Aplicar isolamento em operações e banco |
| Testes iniciais | Vitest e testes de integração quando necessários | Verificar regras e isolamento com evidência apropriada |
| Integração contínua | GitHub Actions com verificações automáticas | Detectar problemas antes da implantação |

Os três planos existirão, mas seus recursos, preços e limites comerciais ainda não estão definidos.

## 4. Autenticação preparada para desacoplamento

### 4.1 Responsabilidades

| Camada | Responsabilidade |
| --- | --- |
| Provedor de autenticação | Credenciais, emissão de tokens, sessões e recuperação de acesso |
| Integração de autenticação | Validar a sessão e traduzir a identidade externa para o usuário interno |
| Domínio do Modulus | Usuários internos, empresas, vínculos, permissões, assinaturas e limites |
| Módulos operacionais | Aplicar regras de produtos, precificação, inventário e pedidos |

O Supabase Auth será o provedor inicial. Os módulos operacionais devem trabalhar com o contexto interno do Modulus, sem interpretar diretamente tokens ou depender de objetos de usuário do SDK.

### 4.2 Identidade interna

- Cada usuário terá um ID interno independente do ID do provedor.
- A identidade externa será associada ao usuário interno por emissor/provedor e identificador externo.
- E-mail não deve ser usado como identificador imutável de associação.
- Registros de autoria devem referenciar o usuário interno.
- Dados operacionais pertencem à empresa; a participação do usuário determina seu acesso.

A estrutura física dessas tabelas será definida na etapa 2.

### 4.3 Contexto de acesso

O módulo central deverá fornecer, de forma conceitual:

```ts
type AccessContext = {
  userId: string;
  enterpriseId: string;
  membershipId: string;
};
```

Este exemplo descreve o contrato esperado, não uma implementação aprovada. A empresa selecionada precisa ser validada contra o vínculo ativo do usuário antes de compor o contexto.

### 4.4 Tokens e autorização

- Utilizar os tokens e sessões do Supabase Auth inicialmente.
- Não emitir um segundo JWT apenas para ocultar o fornecedor.
- Validar a autenticidade e validade da sessão no servidor.
- Cada usuário tem sua própria identidade e sessão; não haverá token compartilhado por empresa.
- Plano, situação do membro e permissões não terão o token como única fonte de verdade.
- A retirada de acesso e mudanças de assinatura devem ser aplicadas pelo servidor conforme a política de atualização definida.

### 4.5 Limites do desacoplamento

Centralizar a integração reduz o alcance de uma migração futura, mas não elimina a necessidade de migrar contas, sessões, fluxos de recuperação e a ligação com a RLS.

**Pendente:** definir como a identidade validada pelo Supabase será traduzida para os IDs internos nas políticas de banco. Um JWT próprio não passa a funcionar automaticamente com `auth.uid()`.

## 5. Empresas, permissões e planos

### Empresas

- Toda entidade operacional deve ser vinculada à empresa, diretamente ou por uma relação cuja integridade assegure o isolamento.
- Relações não podem associar registros de empresas diferentes.
- A operação existente da Modulus será vinculada a uma empresa inicial durante a migração.

### Membros e permissões

- Preparar o modelo para múltiplos usuários por empresa.
- Separar papel e situação do membro dos recursos contratados.
- Validar autorização nas operações do servidor; esconder elementos na interface não substitui esse controle.
- Definir papéis, convites e participação em múltiplas empresas antes de implementar os respectivos fluxos.

### Assinaturas

- A assinatura pertence à empresa.
- Recursos e limites comerciais serão configuráveis.
- Limites sujeitos a concorrência precisam de operações atômicas no banco.
- Rate limiting de requisições não substitui limite de plano.
- Cobrança do SaaS será separada dos pagamentos dos pedidos dos clientes.

## 6. Organização do código

Manter a aplicação atual e separar responsabilidades gradualmente. Organização conceitual sugerida:

```text
lib/auth         → integração de autenticação
lib/tenancy      → contexto e vínculos com empresas
lib/permissions  → autorização
lib/pricing      → regras puras de precificação
lib/orders       → regras de pedidos
```

As Server Actions devem validar entradas, obter contexto autorizado e coordenar operações. Fórmulas e regras de domínio devem poder ser testadas sem renderizar páginas.

Não adicionar ORM nem reorganizar todo o repositório nesta etapa. Evitar dependências do SDK de autenticação nos módulos de negócio; a integração com o banco será evoluída de forma delimitada.

## 7. Escopo da etapa 1

### Preparação

- [ ] Revisar o estado Git e preservar alterações existentes.
- [ ] Criar uma branch de trabalho, como `feat/saas-foundation`.
- [ ] Adicionar este documento ao repositório.
- [ ] Executar instalação pelo lockfile, lint, verificação de tipos e build.
- [ ] Registrar falhas preexistentes e corrigir bloqueios em mudanças pequenas.
- [ ] Verificar o `.env.example` e substituir valores inadequados por placeholders.
- [ ] Rotacionar segredos reais caso a exposição seja confirmada, sem publicar seus valores.
- [ ] Preparar um ambiente Supabase de desenvolvimento separado de produção.
- [ ] Configurar Vitest e poucos testes úteis sobre comportamentos existentes.
- [ ] Configurar GitHub Actions para lint, tipos, testes e build.

### Fora desta etapa

- Abrir cadastro público.
- Implementar toda a estrutura de empresas e RLS.
- Criar NestJS ou migrar para monorepo.
- Refatorar integralmente as calculadoras.
- Implementar inventário, pedidos novos ou cobrança.
- Executar migrations ou deploy em produção.

## 8. Verificações e CI

Verificações iniciais, executadas separadamente:

```bash
npm ci
npm run lint
npx tsc --noEmit
npm run build
```

Após configurar testes, incluir sua execução no fluxo de integração contínua. O CI deve funcionar sem credenciais de produção.

| Tipo de teste | Aplicação |
| --- | --- |
| Unitário | Conversões monetárias, validações e regras de domínio |
| Integração | RLS, vínculos entre empresas, transações e limites concorrentes |
| Fluxo completo | Cadastro, produto, precificação, inventário e pedido, em etapas futuras |

Testes unitários não comprovam o isolamento RLS. Esse isolamento precisa ser verificado com usuários e dados de empresas diferentes no banco de testes.

## 9. Controle do trabalho com OpenCode

O desenvolvimento será conduzido por tarefas pequenas, com revisão do responsável antes de ampliar o escopo.

1. Fazer diagnóstico sem alterações.
2. Delimitar objetivo e arquivos permitidos para a tarefa.
3. Implementar apenas o escopo combinado.
4. Informar mudanças, motivos e verificações realmente executadas.
5. Revisar o diff e criar commits pequenos.

Não realizar atualizações gerais de dependências, refatorações amplas, push, deploy ou migrations de produção como consequência automática de uma tarefa local.

Comandos de revisão:

```bash
git status
git diff --stat
git diff
```

Decisões arquiteturais que possam gerar retrabalho significativo devem ser discutidas antes da implementação.

## 10. Decisões pendentes para a etapa 2

| Decisão | O que precisa ser definido |
| --- | --- |
| Modelo de identidade | Tabelas e associação entre identidade externa e usuário interno |
| RLS | Como identificar o usuário interno e validar participação sem ampliar acesso |
| Onboarding | Criação de usuário, empresa e proprietário com retomada segura após falhas |
| Participação | Se um usuário poderá acessar várias empresas no lançamento |
| Papéis | Permissões iniciais de proprietário, administrador e operador |
| Cadastro público | Momento de habilitação após testes de isolamento |
| Catálogo público | Quais dados podem ser publicados sem expor informações internas |
| Migração | Vinculação dos dados existentes à empresa inicial e preservação do histórico |
| Revogação | Política para aplicar bloqueio de membro e mudanças de permissões |

## 11. Critério de conclusão

A etapa 1 estará concluída quando as decisões estiverem registradas, o ambiente de desenvolvimento separado, as verificações executadas com seus resultados conhecidos e o CI básico funcionando.

O próximo marco será implementar **usuários internos, empresas, membros e isolamento**, antes de abrir o cadastro público. O primeiro fluxo de produto será: criar empresa → cadastrar produto → precificar com dados da empresa → salvar o resultado.
