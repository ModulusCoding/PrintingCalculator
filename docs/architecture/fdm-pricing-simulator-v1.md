# Precificadora empresarial FDM — v1

Simulação não persistente em `/precificadora`; não altera cadastros, produtos ou calculadoras públicas. Motor puro em `lib/pricing/fdm.ts`, parsing de interface em `lib/pricing/parse.ts`, precisão interna IEEE-754 double sem arredondamento intermediário; arredondamento somente por Intl no resultado.

Entradas operacionais: lote 1–100.000 peças; tempo de impressão 0–10.000 horas e minutos 0–59 (total precisa ser positivo); tempo manual nos mesmos limites; consumo por material 0,001–1.000.000 g; preço/peso/material seguem limites do cadastro (R$0–1.000.000, duas casas; 0,001–100.000g, três casas); tarifa 0–100 R$/kWh, seis casas; compra R$0–1.000.000; vida 0,001–100.000h; potência 0,001–10.000W; manutenção R$0–1.000/h; mão de obra R$0–100.000/h; acabamento fixo e embalagem R$0–1.000.000; acréscimo 0–100.000%. Máximo 10 linhas de material.

Tempo e consumo são totais por lote; embalagem é por peça. Acréscimo é markup sobre os custos considerados, não margem nem lucro líquido. Ver fórmulas explícitas em `calculateFdmPricing`.

Parâmetros empresariais são lidos pelo cliente Supabase vinculado à sessão, com RLS, contexto empresarial e colunas explícitas. Os valores selecionados são copiados para estado em memória, não sincronizados. Recarregar a página elimina a simulação.
