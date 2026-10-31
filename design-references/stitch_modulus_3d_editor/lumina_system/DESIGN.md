---
name: Lumina System
colors:
  surface: '#f8f9fa'
  surface-dim: '#d9dadb'
  surface-bright: '#f8f9fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f4f5'
  surface-container: '#edeeef'
  surface-container-high: '#e7e8e9'
  surface-container-highest: '#e1e3e4'
  on-surface: '#191c1d'
  on-surface-variant: '#464556'
  inverse-surface: '#2e3132'
  inverse-on-surface: '#f0f1f2'
  outline: '#777588'
  outline-variant: '#c7c4d9'
  surface-tint: '#483ff0'
  primary: '#3d32e6'
  on-primary: '#ffffff'
  primary-container: '#5852ff'
  on-primary-container: '#f2eeff'
  inverse-primary: '#c2c1ff'
  secondary: '#5e5e5e'
  on-secondary: '#ffffff'
  secondary-container: '#e2e2e2'
  on-secondary-container: '#646464'
  tertiary: '#933900'
  on-tertiary: '#ffffff'
  tertiary-container: '#ba4a00'
  on-tertiary-container: '#ffede6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c2c1ff'
  on-primary-fixed: '#0c006a'
  on-primary-fixed-variant: '#2c18d9'
  secondary-fixed: '#e2e2e2'
  secondary-fixed-dim: '#c6c6c6'
  on-secondary-fixed: '#1b1b1b'
  on-secondary-fixed-variant: '#474747'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb695'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#7b2f00'
  background: '#f8f9fa'
  on-background: '#191c1d'
  surface-variant: '#e1e3e4'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.04em
  display-lg-mobile:
    fontFamily: Geist
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 42px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Geist
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  body-base:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
    letterSpacing: 0em
  label-mono:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 40px
  gutter: 24px
  margin-mobile: 16px
  container-max-width: 1200px
---

## Marca e Estilo
O sistema de design adota uma estética **Minimalista Moderna**, inspirada em ferramentas de alta performance e plataformas de desenvolvimento contemporâneas (estilo Linear/Vercel). O objetivo é evocar uma sensação de precisão, clareza arquitetônica e eficiência técnica.

A interface utiliza espaços em branco generosos, tipografia técnica refinada e uma hierarquia visual rigorosa. O foco recai sobre o conteúdo e as ações, eliminando ruídos visuais desnecessários para proporcionar uma experiência de usuário focada e profissional. O público-alvo são desenvolvedores, gestores de produto e usuários de ferramentas SaaS que valorizam velocidade e estética funcional.

## Cores
O esquema de cores é otimizado para legibilidade máxima e contraste nítido em ambientes claros.

- **Primária (#5852ff):** Um violeta elétrico utilizado para ações principais, estados de foco e destaques de marca.
- **Superfície:** O fundo principal é um branco puro (#ffffff), com camadas secundárias em cinza arquitetônico muito claro (#f9fafb) para distinguir áreas de navegação e containers.
- **Contraste:** O texto principal utiliza um cinza quase preto (#111827) para garantir conformidade com padrões de acessibilidade e reduzir o cansaço visual.
- **Bordas:** Delimitadas por um cinza suave (#e5e7eb), criando separações sutis, mas perceptíveis, sem fragmentar excessivamente o layout.

## Tipografia
Este sistema utiliza a família **Geist** em todas as instâncias, aproveitando sua natureza técnica e espaçamento preciso.

A hierarquia é construída através de variações de peso e kerning negativo nos tamanhos maiores (Display) para criar um visual editorial moderno. Os corpos de texto priorizam a leitura contínua com entrelinhamento generoso. Rótulos e metadados utilizam variações mono-espaçadas ou semi-bold em caixa alta para reforçar o aspecto de ferramenta de precisão.

## Layout e Espaçamento
O sistema utiliza uma grade baseada em **8px** para manter a consistência rítmica.

- **Estrutura:** O layout é predominantemente fluido com um limite de largura máxima (max-width) para desktop.
- **Grid:** Sistema de 12 colunas para desktop com calhas (gutters) de 24px. Em dispositivos móveis, a estrutura colapsa para uma coluna única com margens laterais de 16px.
- **Densidade:** O espaçamento é generoso entre seções (XL), mas compacto dentro de componentes funcionais (SM/MD) para manter a eficiência de densidade de dados necessária em SaaS profissionais.

## Elevação e Profundidade
A profundidade é comunicada através de **contornos de baixo contraste** e camadas tonais, evitando sombras pesadas ou tradicionais.

- **Camadas:** O plano de fundo (`#f9fafb`) atua como a base. Cards e áreas de conteúdo elevam-se para o branco puro (`#ffffff`).
- **Bordas:** Em vez de sombras, utilizamos bordas sólidas de 1px (`#e5e7eb`). Para elementos flutuantes (modais, menus), utiliza-se uma sombra extremamente difusa, quase imperceptível, com um leve matiz de azul para simular profundidade real.
- **Interação:** Estados de hover são marcados por uma mudança sutil na cor do fundo ou pelo escurecimento da borda, mantendo a interface plana e bidimensional.

## Formas
A linguagem de formas é **Sóbria e Geométrica**.

Utilizamos o nível de arredondamento `Soft` (raios de 4px a 8px) para suavizar a rigidez técnica sem perder a seriedade profissional. Botões e inputs seguem o padrão de 6px de border-radius para uma aparência equilibrada que se encaixa perfeitamente em grids ortogonais. Elementos de status (pills) podem ocasionalmente usar arredondamento total para diferenciação visual rápida.

## Componentes

- **Botões:** O botão primário utiliza o fundo `#5852ff` com texto branco. Botões secundários utilizam bordas sutis com fundo transparente ou branco. O estado de repouso é nítido, enquanto o hover apresenta uma leve transição de opacidade ou brilho.
- **Inputs:** Campos de entrada possuem bordas de 1px. Quando focados, a borda torna-se a cor primária com um anel de foco (ring) suave de 3px com 20% de opacidade da cor primária.
- **Cards:** Estruturas limpas com fundo branco e borda `#e5e7eb`. Não utilizam sombras por padrão, confiando no contraste de cores entre o card e o fundo da aplicação.
- **Chips/Badges:** Pequenos indicadores com fundo cinza claro ou versões suaves da cor primária, tipografia em peso 500 e tamanho reduzido.
- **Listas:** Itens de lista são separados por bordas horizontais finas. O estado selecionado é indicado por uma barra vertical de 2px na lateral esquerda com a cor primária.