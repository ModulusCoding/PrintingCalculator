# Plano de impressoras FDM e integração com precificação

**Status:** análise e proposta; nenhuma implementação, migration ou alteração de banco realizada.

## 1. Escopo e conclusões principais

O código atual contém três calculadoras públicas, client-side e independentes. A precificadora profissional (`/calculator`) é a melhor candidata para a primeira integração empresarial porque já possui seleção de impressora, consumo em watts, valor da máquina, vida útil e custo de energia. A integração deve começar nela, sem obrigar visitantes públicos a autenticação ou a possuir uma impressora cadastrada.

O cadastro futuro deve representar uma máquina física por empresa. Não deve representar apenas um modelo de catálogo: duas máquinas iguais terão dois registros independentes, permitindo arquivamento, custo de aquisição, vida útil e disponibilidade próprios.

Há uma incompatibilidade importante entre a direção arquitetural e a implementação atual: a arquitetura recomenda regras puras e testáveis em `lib/pricing`, mas as fórmulas estão embutidas nas páginas client-side. Antes de persistir precificações, será necessário extrair um motor de domínio sem alterar silenciosamente os resultados atuais.

## 2. Inventário do código atual

### Referências

- `/calculator`: `app/calculator/page.tsx`
- `/fastCalculator`: `app/fastCalculator/page.tsx`
- `/marketplaceCalculator`: `app/marketplaceCalculator/page.tsx`
- Dados de impressoras públicas: `public/impressoras.json`
- Dados de marketplaces: `public/marketplaces.json`
- Parsing monetário/campos: `utils/currency.ts`
- Direção arquitetural: `docs/architectur/saas-foundation.md`
- Contexto e permissões: `lib/auth/context.ts`
- Produtos multiempresa: `docs/architecture/products-multitenancy-plan.md`

Não há hoje uma entidade empresarial de impressoras, nem actions/RPCs de pricing. As calculadoras públicas não usam `requireBusinessContext`.

## 3. Fórmulas atualmente implementadas

### 3.1 Calculadora profissional (`/calculator`)

#### Material

Para cada material/cor:

```text
gramas_usados = quantidade, convertido para g (kg × 1000)
peso_rolo_g = peso do rolo, convertido para g
preço_rolo = preço informado
custo_por_grama = preço_rolo / peso_rolo_g, quando peso_rolo_g > 0
custo_material_lote = gramas_usados × custo_por_grama × quantidade_de_peças
```

O total de material soma todos os materiais. O nome/cor é descritivo e não altera o cálculo.

**Unidades:** g, kg e moeda escolhida na interface.

**Defaults:** uma linha `Cor 1`, unidade g para consumo, kg para rolo e preço `0,000`.

**Validação:** quantidade, peso do rolo e preço precisam ser maiores que zero para avançar na etapa de material. O cálculo, porém, converte entradas inválidas para zero em `toNumber`/`toCurrencyNumber`.

#### Energia

```text
consumo_kw = potência_w / 1000
custo_energia = consumo_kw × tempo_impressão_h × tarifa_kwh × quantidade_de_peças
```

A impressora automática usa `consumo_W.medio` de `public/impressoras.json`. O consumo de pico aparece na seleção, mas não participa do cálculo.

**Unidades:** potência em W, tarifa em moeda/kWh, tempo em horas.

**Validação:** consumo, tempo e tarifa precisam ser maiores que zero na etapa de energia. Não existe tarifa empresarial hoje.

#### Depreciação/máquina

Modo automático/detalhado:

```text
custo_hora_máquina = valor_compra / vida_útil_horas, quando vida_útil_horas > 0
custo_máquina = custo_hora_máquina × tempo_impressão_h × quantidade_de_peças
```

Modo manual:

```text
custo_máquina = valor_hora_manual × tempo_impressão_h × quantidade_de_peças
```

Se a vida útil for zero, o custo automático é zero. O reset altera o modo para manual, embora o estado inicial seja automático.

#### Acabamento/mão de obra

```text
custo_acabamento =
  (custo_fixo + tempo_acabamento_h × custo_hora_acabamento)
  × quantidade_de_peças
```

O código chama esses campos de acabamento; eles podem representar trabalho manual, mas não existe ainda um cadastro separado de mão de obra.

#### Embalagem

```text
custo_embalagem = soma dos valores informados
```

Divergência: o valor não é multiplicado pela quantidade de peças, ao contrário de material e acabamento. É necessário decidir se embalagem é por lote ou por peça antes de persistir resultados.

#### Impostos e total

```text
subtotal = material + energia + máquina + acabamento + embalagem
impostos = subtotal × percentual_impostos / 100
total = subtotal + impostos
```

Sugestões fixas:

```text
econômico = total × 1,30
profissional = total × 1,50
premium = total × 1,80
```

Esses multiplicadores não são configuráveis.

### 3.2 Fast Calculator (`/fastCalculator`)

A calculadora rápida tem um escopo menor:

```text
material_g = consumo convertido para g
rolo_g = peso do rolo convertido para g
custo_por_grama = preço_rolo / rolo_g
custo_material = material_g × custo_por_grama
preço_final = custo_material × (1 + margem / 100), quando margem > 0
lucro = preço_final - custo_material
```

Tempo é exibido, mas não entra no preço. Não há energia, impressora, depreciação, manutenção, acabamento, embalagem, impostos, quantidade de peças ou seleção de máquina.

**Diferença essencial:** usa markup sobre custo. Com custo 100 e margem 30, resulta em 130.

O parser `toPlainNumber` não trata pt-BR da mesma forma que `/calculator`: `1,5` pode ser interpretado como `15`, e `1.000` como 1.000 decimal. Não há validação explícita de todos os campos obrigatórios.

### 3.3 Marketplace Calculator (`/marketplaceCalculator`)

Recebe custo de produção manual e calcula taxas, frete, impostos e margem. O motor está duplicado quase integralmente dentro da aba marketplace de `/calculator`.

Margem inicial:

```text
preço_estimado = custo_produção × (1 + margem / 100)
```

Depois de até três iterações:

```text
comissão = preço_estimado × percentual_comissão / 100
impostos = custo_produção × percentual_impostos / 100
total_taxas = comissão + impostos
custo_total = custo_produção + total_taxas
preço_estimado = custo_total / (1 - margem / 100)
```

Na composição final também entram taxa fixa, processamento, mensalidade, frete e outras taxas. A margem é tratada como participação do lucro no preço final. Com custo 100 e margem 30, o resultado-base é aproximadamente 142,86.

O frete subsidiado pode depender do preço, mas não participa da convergência inicial. Mensalidade não é rateada por período, pedido ou volume. Campos máximos, royalties, peso/dimensão e várias regras tipadas não são efetivamente usados.

**Risco grave:** margem 100% causa divisão por zero; acima de 100% pode gerar resultado inválido.

### 3.4 Duplicações e divergências

- O motor de marketplace existe em `/calculator/page.tsx` e `/marketplaceCalculator/page.tsx`.
- Tipos de marketplace já divergiram entre as páginas.
- Há parsing monetário diferente entre a calculadora rápida e a profissional.
- A moeda BRL/USD/EUR altera principalmente formatação; não existe conversão cambial.
- Impostos têm bases diferentes: subtotal operacional na profissional e custo + frete no marketplace.
- Embalagem não segue a mesma regra de quantidade.
- Não há arredondamento intermediário; arredondamentos são principalmente de apresentação.
- Estado público usa `sessionStorage`, sem schema robusto na restauração.

Essas diferenças devem ser registradas como comportamento atual, não corrigidas silenciosamente durante o cadastro de impressoras.

## 4. Modelo mínimo sugerido para impressoras FDM

Sugestão conceitual para futura tabela `printers` ou nome equivalente, seguindo os padrões multiempresa existentes:

| Campo | Finalidade | Unidade | Obrigatório | Validação sugerida | Origem |
|---|---|---:|---|---|---|
| `id` | Identificar a máquina física | UUID | Sim | UUID gerado no servidor | Sistema |
| `enterprise_id` | Isolamento empresarial | UUID | Sim | Derivado de `requireBusinessContext`; imutável | Contexto |
| `name` | Nome interno, por exemplo “FDM Produção 01” | texto | Sim | trim; 2–120 caracteres | Usuário |
| `brand` | Identificação do fabricante | texto | Não | trim; até 120 caracteres | Usuário |
| `model` | Identificação do modelo | texto | Não | trim; até 160 caracteres | Usuário |
| `technology` | Discriminar a primeira fase | enum `fdm` | Sim | somente `fdm` nesta entrega | Sistema/formulário |
| `purchase_price` | Base da depreciação | R$ | Sim | finito; `>= 0`; limite compatível com NUMERIC(12,2) | Usuário |
| `estimated_life_hours` | Vida útil para depreciação | horas | Sim | inteiro ou decimal definido pelo domínio; `> 0`; limite operacional explícito | Usuário |
| `average_power_watts` | Potência média durante operação | W | Sim | finito; `> 0`; limite operacional explícito | Usuário |
| `maintenance_cost_per_hour` | Manutenção separada da depreciação | R$/h | Sim | finito; `>= 0` | Usuário/configuração |
| `active` | Disponibilidade para novas precificações | boolean | Sim | default true | Usuário via arquivamento |
| `version` | Concorrência otimista | bigint | Sim | não negativo; incrementado no update | Sistema |
| `created_at` | Auditoria | timestamp | Sim | default servidor | Sistema |
| `updated_at` | Auditoria | timestamp | Sim | trigger/servidor | Sistema |

### Decisões de modelagem

- `depreciation_per_hour` não deve ser armazenado como fonte independente: calcular `purchase_price / estimated_life_hours`.
- Não incluir dimensões, firmware ou número de série no MVP: não participam das fórmulas atuais nem são necessários para selecionar a máquina. Número de série só deve entrar quando houver necessidade operacional de rastreabilidade física, manutenção ou integração de inventário.
- Não incluir campos de resina vazios. Resina terá cálculo próprio posteriormente.
- Não confundir potência média com potência máxima nominal. Texto da interface: “Informe o consumo médio durante a impressão, não a potência máxima indicada na etiqueta ou na fonte.”
- A marca/modelo ajudam identificação, mas o nome interno diferencia máquinas do mesmo modelo.

## 5. Separação de responsabilidades

### Impressora

- preço de aquisição;
- vida útil estimada em horas;
- potência média de operação;
- manutenção por hora;
- disponibilidade/arquivamento.

### Empresa

- tarifa padrão de energia em R$/kWh;
- eventualmente moeda padrão e política de arredondamento, se isso for decidido para o domínio empresarial.

A tarifa não pertence à máquina: duas impressoras da mesma empresa devem consumir a mesma tarifa padrão, salvo ajuste explícito do cálculo.

### Material

Futuro módulo, fora deste incremento:

- custo do material;
- unidade e peso adquirido;
- consumo do trabalho;
- perdas, quando houver regra definida.

Não cadastrar materiais como parte do cadastro de impressoras.

### Impressão específica

- impressora selecionada;
- tempo de impressão;
- consumo de material;
- quantidade de peças;
- trabalho manual/acabamento;
- embalagem;
- taxas específicas;
- ajustes pontuais do cálculo.

Manutenção deve entrar como `maintenance_cost_per_hour × tempo`, separada de depreciação. O motor não deve também incluir manutenção dentro de um “custo hora máquina” agregado, para evitar dupla contabilização.

Perdas precisam de decisão explícita: hoje a calculadora não possui um componente geral de falhas/perdas. Não inferir que material excedente ou falha já esteja incluído no peso informado.

## 6. Integração recomendada com a precificadora

### Calculadora inicial

Começar por `/calculator`, porque ela já tem:

- seleção de marca/modelo;
- consumo médio;
- valor da máquina;
- vida útil;
- tempo de impressão;
- custo de energia;
- modo automático/manual.

Preservar `/fastCalculator` e `/marketplaceCalculator` públicos até existir uma migração explícita do motor e dos contratos.

### Seleção

No contexto autenticado empresarial:

1. Resolver `enterpriseId` pelo contexto do servidor.
2. Ler somente impressoras ativas da empresa.
3. Mostrar nome interno e marca/modelo.
4. Ao selecionar, preencher uma cópia dos parâmetros no estado do cálculo.
5. Exibir uma indicação simples “valor herdado da impressora”.
6. Permitir ajuste pontual, com indicação “ajuste desta precificação”.
7. Não enviar `enterprise_id` confiável do navegador.

O operator deve consultar e selecionar. Owner/admin gerenciam o cadastro. A autorização de seleção deve ser separada da gestão.

### Casos de ausência e alterações

- **Nenhuma impressora cadastrada:** permitir cálculo manual/público e mostrar orientação para cadastrar uma máquina; não bloquear visitantes.
- **Impressora arquivada:** não oferecer em novos cálculos, mas manter o snapshot de precificações antigas. Se já estiver selecionada em um cálculo aberto, marcar “arquivada” e exigir confirmação para trocar ou permitir concluir apenas se a política do produto definir isso.
- **Campo obrigatório ausente:** não calcular o componente dependente; mostrar qual parâmetro precisa ser completado. Não converter ausência em zero silenciosamente.
- **Mudança de seleção:** recalcular somente depois da confirmação/seleção; preservar ajustes manuais apenas se o usuário aceitar reaplicá-los.
- **Alteração concorrente da máquina:** o cálculo aberto mantém sua cópia/snapshot temporário. Ao salvar, detectar versão alterada e oferecer atualizar parâmetros; não sobrescrever a máquina nem recalcular históricos.
- **Salvar precificação:** nunca atualizar automaticamente o cadastro da impressora.

## 7. Histórico e snapshot

Uma precificação salva deve ser compreensível mesmo se a máquina for alterada ou arquivada. O contrato futuro deve guardar, no mínimo:

- `printer_id` nullable;
- versão da impressora no momento da seleção;
- nome/marca/modelo exibidos naquele momento;
- preço de compra;
- vida útil;
- potência média;
- manutenção/hora;
- tarifa de energia;
- tempo;
- quantidade;
- consumo de material e custos;
- trabalho manual/acabamento;
- ajustes específicos;
- resultados por componente e total;
- versão do motor/fórmula;
- timestamps.

O snapshot é fonte histórica; não deve ser reconstituído lendo a impressora atual.

Distinguir:

1. **Simulação:** estado temporário, sem obrigação de persistência.
2. **Precificação salva:** registro imutável ou versionado ligado à empresa e, opcionalmente, a um produto.
3. **Preço atual do produto:** campo operacional de `products`, atualizado somente por ação explícita futura.

Recomendação: salvar uma precificação não deve substituir automaticamente `products.price`. O usuário deve escolher explicitamente “usar como preço do produto”, com validação e concorrência próprias.

## 8. Multiempresa, RLS e permissões futuras

A matriz atual contém `products.*`, empresa, equipe, catálogo e vendas, mas não possui permissões de impressoras ou pricing. Não alterar a matriz nesta análise.

Sugestão coerente para evolução:

- `printers.read`: owner/admin/operator;
- `printers.write`: owner/admin;
- `printers.archive`: owner/admin;
- futuramente `pricing.read`/`pricing.write`, caso precificações salvas sejam um módulo próprio.

Não reutilizar `products.write` para gestão de impressoras, pois operator tem essa permissão hoje e não deve ganhar gerenciamento por efeito colateral.

No banco e nas actions futuras:

- derivar empresa do contexto autenticado;
- RLS por `enterprise_id`;
- grants mínimos por coluna/operação;
- `enterprise_id` imutável;
- validar `printer_id` dentro da empresa;
- não revelar se um UUID pertence a outra empresa;
- usar `version` para updates e arquivamento;
- arquivar sem apagar snapshots;
- RPCs estreitas para criar, editar e arquivar;
- helper SQL de autorização precisa conhecer as novas permissões, não apenas o TypeScript.

## 9. Resina futura

Manter `technology = fdm` como enum explícito no primeiro incremento. Não criar campos de resina vazios nem uma arquitetura genérica de plugins agora.

Pontos de extensão:

- separar o motor de custo por tecnologia em funções puras quando a integração começar;
- manter snapshot com `technology` e versão da fórmula;
- evitar nomes genéricos como `material_cost` que escondam regras diferentes sem documentar a tecnologia;
- criar cadastro e fórmula de resina em incremento separado.

Não há necessidade de dimensões, firmware ou hierarquia de classes para preparar a resina.

## 10. Plano incremental

### Entrega 1 — Cadastro FDM por empresa

**Objetivo:** criar, editar, listar, arquivar e restaurar máquinas físicas.

**Afetados:** rotas empresariais do shell, novo domínio `lib/printers`, tabela empresarial, RPCs/RLS, nova permissão.

**Dependências:** decisão dos limites numéricos e evolução do helper de permissões.

**Conclusão:** owner/admin gerenciam; operator consulta; A não lê nem altera máquinas de B; arquivamento preserva histórico futuro; concorrência retorna conflito.

### Entrega 2 — Tarifa da empresa

**Objetivo:** armazenar tarifa padrão R$/kWh da empresa.

**Afetados:** entidade/configuração empresarial, formulário de empresa e autorização.

**Dependências:** definição se haverá uma tarifa única ou vigência histórica.

**Conclusão:** tarifa validada, sem unidade ambígua, acessível ao cálculo autenticado e sem modificar calculadoras públicas.

### Entrega 3 — Seleção na calculadora profissional

**Objetivo:** selecionar impressora ativa e preencher parâmetros.

**Afetados:** `/calculator` ou uma versão empresarial da calculadora, componente de seleção, módulo de domínio pricing.

**Dependências:** entregas 1 e 2; decisão de autenticação da rota empresarial.

**Conclusão:** operator seleciona; ajustes não alteram cadastro; ausência de máquina não quebra o cálculo; cálculo público continua funcionando.

### Entrega 4 — Snapshot e vínculo ao produto

**Objetivo:** salvar uma precificação histórica e opcionalmente vinculá-la a um produto.

**Afetados:** domínio/tabela de pricing, actions/RPCs, tela de histórico e integração explícita com produto.

**Dependências:** motor puro estabilizado, versão de fórmula, contrato de snapshot.

**Conclusão:** histórico permanece legível após alteração/arquivamento da máquina; preço do produto só muda por ação explícita.

### Entrega 5 — Evoluções

- materiais por empresa;
- perdas/falhas com regra definida;
- pedidos/inventário;
- fórmula de resina;
- rateio de mensalidades e outras taxas;
- migração controlada das calculadoras duplicadas para um motor comum.

## 11. Decisões pendentes

Estas são as decisões que ainda precisam de confirmação antes da implementação:

1. **Limites numéricos:** limite máximo de preço de compra, vida útil, watts e manutenção/hora.
2. **Precisão:** vida útil inteira ou decimal; casas decimais de tarifa, manutenção e potência.
3. **Tarifa:** uma tarifa atual por empresa ou tarifa com vigência/histórico.
4. **Manutenção:** valor zero permitido; custo padrão empresarial ou somente por máquina.
5. **Embalagem:** custo por peça ou por lote na calculadora profissional.
6. **Perdas:** percentual, quantidade adicional ou entrada manual separada.
7. **Modo manual:** permanecer como fallback público, ou ser removido apenas da calculadora empresarial.
8. **Permissões de pricing:** criar `pricing.read`/`pricing.write` já no módulo de histórico ou inicialmente usar uma permissão específica somente para precificações.
9. **Vínculo ao produto:** permitir somente um preço atual por produto ou manter múltiplas versões publicadas.
10. **Margem:** padronizar markup ou margem sobre preço final; a divergência da Fast Calculator não deve ser resolvida silenciosamente.
11. **Arredondamento:** somente apresentação ou arredondamento monetário no domínio antes de salvar snapshot.

As decisões já confirmadas sobre múltiplas máquinas, empresa única, FDM, depreciação, manutenção separada e papéis não precisam ser reabertas.

## 12. Roteiro de validação multiempresa

1. Criar empresa A e empresa B com membros owner/admin/operator.
2. Em A, owner criar duas máquinas do mesmo modelo com nomes e valores diferentes.
3. Confirmar que admin edita/arquiva e operator apenas consulta/seleciona.
4. Confirmar que operator não acessa actions de gestão diretamente.
5. Tentar abrir/alterar UUID de máquina de A estando em B: resposta neutra, sem vazamento.
6. Confirmar RLS de leitura e mutação por `enterprise_id`.
7. Arquivar máquina A e confirmar que ela não aparece em nova seleção, sem apagar histórico futuro.
8. Alterar a versão da máquina em duas abas e confirmar conflito otimista.
9. Selecionar uma máquina, alterar seu cadastro em outra aba e verificar que o cálculo aberto mantém os parâmetros temporários.
10. Confirmar que nenhum cálculo público exige sessão, empresa ou impressora.
11. Conferir que uma precificação salva mantém o snapshot original depois de alterar ou arquivar a máquina.
12. Conferir que salvar uma precificação não altera `products.price` sem ação explícita.

## 13. Limitações e pontos não comprovados

- Nenhuma fórmula foi executada nesta análise com dados reais.
- Não há banco de impressoras ou histórico de precificação no schema atual.
- Não há tarifa empresarial implementada.
- Não há módulo de materiais empresariais.
- Os limites propostos ainda precisam de decisão de produto.
- A análise não valida a semântica dos dados de `public/impressoras.json` além do uso observado no código.
- A moeda atual não faz conversão cambial.
- O comportamento de marketplace contém campos tipados que não participam do cálculo.
- A futura integração deve extrair e testar as fórmulas antes de alterar qualquer resultado visível.
- Este documento não altera código, banco, migrations, permissões ou calculadoras públicas.
