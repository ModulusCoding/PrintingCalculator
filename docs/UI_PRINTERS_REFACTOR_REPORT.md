# Impressoras — refatoração visual 09

## Escopo e referências

Refatoração de `/impressoras`, `/impressoras/nova` e `/impressoras/[id]`, preservando os contratos atuais. Inspeção prévia de rotas, PrinterForm, `lib/printers/actions.ts`, contexto de autorização, gates de plano, migrations locais e integração da Precificadora.

Referências locais: `design-references/stitch_modulus_3d_editor/README.md` e HTML/PNG em `impressoras_modulus_hub`, `nova_impressora_modulus_hub`, `detalhe_da_impressora_modulus_hub`, `impressora_arquivada_modulus_hub`. Nenhum HTML/script Stitch foi copiado.

### Classificação

- **Existente:** nome, marca, modelo, situação ativa/arquivada, potência, compra, vida útil, manutenção/hora, busca, filtros, paginação, criação, edição, arquivar/restaurar e consulta somente leitura.
- **Adaptável:** hierarquia visual, identificação com ícone, seções de identificação/custos, superfícies claras e avisos. Listagem adaptada para cards conforme pedido, mesmo com tabela na referência.
- **Descartável:** fotos, localização física, firmware, telemetria, capacidade mensal/OEE, gráficos de uso, contagens ilustrativas de precificações, algoritmo/versionamento ilustrativos e setas decorativas.
- **Futuro sem contrato nesta entrega:** conexões/controle remoto e telemetria; não implementados. Prévia e métricas agregadas do Stitch omitidas para não criar cálculos paralelos à Precificadora.

## Arquivos

- `app/(authenticated)/impressoras/page.tsx`: cards, filtros, estados, paginação acessível e dados reais.
- `app/(authenticated)/impressoras/[id]/page.tsx`: detalhes/edição com largura adequada, erros distintos e key por id/versão.
- `app/(authenticated)/impressoras/nova/page.tsx`: largura responsiva.
- `app/(authenticated)/impressoras/loading.tsx`: novo estado de carregamento.
- `components/printers/PrinterForm.tsx`: formulário claro, erros locais, identificação/custos separados e consulta de arquivadas.
- `components/printers/validation.ts`: validação exclusivamente de UI, espelhando limites reais da action sem alterar domínio.
- `components/printers/PrinterForm.module.css` e `PrinterList.module.css`: estilos locais.
- `tests/printers-ui.test.cjs` e `tests/printers-actions-validation.test.cjs`: novos harnesses isolados.

## Auditoria de campos

Payload estrito da action, todos os sete valores são strings. Valores numéricos não são convertidos em Number no payload da UI; edição substitui ponto por vírgula. Não existe upload, catálogo de modelos, tarifa individual de energia ou manutenção total acumulada.

| Campo da action → banco | Tipo/unidade | Obrigatório | Mínimo | Máximo | Precisão | Padrão UI | Normalização/contrato |
| --- | --- | --- | --- | --- | --- | --- | --- |
| name → name | texto | sim | 2 caracteres | 120 caracteres | — | vazio/nome atual | trim na action |
| brand → brand | texto | chave sim, conteúdo opcional | vazio | 120 caracteres | — | vazio/valor atual | trim na action; ver risco SQL abaixo |
| model → model | texto | chave sim, conteúdo opcional | vazio | 160 caracteres | — | vazio/valor atual | trim na action; ver risco SQL abaixo |
| purchasePrice → purchase_price | decimal BRL | sim | 0 | 1.000.000 | 2 casas | vazio/valor atual | vírgula decimal → ponto na action; numeric(12,2) |
| estimatedLifeHours → estimated_life_hours | horas inteiras | sim | 1 | 100.000 | 0 casas | vazio/valor atual | dígitos, INTEGER; não contador de uso |
| averagePowerWatts → average_power_watts | watts | sim | 0,01 | 10.000 | 2 casas | vazio/valor atual | vírgula decimal → ponto; numeric(12,2) |
| maintenanceCostPerHour → maintenance_cost_per_hour | BRL/hora | sim | 0 | 1.000 | 4 casas | vazio/valor atual | vírgula decimal → ponto; numeric(10,4) |

Banco tem default 0 para manutenção; a UI original não tinha default, comportamento mantido. ID UUID, enterprise_id, versão, datas e tecnologia fdm não são campos editáveis. active é alterado pela operação específica; novas impressoras são ativas por default. Update e arquivamento enviam ID e expectedVersion existentes, sem novos parâmetros.

UI rejeita negativos, letras, notação científica, ponto decimal, agrupamento de milhares, prefixo R$ colado, vírgula incompleta e casas excedentes. Vírgula decimal é o contrato atual, explicitado nas dicas. Colagem permanece possível e o texto inválido é preservado para correção, mas não chama a action. Não há parseFloat, arredondamento ou transformação inválida em zero. Compra aparece em BRL com duas casas e manutenção com até quatro. Vida útil e potência mantêm h e W; nenhuma conversão automática.

Validação local retorna todos os erros e move foco ao primeiro campo inválido. A action continua autoritativa e independente, sem mudanças. Erros de servidor com fieldErrors vazio agora têm mensagem geral.

## Contratos preservados

Fontes: `lib/printers/actions.ts`, `supabase/migrations/20261015180000_internal_printers_mvp.sql`, `20261025000000_stage6_plans_entitlements.sql`, `20261026000000_stage6b_access_restrictions.sql`, `20261026060000_plan_business_regularization.sql`, `20261026150000_pricing_actor_authorization.sql` (somente leitura).

- listPrinters mantém tenancy, busca por nome/marca/modelo até 200 caracteres, status active/archived/all, ordenação created_at/id decrescente e 20 registros/página. Total real usado na paginação.
- getPrinter mantém filtro por empresa e UUID. As rotas distinguem indisponibilidade, permissão, sessão e falha técnica na apresentação.
- RPCs create_my_printer, update_my_printer e set_my_printer_active intactas. Actions de domínio, autenticação, permissões e RLS não alteradas.
- Arquivadas continuam somente leitura e restauráveis com permissão; confirmação nativa existente preservada. Não há exclusão física nesse módulo.
- Lock síncrono com useRef, estado pending e bloqueio pós-sucesso evitam ações duplicadas locais. Criação não possui idempotência no backend: erros incertos orientam verificar a lista, sem repetir automaticamente.
- Edição mantém todos os valores existentes e versão. Campos ficam desabilitados durante submissão; falhas não limpam dados. Conflito de versão solicita reabrir registro.

### Integração com Precificadora

Inspecionados `lib/pricing/{actions,persistence-actions,fdm}.ts` e `components/pricing/PricingSimulator.tsx`. Seleção usa impressoras ativas; salvamento recarrega fontes e verifica versão/empresa, preservando snapshots históricos. Parâmetros: purchase_price, estimated_life_hours, average_power_watts e maintenance_cost_per_hour.

Energia utiliza W/1000 × horas de impressão × tarifa da empresa; depreciação utiliza compra/vida útil × horas; manutenção utiliza taxa/hora × horas. Nenhum cálculo, conversão, snapshot, persistência, autorização ou seletor foi modificado. A interface não calcula custo operacional paralelo.

## Planos e papéis

renderPaidModule preservado em listagem/cadastro/detalhe. Aprendiz continua com PaidModuleNotice original, sem alterar mensagens, estilos, comportamento ou sidebar. Visionário mantém acesso pago existente, sem quota numérica nova de impressoras. Owner/admin leem, criam/editam e arquivam/restauram; operator lê somente. Permissões reais são resolvidas no servidor e novamente nas actions/RPCs. Não há contador ou autorização paralela no frontend.

## Visual, responsividade e acessibilidade

Cards usam o mesmo `Printer` de lucide-react, azul #2B00FF em superfície lilás clara. Sem fotos, img, URL de imagem, upload ou dependência nova. Texto #152336, foco #A6B4FF, branco/neutro em todas as superfícies locais; Space Grotesk herdada. Laranja não foi forçado em ações comuns. Navegação global e logo existentes mantidos.

Cards em 1/2/3 colunas, formulários em uma coluna no mobile e duas a partir de 640px, com min-width zero e quebra de nomes/valores longos. Paginação e botões refluem; ações não ocultas. Inputs e botões com mínimo 44px; labels, dicas, aria-invalid/describedby, feedback alert/status, foco visível e foco programático em erro. Sem animações e sem zoom CSS.

Alvos: 320, 375, 430, 768, 1024, 1440px. Estratégia revisada em código, **sem homologação visual em navegador**. Playwright/Puppeteer não estão disponíveis no projeto e não foram instalados.

## Segunda revisão e correções

1. Inputs antigos tinham limite universal 160: corrigidos limites individuais 120/120/160 e precisão/ranges numéricos documentados.
2. Sem validação local numérica: adicionada validação com o mesmo contrato da action, mantendo texto inválido e exibindo erros associados.
3. Ausência de erro geral para invalid_input sem campos: feedback geral e foco adicionados.
4. Permissão de arquivamento dependia só da visibilidade: handler agora verifica canArchive também, sem substituir segurança do backend.
5. Defaults de manutenção e envio revisados para preservar quatro casas sem arredondamento.
6. Atualização de versão recria o formulário pela key; salvamento confirmado bloqueia novo envio até navegação.
7. Estado de erro de detalhes era indistinto: mensagens por resultado real.
8. Teste existente de gates apontou incompatibilidade com o wrapper Suspense adicionado à listagem: removido wrapper, restaurado loader direto original. Loading permanece via loading.tsx. Teste repetido aprovado.
9. Fundos locais e color-scheme explícitos revisados para evitar herança escura; paginação com wrap para mobile.
10. Revisados todos os arquivos novos/alterados, sem setas decorativas ou imagens externas.

## Problema preexistente de backend — não corrigido fora do escopo

A migration 20261025000000 substitui create_my_printer e deixa de converter brand/model vazios em NULL. A action atual envia strings vazias opcionais; constraints originais exigem conteúdo não vazio quando não nulo. Portanto, criação com marca/modelo vazios pode falhar se essa definição estiver implantada. A mesma RPC pode retornar unauthorized, status não aceito no parser atual, virando unknown_result.

Não foi consultado banco remoto para confirmar implantação. Não se tornou opcional obrigatório na UI nem se inventou placeholder para contornar a constraint.

Alternativas para decisão separada: (a) corrigir a RPC em nova migration, restaurando trim/nullif e status compatível (preferível para cobrir todos callers); (b) normalizar strings vazias para null na action, após revisão do contrato, sem resolver isoladamente o status RPC. Ambas exigem autorização além desta entrega, que proíbe alterações de domínio/SQL. Esse risco impede declarar o cadastro end-to-end totalmente homologado.

## Testes e verificações

Comando de testes: `node --test tests/printers-ui.test.cjs tests/printers-actions-validation.test.cjs tests/paid-module-gate.test.cjs tests/paid-action-errors.test.cjs tests/plan-capacity.test.cjs tests/pricing-access.test.cjs tests/pricing-actor-authorization.test.cjs tests/pricing-ui.test.cjs tests/pricing-wizard.test.cjs`.

Resultado: **71 testes passaram, 0 falhas**. Incluem handlers reais com mocks, limites, colagem inválida, precisão, permissões, confirmação, versão, locks, falhas, gates pagos e regressões de precificação. Testes de action executam a validação real, mas RPC é mockada; não comprovam ausência do problema SQL documentado.

- `npx tsc --noEmit`: passou.
- ESLint direcionado às rotas, componentes/validação e testes novos: passou.
- `npm run build`: passou (Next 16.3.1). Aviso preexistente sobre convenção middleware depreciada; migração fora do escopo.
- `git diff --check`: passou, apenas avisos de normalização LF/CRLF do workspace.

Nenhum SQL, Supabase remoto, Docker/WSL, instalação, commit, push ou deploy. Alterações anteriores do workspace preservadas.

## Pendências de homologação

Navegador nos seis viewports, teclado/leitor de tela e operações autenticadas por plano/papel. Não há teste de integração real de CRUD/RLS/concorrência executado; os harnesses locais não equivalem a E2E. Validar principalmente criação com opcionais vazios após decisão/correção do backend, edição concorrente, arquivamento entre seleção e salvamento da precificação e preservação de snapshots.
