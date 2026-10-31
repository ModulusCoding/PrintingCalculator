# Refatoração Visual 04 — Precificadora

Data: 28/10/2026. Implementação e verificações locais concluídas; homologação visual/interação real e PostgreSQL **pendentes**. Não interpretar build ou testes com mocks como aceite integral de produção.

## 1. Referências e inspeção

Inspecionados HTML e screenshots em `design-references/stitch_modulus_3d_editor/precificadora_guiada_por_etapas_modulus_hub/` e `precificadora_modulus_hub/`, além de `README.md` e `lumina_system/DESIGN.md`. Reaproveitados agrupamentos, hierarquia de cards, revisão e destaque do resultado. Prevalecem paleta oficial e Space Grotesk herdada; nenhum CDN, dado financeiro fictício ou integração do mock foi copiado.

`app/calculator/page.tsx` serviu de referência para avanço/retorno e resumo contextual. Diferenças preservadas: calculadora pública possui sete etapas, dados locais, moedas, impostos, marketplace e consumo/tempos por peça. O Hub usa tempos e filamento do lote, motor FDM, contratos V2/V3, fontes autenticadas, snapshots e histórico. Não foram importadas fórmulas, cache ou validações permissivas da página pública. O salto direto do novo wizard valida todos os painéis anteriores.

## 2. Arquivos desta entrega

- `components/pricing/PricingWizard.tsx`: shell compartilhado, seis painéis montados, progresso, validação DOM/domínio, foco e input acessível.
- `components/pricing/ManualPricingSimulator.tsx`: modo manual no wizard, linhas com identidades estáveis, produto/revisão, resultado, recuperação da mesma tentativa.
- `components/pricing/PricingSimulator.tsx`: modo integrado, seleção/versionamento preservados, campos auditados e retry congelado.
- `lib/pricing/input.ts`: regras e mensagens reutilizáveis.
- `lib/pricing/parse.ts`: agrupamento pt-BR rigoroso e trim consistente em durações.
- `tests/pricing-wizard.test.cjs`: harness de módulos TS/TSX reais e regressões.
- `docs/UI_PRICING_FIELD_AUDIT.md`: inventário anterior à implementação, limites, precisão, dependências e decisões.
- Este relatório.

Motor, ações, schemas de persistência, autenticação, RLS, migrations históricas, histórico e aplicação não foram modificados por esta tarefa. O workspace contém mudanças anteriores de outros escopos, preservadas.

## 3. Etapas e comportamento

1. **Impressora e energia:** parâmetros manuais ou seleção de fonte; tarifa local.
2. **Filamento:** linhas manuais ou carretéis; consumo do lote e perda.
3. **Embalagens:** referências manuais ou materiais cadastrados, unidade e aplicação por peça/lote.
4. **Lote e custos:** quantidade, impressão e acabamento, mão de obra, fixo e acréscimo. Embalagem adicional fica na etapa 3 manual/4 integrada, conservando organização dos contratos.
5. **Revisão:** contexto e produto opcional para simular, obrigatório para salvar.
6. **Resultado:** valores reais do motor, discriminação e salvamento; link ao histórico para revisão/aplicação.

Desktop: stepper de seis colunas a partir de 1100px e formulário/resumo lado a lado a partir de 1200px. Tablet: grupos em duas/três colunas conforme espaço. Mobile: painéis empilhados e stepper em duas colunas, sem painel fixo. `min-w-0` e ações com quebra reduzem risco de overflow, mas não substituem medição real.

Painéis permanecem montados com `hidden`. Voltar não apaga valores. Avançar e saltar validam etapas anteriores; erro ativa mensagem local e tenta focar primeiro input inválido. Seleções obrigatórias recebem mensagem de domínio. Inputs aceitam estados intermediários de edição; blur/avanço valida sem máscara ou reescrita. Não foram introduzidas animações que dependam de movimento.

Buscas mostram carregamento, bloqueiam query/paginação enquanto aguardam e preservam seleções. Manual também identifica sequência de respostas; integrado serializa buscas pelo estado de carregamento, sem substituir seleções existentes. Eventos de navegador e corridas reais ainda precisam de homologação.

## 4. Matriz integral e formatos

A matriz completa e normativa desta entrega está em **[UI_PRICING_FIELD_AUDIT.md](UI_PRICING_FIELD_AUDIT.md)**, parte integrante deste relatório. Inclui cada campo dos dois modos, etapa, obrigatoriedade, unidades, mínimos/máximos, escalas, origem do limite e dependências. O formato textual e o transporte normalizado comuns estão definidos antes da tabela; seletores transportam IDs/versões, textos são aparados pelo contrato manual e números transportam `number` finito. Não há alteração da escala SQL V3.

Exemplos:

| Texto editável | Normalizado | Observação |
|---|---|---|
| `0` | 0 | somente em campos não negativos |
| `0,01`, `1,50`, `12,99` | 0.01, 1.5, 12.99 | precisão conforme campo |
| `1000`, `1.000,50` | 1000, 1000.5 | agrupamento completo |
| `1.5`, `1.00,50`, vazio, letras, sinais, expoente | inválido/null | nunca viram zero |
| horas `1`, minutos `30` | 1.5 h | impressão deve ser >0 |
| horas `10`, minutos `59` | 10 + 59/60 h | sem arredondar payload |
| minutos `60`, `99`, `-1`, `12,5` | inválido | componentes, não minutos totais |

Horas/peças inteiras não aceitam agrupamento. Custos manuais mantêm seis casas; integrado mantém tarifa seis, consumos três e custos/perda/acréscimo duas. Zero explícito continua obrigatório em custos opcionais inicializados com zero. Não há teto indiscriminado de 100% para markup. Frações de embalagem em unidade permanecem permitidas pelo contrato preexistente.

## 5. Planos, cálculos e persistência

Aprendiz/Free monta somente manual; não carrega controles/fontes físicas pagas. Visionário/Intermediate usa IDs e versões reais, valores de cadastro somente leitura e recarga autoritativa nas ações existentes. `canSave`, gates de plano e permissões do servidor foram preservados.

Fórmulas preservadas: filamento com perda; energia W/1000 × horas × tarifa; depreciação aquisição/vida útil × horas; manutenção por hora; acabamento tempo × mão de obra + fixo; embalagens por peça/lote com conversão existente; acréscimo sobre custo, não margem sobre venda. Exibição BRL não altera precisão do snapshot. O motor é único e não mudou.

Alterações tornam o resultado anterior desatualizado e impedem salvar. Salvar integrado captura payload completo; manual conserva input/produto calculados. Falha de rede/resultado desconhecido congela edição e navegação, mantendo retry externo com mesmo attempt/payload. Não há novo attempt no retry. Ausência de versão de configuração integrada impede salvar com explicação. Histórico/aplicação continuam nas telas e ações existentes.

## 6. Duas revisões independentes e correções

### Passagem 1 — técnica

Revisor independente comparou campos, parsers, payloads, motor, planos e snapshots. Achados corrigidos:

- Espaços em horas/minutos eram aceitos no campo e rejeitados na conversão: `timeToHours` agora aplica trim consistente.
- Configuração integrada sem versão permitia botão sem efeito: botão desabilitado e aviso explícito.
- Navegação aparentava estar disponível durante salvamento incerto: bloqueio visual e retry externo.
- Strings portuguesas corrompidas: corrigidas.

Não identificada regressão concreta de fórmula ou conteúdo do payload na revisão estática.

### Passagem 2 — experiência/acessibilidade

Revisor independente examinou estilos, interação e estrutura sem navegador. Corrigidos:

- Busca sem loading: estado de busca, query/paginação bloqueadas e erros de transporte.
- Seleção impressora/produto sem estado programático: `aria-pressed`.
- Remoção manual com chave por índice: identidades estáveis e restauração de foco após remover linhas em ambos os modos.
- Controles manuais inconsistentes: altura mínima 44px e paginação com quebra.

Na verificação posterior, ESLint detectou captura indireta de ref na função de render de buscas integradas. Removida sequência baseada em ref desse helper; mantida serialização pelo estado de loading. Harness ajustado para nome de módulo permitido por lint e interoperabilidade de imports default; expectativas financeiras não foram alteradas.

## 7. Verificações executadas

- **76 testes passaram; 0 falharam**, incluindo 11 do novo arquivo (um executa os testes TS existentes do motor e formulário manual sem modificá-los).
- Comando: `node --test --test-reporter=tap tests/pricing-wizard.test.cjs tests/manual-pricing-persistence.test.cjs tests/pricing-access.test.cjs tests/pricing-actor-authorization.test.cjs tests/apply-pricing-price-migration.test.cjs tests/pricing-ui.test.cjs`.
- Cobertura: entradas monetárias/agrupamento/limites, durações, massa/energia/percentuais/quantidade, normalização, FDM e runFdm, painéis montados, avanço/retorno/saltos, foco fake DOM, erros acessíveis, manual/integrado, versões e payloads, stale, retry com mesmo objeto/attempt, persistência, gates/atores, leitura de snapshots e aplicação.
- `npx tsc --noEmit`: aprovado.
- ESLint direcionado aos três TSX, `input.ts`, `parse.ts` e novo teste: aprovado.
- `npm run build`: aprovado. Aviso preexistente de depreciação `middleware` → `proxy`; não migrado fora do escopo.
- `git diff --check`: aprovado; apenas avisos de conversão LF/CRLF do workspace.

**Natureza da evidência:** parser/motor/schemas são executados realmente; React usa hooks stateful no harness e DOM/framework/actions substituídos. Testes de persistência executam ações reais com fronteiras de banco mockadas. Checks SQL são estáticos. Não houve PostgreSQL/RLS real, teste de rede real nem render/interação em browser. Os cenários de autorização não comprovam implantação ou isolamento do banco remoto.

## 8. Riscos e pendências

Achados preexistentes preservados por proibição de alterar motor/backend:

- V2/motor não validam integralmente negativos de acabamento e finitude dos resultados. UI bloqueia entradas inválidas/resultados não finitos, mas isso não corrige chamadas externas ao backend.
- Arrays legados e modernos de embalagem têm validação assimétrica nas ações; UI mantém ambos alinhados.
- Rota define `canSave` por `products.write`, mas action integrada exige owner: operador pode ver ação e receber rejeição. Não foi alterada autorização para resolver divergência de produto.
- `configVersion` inicial não é comparado diretamente pela action; recarga autoritativa existente permanece.
- Histórico admite snapshots legados; status não é autoridade de aplicação. Preço salvo pode exceder teto aplicável ao produto (R$ 1 milhão após arredondamento). Não prometer aplicabilidade apenas porque salvou.
- Fluxos concorrentes reais de fonte/plano/commit e RLS exigem teste autorizado em PostgreSQL.

Nenhum SQL, Supabase remoto, instalação, Docker/WSL, commit, push ou deploy foi executado nesta tarefa.

## 9. Checklist de homologação manual — ainda não executado

Todas as larguras abaixo estão **pendentes**, não aprovadas por inferência das classes:

| Largura | Layout/overflow | Teclado/foco/ações |
|---|---|---|
| 320px | pendente | pendente |
| 375px | pendente | pendente |
| 430px | pendente | pendente |
| 768px | pendente | pendente |
| 1024px | pendente | pendente |
| 1366px | pendente | pendente |
| 1440px | pendente | pendente |

- [ ] Aprendiz e Visionário: percorrer seis etapas, voltar, saltar, corrigir erros sem perder dados.
- [ ] Nomes longos, dez linhas, selects, paginação e valores grandes sem overflow; desktop horizontal.
- [ ] Colar BRL válido/inválido, apagar, selecionar, substituir, backspace, autofill e composição/IME; teclado móvel decimal/numérico.
- [ ] Minutos 59/60/99, impressão zero e acabamento zero; foco e anúncio do primeiro erro.
- [ ] Contraste, zoom, leitor de tela, foco visível e alvos de 44px; remoção de linha restaura foco.
- [ ] Busca lenta/falha, mudança de etapa durante busca e respostas concorrentes; seleção preservada.
- [ ] Salvar/retry após resposta perdida sem duplicar; seleção/produto/source version obsoletos.
- [ ] Histórico antigo e novo, detalhe, aplicar preço, replay e rejeição de teto/permissão.
- [ ] Owner/operator, outra empresa, downgrade e plano irregular no backend autorizado.

**Conclusão:** código e verificações locais entregues com fórmulas e contratos preservados. Aceite visual e operacional completo depende dos itens pendentes acima.
