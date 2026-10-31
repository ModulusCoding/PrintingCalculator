# Precificadora — matriz anterior à implementação

Inventário local antes de editar os formulários. Fontes: `ManualPricingSimulator.tsx`, `PricingSimulator.tsx`, `manual-form.ts`, `parse.ts`, `manual.ts`, `persistence.ts`, `fdm.ts`, migrations V3 `20261026100000` e V2 `20261023000000`. Sem execução SQL/banco.

## Formatos e regras comuns

Etapas propostas mantêm a ordem dos grupos existentes: 1 Impressora/energia; 2 Filamento; 3 Embalagens; 4 Lote/custos; 5 Revisão/produto; 6 Resultado. Produto é opcional para simular, obrigatório para salvar. Nenhum parâmetro novo do motor.

Todos os valores editáveis ficam em texto, normalizam para number finito após validação explícita (API atual usa number). Exibição decimal pt-BR, entrada sem conversão durante digitação; agrupamento brasileiro válido passa a ser aceito. Nenhuma máscara de centavos deslocando a quantia. Escala é limite da interface existente, não modificação de precisão SQL: V3 SQL aceita precisão JS sem restrição de escala. UI manual já limita seis casas; manter seis para valores de referência/custos, não forçar duas em tarifas. Integrado mantém duas para custos manuais/markup/perda, seis para tarifa, três para consumos. Não arredondar inputs ao normalizar. Erros não viram zero.

`M`=manual; `I`=integrado. Para toda linha numérica, obrigatório significa valor explícito, inclusive zero quando permitido. Linhas de embalagem são opcionais, mas todos os seus campos são obrigatórios se adicionadas.

| Campo | Etapa/modo | Tipo/unidade | Obrigatório | Min / max | Casas UI atual → proposta | Backend / dependências / origem |
|---|---|---|---|---|---|---|
| Nome impressora | 1 M | texto | sim | 1..200 após trim | — | printer.name; manual.ts/SQL V3 |
| Preço aquisição | 1 M | decimal R$ | sim | 0..1e12 | 6 → 6 | printer.purchasePrice; manual-form/manual.ts |
| Vida útil | 1 M | decimal h | sim | >0..1e12 | 6 → 6 | printer.lifeHours; denominador |
| Potência média | 1 M | decimal W | sim | >0..1e12 | 6 → 6 | printer.powerWatts |
| Manutenção | 1 M | decimal R$/h | sim (default 0 existente) | 0..1e12 | 6 → 6 | printer.maintenancePerHour |
| Impressora | 1 I | seleção UUID+version | sim | cadastro autorizado | — | printerId/version; custos imutáveis do cadastro recarregados servidor |
| Tarifa | 1 M/I | decimal R$/kWh | sim | 0..100 | 6 → 6 | tariff.effective; I original config, M original null; adjusted preservado |
| Nome filamento | 2 M | texto | sim por linha | 1..200 trim | — | spoolLines.name |
| Carretel | 2 I | seleção UUID+version | 1..10 únicos | cadastro autorizado | — | spoolIds/versions; I sem preço manual |
| Consumo lote | 2 M | decimal g | sim | >0..1e12 | 6 → 6 | spoolLines.consumptionGrams; lote, não por peça |
| Consumo lote | 2 I | decimal g | sim | .001..1e6 | 3 → 3 | spoolConsumptionsGrams; superar saldo avisa, não movimenta estoque |
| Preço carretel | 2 M | decimal R$ | sim | 0..1e12 | 6 → 6 | spoolLines.purchasePrice |
| Peso original | 2 M | decimal g | sim | >0..1e12 | 6 → 6 | spoolLines.originalFilamentGrams; denominador |
| Perda | 2 M/I | decimal % | sim | 0..100 | M6/I2 → mesmas | lossPercent; percentual, não fator |
| Nome embalagem | 3 M | texto | sim se linha | 1..200 trim | — | packagingLines.name |
| Material geral | 3 I | seleção UUID+version | opcional até 10 únicos | cadastro autorizado | — | generalMaterialIds/versions |
| Quantidade embalagem | 3 M | decimal na unidade selecionada | sim se linha | >0..1e12 | 6 → 6 | packagingLines.quantity; modo por peça/lote |
| Quantidade material | 3 I | decimal na unidade selecionada | sim se linha | .001..1e6 | 3 → 3 | packagingLines.quantity; conversão unidade/backend |
| Unidade | 3 M | enum | sim se linha | unidade/metro/centimetro/grama/quilograma | — | suppliedUnit; referência e consumo na mesma unidade |
| Unidade | 3 I | enum compatível | sim se linha | dimensão do control_unit | — | suppliedUnit; m/cm, g/kg, unidade; conversão existente |
| Preço referência embalagem | 3 M | decimal R$ | sim se linha | 0..1e12 | 6 → 6 | referencePrice |
| Quantidade referência | 3 M | decimal na unidade | sim se linha | >0..1e12 | 6 → 6 | referenceQuantity; denominador |
| Aplicação embalagem | 3 M/I | enum | sim se linha | per_piece/per_lot | — | packagingLines.mode |
| Embalagem adicional | 3 M / 4 I | decimal R$/peça | sim (default 0) | M 0..1e12 / I 0..1e6 | M6/I2 → mesmas | packagingPerPiece; não duplicar linhas |
| Quantidade peças | 4 M/I | inteiro unidades | sim | 1..100000 | 0 → 0 | quantity; teto UI preexistente, backend M permite 1e12 |
| Horas impressão | 4 M/I | inteiro h | sim | 0..10000 | 0 → 0 | combinado com minutos; timeToHours; total >0 |
| Minutos impressão | 4 M/I | inteiro min componente | sim | 0..59 | 0 → 0 | horas+minutos/60; não minutos totais |
| Horas acabamento | 4 M/I | inteiro h | sim (default 0) | 0..10000 | 0 → 0 | finishing.manualTimeHours >=0 |
| Minutos acabamento | 4 M/I | inteiro min componente | sim (default 0) | 0..59 | 0 → 0 | horas+minutos/60 |
| Mão de obra | 4 M/I | decimal R$/h | sim (default 0) | M 0..1e12 / I 0..100000 | M6/I2 → mesmas | finishing.laborPerHour |
| Custo fixo | 4 M/I | decimal R$/lote | sim (default 0) | M 0..1e12 / I 0..1e6 | M6/I2 → mesmas | finishing.fixedCost |
| Acréscimo | 4 M/I | decimal % sobre custo | sim (default 0) | M 0..1e12 / I 0..100000 | M6/I2 → mesmas | markupPercent; NÃO limitar a 100 nem chamar margem líquida |
| Produto | 5 M/I | seleção UUID+version | somente salvar | ativo/empresa/janela plano | — | productId/version; backend revalida |
| Buscas produto/impressora/carretel/material | respectivos grupos | texto | opcional | <=200 caracteres | — | paging schemas/actions; página 1..10000, limit 10 UI |
| Valores cadastrados I | 1/2/3 I | read-only números e nomes | conforme cadastro | contracts actions | precisão origem | nunca substituídos por input manual; backend recarrega fontes |
| Attempt/config/source versions | invisível | UUID/inteiros | salvar | contratos existentes | — | gerados/capturados, não editáveis; snapshot/reenvio preservados |

## Lacunas confirmadas e plano

Formulários atuais só mostram erro genérico no cálculo. Adicionar validação por campo/etapa e foco no primeiro inválido. `parsePtBr` não aceita milhar; aceitar somente agrupamento pt-BR rigoroso e rejeitar pontos decimais ambíguos. Campos livres devem permitir apagar/colar/composição sem normalização silenciosa; blur valida, não reescreve valor. Inteiros sem separadores/decimais para minutos/horas/peças.

Não impor escala de duas casas em V3 onde contrato aceita mais; preservar seis da UI. Não alterar motor, snapshots ou schemas SQL. Zero de impressão é inválido, acabamento zero é válido. Unidades divisíveis permanecem decimais; quando unidade=unidade, fracionamento de insumo de embalagem é contrato atual (inclusive testes V3); preservar e documentar em vez de endurecer silenciosamente.

Reenvio integrado precisa congelar edição após resultado de salvamento desconhecido, como manual já faz, e capturar falhas de rede em buscas. A tentativa existente deve ser reutilizada; nenhum novo ID no retry. Revisão antes do cálculo deve mostrar somente parâmetros, não estimativa financeira inventada.
