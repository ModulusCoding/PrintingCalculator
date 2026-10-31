# Precificadora empresarial — fluxo por etapas

## Escopo e referência

Refatoração dos formulários empresariais manual e integrado e da navegação compartilhada. Rota `/calculator` original, motor, snapshots, persistência, permissões, planos e banco não alterados.

Referência rastreada: `app/calculator/page.tsx` (etapas, estado, validações, `values`, componentes locais de campos/resultados), `utils/currency.ts`, catálogo local `public/impressoras.json`, `public/marketplaces.json` e funções de marketplace dentro da página. O catálogo público não é uma fonte autorizada empresarial e não é importado para o Aprendiz.

A implementação empresarial já possuía um wizard parcial e testes; foi evoluída, não substituída por um segundo formulário.

## Regras comparadas

A referência usa Material → Energia → Tempo de Máquina → Acabamento → Embalagem → Impostos → Resultado. Material contém quantidade de peças e linhas de filamentos; energia usa watts/kWh/tempo; máquina permite valor horário manual ou depreciação aquisição/vida útil; acabamento combina tempo e valor fixo; embalagem soma valores monetários; impostos incidem no subtotal. Resultado exibe composição e sugestões de acréscimo de 30%, 50% e 80%. Há também um simulador separado de marketplace; ele não pertence ao contrato do Hub.

## Diferenças de fórmula preservadas — exigem decisão antes de eventual mudança

Não se declara equivalência matemática entre produtos diferentes.

| Regra | `/calculator` | Hub `calculateFdmPricing` / `runFdm` |
|---|---|---|
| Consumo de filamento | Consumo por peça × quantidade | Consumo total do lote, com perda percentual |
| Impressão | Horas por peça × quantidade | Horas totais do lote |
| Acabamento | (tempo × mão de obra + fixo) × quantidade | Tempo do lote × mão de obra + fixo do lote |
| Embalagem | Soma de valores, sem multiplicação geral por peças no motor da referência | Linhas por peça ou lote, conversão de unidade integrada, referência de preço/quantidade + adicional por peça |
| Máquina | Valor horário manual ou aquisição/vida útil | Depreciação aquisição/vida útil + manutenção por hora |
| Impostos | Percentual do subtotal | Não há campo/contrato equivalente; não introduzido |
| Preço sugerido | Três acréscimos fixos 30/50/80 | Acréscimo escolhido pelo usuário |
| Arredondamento | Moeda formatada na apresentação | Precisão interna preservada; política do motor existente; apresentação BRL |

Exemplos: 10 peças com 100 g informados e filamento R$100/1000g → referência R$100; Hub R$10 sem perda ou R$11 com perda de10%. Duas horas e10 peças, impressora100W, tarifa R$1/kWh → referência R$2; Hub R$0,20. Acabamento30min aR$20/h +R$5 fixos,10 peças → referência R$150; Hub R$15. EmbalagemR$2/peça no Hub para10 peças custaR$20; uma linhaR$2 na referência somaR$2.

Trocar bases por peça/lote, acrescentar impostos ou substituir markup por margem sobre venda exigiria decisão comercial e revisão dos contratos/snapshots. Nada disso foi implementado. Não foram removidos custos próprios do Hub.

## Sequência final

1. Filamento: consumo total do lote, perda e referências manuais ou carretéis autorizados.
2. Impressora e energia: dados manuais ou impressora cadastrada e tarifa autorizada.
3. Lote e acabamento: quantidade de peças, tempo total, acabamento, mão de obra, custo fixo e acréscimo.
4. Embalagens: linhas opcionais com base peça/lote e adicional manual existente.
5. Revisão: conferência e produto opcional para simular, obrigatório para salvar.
6. Resultado: composição, estimativa, salvamento e link ao histórico/revisão.

Energia e máquina ficam juntas pois compartilham impressora; tempo e acabamento ficam juntos pois compartilham a base do lote. Não se criou etapa vazia de impostos. Produto/revisão é necessidade do Hub inexistente na referência.

## Planos, autoridade e recuperação

- Aprendiz mantém somente entradas manuais e busca de produtos da janela autorizada. Não consulta impressoras, materiais, carretéis, materiais gerais ou configuração elétrica paga.
- Visionário mantém fontes autorizadas, IDs e versões reais e configuração empresarial.
- Simulação client é estimativa; salvamento executa cálculo autoritativo no servidor. Snapshot manual V3, integrado V2, leitura histórica V1/V2/V3 e aplicação PRC-001 permanecem intactos.
- Nenhuma simulação/salvamento movimenta estoque.
- Alterações invalidam resultado atual e exigem recálculo antes de salvar.
- Resultado incerto mantém tentativa/payload e bloqueia edição e navegação. Recuperação reenvia a mesma intenção; não há troca silenciosa de ID ou modo.

## Arquivos e validação

Resultados e arquivos finais serão registrados após revisão.
