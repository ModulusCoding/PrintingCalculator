# Carretéis 3D — refatoração visual 10

## Referências e análise completa

Localizado por busca em `design-references/`, sem assumir o nome: `stitch_modulus_3d_editor/modulus_carretel_3d_demo.html`. HTML completo (84 linhas), CSS inline e script inline analisados. Não há arquivos de textura/modelo nem dependências gráficas externas associadas ao protótipo. Composição consultada em `stitch_modulus_3d_editor/carret_is_modulus_hub/code.html` e `screen.png`, e diretrizes em README.md.

O protótipo usa WebGL 2 nativo: malhas trianguladas com posições/normais/cores; flanges em x ±0,68, aros de raio 1,34, sete raios radiais, cubo central de raio 0,39. O filamento ocupa x ±0,575, raio interno 0,43 e externo máximo 1,17. Seu raio é `sqrt(0,43² + proporção × (1,17² − 0,43²))`, assim o volume anular acompanha o saldo. Ondulações axiais e anéis laterais representam camadas. Shaders aplicam luz direcional, preenchimento e realce de contorno. Matrizes de perspectiva e rotações X/Y/Z conferem profundidade real. Pointer events controlam yaw/tilt.

Controles demonstrativos descartados: slider de 0–1000 g, saldo inicial 720 g, limite fixo 20%, chips de cores restritas, rótulos de demonstração e oscilação infinita. Não há iframe nem cópia da página demonstrativa. Stitch determina cards claros, hierarquia, filtros e ações; impressora associada, lacrado, telemetria e características ilustrativas não foram implementados.

## Componentes e estratégia

- `components/spools/spool-webgl.ts`: adaptação tipada do motor nativo do proprietário, geometria, iluminação e interação.
- `components/spools/Spool3D.tsx` e CSS: apresentação acessível de saldo/status, fallback e ciclo de vida.
- `lib/spools/visual.ts`: cálculo defensivo puro de percentual e status.
- `lib/spools/color.ts`, `components/spools/SpoolColorField.tsx`: normalização, HEX sincronizado e prévia.
- `components/spools/SpoolForms.tsx` e CSS: integração no cadastro/edição reais, sem novos atributos de payload.
- Rotas reais de listagem/detalhe substituem o indicador SVG por Spool3D. SVG anterior preservado como implementação legada, não utilizado como substituto do modelo.

Cards usam snapshots rasterizados pelo modelo WebGL real em contexto compartilhado, não imagens externas/ilustrações substitutas. Apenas detalhe tem contexto interativo dedicado. Previews não criam um contexto por carretel; são renderizadas quando visíveis e atualizadas por props. Detalhe mantém cena montada entre refreshes, sem key por versão no indicador. Atualizações de volume são finitas (500 ms no detalhe, 650 ms nas prévias); não há render loop ocioso. Cor é material separado do filamento; a estrutura não recebe a cor de alerta. Redução de movimento desativa interpolação. DPR limitado e malhas simplificadas; recursos e listeners liberados no descarte. Perda de contexto ou falha de inicialização mantém fallback textual sem bloquear estoque.

## Saldo e estados

Autoridade única: backend. `current_balance_grams / original_filament_grams × 100`, ambos gramas líquidas, sem tara ou capacidade presumida. Só o volume é limitado a 100%; peso e percentual reais permanecem visíveis. Saldo inválido nunca vira zero. Denominador ausente/inválido mostra estrutura e estado indeterminado, não volume inventado. Zero oculta filamento, mantendo flanges/cubo. Alertas usam limite real `low_spool_threshold_percent`, comparação inclusiva `<=`, excluindo esgotados. Falha de configuração não gera default. Badge/texto separado; HEX não é substituído por laranja/vermelho.

## Cor e persistência

Contrato existente: campo `color` opcional, texto de até 80 caracteres, branco vira null. Suporta HEX arbitrário sem coluna nova. Picker usa sempre #RRGGBB válido; entrada textual pode permanecer incompleta, porém HEX inválido não é enviado pelos formulários. #RGB legado é aceito e expandido para visualização; nomes textuais legados continuam permitidos e explicitamente não são interpretados como pigmentos HEX. HEX é normalizado para maiúsculas. Edição carrega o valor salvo. Criação envia `color` via createSpool, edição via updateSpoolProfile; ações já mapeiam para p_color, e leituras existentes devolvem color. Nenhuma gravação ocorre apenas no estado React.

Previews de cadastro usam somente os pesos válidos digitados; sem saldo/capacidade demonstrativos. Prévia não movimenta estoque. A aparência de branco/preto/amarelo/cinza e demais HEX depende da iluminação; não representa pigmento físico, transparência ou acabamento metálico exatos.

## Contratos preservados

Nenhuma alteração em actions, schemas de domínio, RPCs, migrations, SQL, autenticação/RLS, plano ou Precificadora. PaidModuleNotice e callbacks de gate mantidos. Aprendiz continua indisponível para estoque físico. Capacidade compartilhada 15 permanece central e autoritativa no backend. Permissões owner/admin/operator, operações de consumo/reposição/ajuste, histórico, confirmação, versão e tentativas incertas permanecem. Preço/peso original imutáveis e snapshots históricos preservados.

## Responsividade e acessibilidade

CSS fluido com min-width:0, canvas proporcional e grid existente (3/2/1 colunas). Alvos: 320/375/430/768/1024/1440 px. Toque usa pan-y para não bloquear rolagem; giro horizontal e botões acessíveis por teclado. Canvas decorativo tem equivalente textual com saldo, percentual, estado e falhas. Campos possuem labels, erros associados e foco visível. Superfícies claras, paleta Modulus e Space Grotesk herdada; sem setas decorativas.

## Verificações e segunda revisão

Segunda leitura de todos os arquivos novos/alterados: corrigidos descarte do contexto compartilhado quando o último preview desmonta, redraw em resize, renderização somente após visibilidade, ausência de tween ao mudar só cor, e ocultação de filamento apenas em zero (não em pequenos saldos positivos). Adicionado realce neutro de superfície para HEX preto puro manter iluminação, sem colorir a estrutura. Removida variável de harness que violava regra ESLint do Next.

- Suite consolidada: **158 testes passaram, zero falhas**. Inclui `spool-3d`, `spool-webgl`, `spool-color`, `spools-forms`, `spools-ui-validation`, SVG legado, capacidade compartilhada, gates/autorização, Home e regressões da Precificadora.
- Testes reais de handlers verificam HEX inválido bloqueado antes de action, normalização #RGB/#RRGGBB, payload congelado em retries, defaults reabertos com cor salva. Actions com RPC local simulado verificam p_color e schema de leitura; não comprovam persistência remota.
- Testes do renderer executam funções reais com WebGL simulado: buffers estáveis, uniforms isolados, raio, frames finitos, reduced motion, limpeza, contexto perdido e compartilhamento.
- `npx tsc --noEmit`: passou.
- `npm run build`: passou; aviso preexistente de middleware depreciado.
- ESLint direcionado: passou sem warnings após correção do harness.
- `git diff --check`: passou, somente avisos LF/CRLF do workspace.

### Execução gráfica real isolada

Chrome headless 156, Windows, WebGL 2 ANGLE/SwiftShader: renderer executado em harness temporário local sem instalação ou servidor remoto. `gl.getError() = 0`; cinco cores (branco/preto/amarelo/cinza/azul) e níveis 0/25/50/100 produziram hashes distintos. Rotação programática mudou os pixels, null correspondeu à estrutura vazia e perda forçada de contexto acionou onFailure uma vez. Artefatos temporários em `C:\\Users\\Pichau\\AppData\\Local\\Temp\\opencode\\spool-browser-6y5aZ3`. Reexecução com shader final passou e gerou `C:\\Users\\Pichau\\AppData\\Local\\Temp\\opencode\\spool-browser-gZTYST\\gallery.png`, imagem aberta e inspecionada: profundidade/flanges/camadas, cores distintas e volume vazio/25%/50% visíveis no harness isolado. A execução de métricas final produziu DOM aprovado mas retornou exit 1 do processo Chrome; execução separada da galeria retornou sucesso. Isto comprova execução do renderer e inspeção da galeria isolada, não aprovação visual do app nem teste autenticado, toque físico, frames por segundo em dispositivos reais ou persistência real. Testes locais/mocks não constituem homologação visual ou integração real com banco.

## Pendências e restrições

Homologar rotação WebGL real, iluminação de cores claras/escuras, transição após operação confirmada, movimento reduzido e seis viewports em navegador autenticado. Não declarar aprovação visual com base em testes de unidade. Limitações anteriores de identificação de excluídos e possível gate direto da RPC de threshold continuam documentadas no relatório anterior, fora deste escopo. Sem SQL, Supabase remoto, instalação de dependências, Docker/WSL, commit/push/deploy.
