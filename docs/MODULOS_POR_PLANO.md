# Módulos indisponíveis por plano

## Causa

`requireBusinessContext` já faz a autorização paga para `printers.*`, `materials.*`, `spools.*`, `stock.materials.*` e `inventory.*`. O catch de materiais gerais só reconhecia AuthContextError: PlanAccessError caía no ramo técnico/interpretation, com stack. Além disso, os layouts não impedem execução paralela das páginas no Next; formulários novos e consultas podiam iniciar mesmo quando o layout apresentava bloqueio.

## Implementação

- `PaidModuleNotice`: apresentação estática específica por módulo, sem registros reais nem formulário operacional. CTA `/planos`; saída `/home`.
- `PaidModuleGate`: verifica permissão de papel e autorização de negócio na entrada de cada página; função operacional só é executada após autorização. Um bloqueio comercial consulta apenas o estado autorizado do plano para distinguir vencimento/cancelamento, nunca listas pagas. Falha dessa resolução continua técnica.
- 15 páginas protegidas: listagens, novos, detalhes/edição e configuração de impressoras, materiais FDM, carretéis, materiais gerais e produtos prontos. Layouts antigos pagos passam children sem repetir a regra comercial.
- Sidebar mantém links para os módulos e mostra selo textual Visionário com cadeado no owner Aprendiz. Sem prefetch bloqueado; mesma navegação mobile. Permissões de papel continuam filtrando links; precificadora depende de pricing.read, não das fontes pagas.
- Produtos prontos permanece pago porque `inventory.*` já está explicitamente restrito nos helpers e matriz SQL, não por associação a todo estoque. Produtos/catálogos/pedidos e histórico não recebem novo gate pago.
- PlanAccessNotice separa papel/membro, escolha pendente, equipe e falha técnica. Seleção pendente segue `/planos`, fora do layout operacional.
- `/planos` compara planos também após escolha; seleção gratuita inicial continua condicionada ao contrato existente, sem substituir plano. Visionário contratação indisponível; Magnata em breve.
- Actions continuam revalidando autorização e retornando códigos semânticos esperados, inclusive a exclusão compartilhada e o alerta de carretéis. Formulários abertos antes de uma mudança de plano exibem mensagens semânticas em vez de códigos técnicos. Precificadora e históricos V1/V2/V3 não foram alterados nesta tarefa.

Não é necessária migration: a correção trata o contrato existente de autorização na aplicação. Nenhum SQL remoto/reset foi executado; nenhum dado é alterado ao mostrar bloqueio.

## Validação e teste manual

Testes locais usam harness Node já adotado no repositório (mocks de fronteiras), não integração real com Supabase. Executados com sucesso: `node --test tests/paid-module-gate.test.cjs tests/pricing-access.test.cjs` (20 testes), `node --test tests/paid-action-errors.test.cjs` (12 leituras, mutações, mudança de plano, falhas reais/Zod e rethrow), TypeScript e lint focado dos arquivos alterados. Testes existentes do motor FDM e formulário manual também passaram. Lint global reportou 16 erros e 17 avisos fora do escopo, principalmente react-hooks/set-state-in-effect; não foi feita refatoração global.

Em desenvolvimento/homologação:
1. Owner Aprendiz: clicar cada item com selo, conferir apresentação específica e CTA `/planos`. Verificar rede/log servidor sem listagens/contagens/detalhes pagos.
2. Abrir diretamente listagem, novo, `[id]` e configuração; a tela operacional não deve montar, mesmo com busca ou ID válido.
3. Downgrade expirado/cancelado: conferir mensagem de preservação, sem nomes/saldos de registros.
4. Funcionário sem acesso: orientação ao responsável e conta/saída, sem CTA comercial. Owner gratuito com equipe legada mantém recursos gratuitos.
5. Sem escolha: `/planos` sem loop nem seleção automática. Escolha já feita: comparação não permite substituí-la.
6. Visionário autorizado: listagens, novos e edição normais. Mudar plano antes de enviar uma action: código semântico, sem falso erro Zod.
7. Induzir falha real de banco em ambiente isolado: continua indisponibilidade técnica, não apresentação comercial/lista vazia bem-sucedida.
8. Conferir precificação manual Aprendiz, integrada Visionário e histórico por snapshots.

Não houve validação em navegador autenticado ou banco conectado nesta execução; não confundir testes isolados com validação funcional end-to-end.
