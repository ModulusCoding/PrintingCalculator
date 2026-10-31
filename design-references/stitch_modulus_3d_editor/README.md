# Modulus Hub — Diretrizes de adaptação do Google Stitch

## Objetivo

Os arquivos desta pasta são referências visuais para a refatoração das interfaces do Modulus Hub.

Eles não representam contratos funcionais, requisitos definitivos nem autorização para desenvolver novas funcionalidades.

## Hierarquia de autoridade

1. Código, modelos, Server Actions, RPCs, permissões e regras de negócio existentes.
2. Escopo e decisões de produto aprovados para o MVP.
3. Referências visuais exportadas do Google Stitch.

Em caso de divergência, preservar o funcionamento e os contratos reais do sistema.

## Filtragem obrigatória

Antes de refatorar cada tela:

1. Inspecionar os arquivos HTML e imagens do Stitch.
2. Inspecionar a implementação atual da tela.
3. Identificar todos os campos, botões, tabelas, gráficos, filtros e ações apresentados no design.
4. Comparar esses elementos com os dados e funcionalidades reais disponíveis.
5. Classificar cada elemento como:
   - **Existente:** funcionalidade já implementada, deve ser preservada.
   - **Adaptável:** elemento visual que pode representar uma funcionalidade real existente.
   - **Futuro:** funcionalidade não implementada, mas prevista no escopo.
   - **Descartável:** elemento ilustrativo ou sem correspondência com o produto aprovado.
6. Implementar somente elementos existentes ou adaptações válidas.
7. Omitir elementos futuros e descartáveis que não sejam necessários à interface atual.

## Preservação funcional

Não remover funcionalidades existentes simplesmente porque estão ausentes no Stitch.

Preservar:

- Formulários e validações reais.
- Operações CRUD.
- Busca, filtros e paginação.
- Modais e confirmações.
- Server Actions e RPCs.
- Autenticação e autorização.
- Restrições por plano.
- Gestão de estoque.
- Transições, reservas e operações de Pedidos.
- Gestão de assinaturas e pagamentos do SaaS.
- Estados de loading, erro, vazio e sucesso.
- Acessibilidade e responsividade.

## Proibições

Não:

- Criar campos de banco a partir do HTML.
- Inventar dados para preencher gráficos ou cartões.
- Criar endpoints apenas porque o design apresenta uma ação.
- Adicionar funcionalidades não aprovadas.
- Implementar botões sem comportamento real.
- Expor operações restritas a usuários sem permissão.
- Modificar regras de negócio para adequá-las ao design.
- Copiar scripts externos do Stitch diretamente para produção.
- Utilizar informações mockadas como dados reais.

## Quando houver conflito

Se a funcionalidade já existe, mas não aparece no Stitch, adaptá-la ao novo design.

Se o Stitch apresentar funcionalidade inexistente, omiti-la.

Se houver dúvida relevante sobre a remoção de uma funcionalidade existente ou alteração de fluxo, preservar o comportamento atual e registrar o conflito para decisão do responsável.

## Resultado esperado

Cada tela refatorada deve parecer visualmente próxima da referência do Stitch, utilizando exclusivamente informações, operações e permissões disponíveis no Modulus Hub.

O resultado final deve ser uma interface funcional, integrada e consistente com o MVP, não uma reprodução estática de um protótipo.
# ADENDO — IDENTIDADE VISUAL OFICIAL DA MODULUS

Aplicar esta instrução à refatoração das telas de Login, Cadastro, Recuperação de Senha e Confirmação de E-mail.

## 1. Prioridade visual

O Google Stitch é referência para layout, composição e experiência de usuário.

A identidade visual oficial da Modulus tem prioridade para:

- Logotipo.
- Paleta de cores.
- Tipografia.
- Linguagem visual.
- Consistência de marca.

Não copiar cores ou logos genéricos presentes nos HTMLs do Stitch quando conflitarem com o branding oficial.

## 2. Logotipo existente

A marca oficial já está disponível na pasta `public/` do projeto.

Antes de implementar:

1. Inspecionar os arquivos existentes em `public/`.
2. Identificar as versões oficiais da logo.
3. Escolher a versão apropriada para fundos claros ou escuros.
4. Utilizar preferencialmente `next/image`, quando adequado.
5. Preservar proporções e área de respiro.
6. Não distorcer, redesenhar, recolorir arbitrariamente ou substituir a logo.

Não criar uma nova logo.

Não adicionar texto "Modulus" ao lado do arquivo se ele já contiver o nome completo.

## 3. Paleta oficial

Utilizar os valores:

- Azul elétrico: `#2B00FF`
- Azul escuro: `#152336`
- Lilás claro: `#A6B4FF`
- Laranja: `#FF4E26`

Utilizar cores neutras complementares para superfícies, textos, bordas e formulários, mantendo contraste e acessibilidade.

Preferir azul elétrico para ações principais, com uso criterioso do laranja como destaque.

Não transformar a interface em uma combinação aleatória de gradientes.

## 4. Tipografia

Utilizar **Space Grotesk**, conforme identidade visual oficial.

Inspecionar a configuração de fontes existente antes de alterá-la.

Evitar carregamentos duplicados ou mudanças globais que afetem outras telas fora do escopo.

## 5. Aplicação nas telas

As quatro experiências de autenticação devem compartilhar a mesma linguagem visual:

- Logo oficial em posição de destaque apropriada.
- Campos e botões consistentes.
- Hierarquia de títulos.
- Espaçamento uniforme.
- Mensagens de erro e sucesso integradas ao visual.
- Composição de desktop próxima ao Stitch.
- Composição mobile adaptada e totalmente funcional.

Utilizar elementos gráficos do Stitch apenas quando forem compatíveis com o branding.

Não introduzir elementos que prejudiquem a legibilidade ou o desempenho.

## 6. Responsividade obrigatória

Login, cadastro, recuperação, redefinição de senha e confirmação de e-mail devem funcionar em desktop, tablet e mobile.

Em mobile, priorizar formulário e conteúdo essencial.

Não ocultar funcionalidades para reproduzir a composição desktop.

## 7. Preservação funcional

Continuar seguindo a regra:

**Código existente = autoridade funcional.**

**Identidade visual oficial = autoridade de marca.**

**Google Stitch = referência de composição visual.**

Não alterar autenticação, validações, permissões, fluxos reais ou contratos existentes para acompanhar elementos ilustrativos do Stitch.

## 8. Entrega

No relatório final, especificar:

- Qual arquivo de logo foi utilizado.
- Onde a marca foi aplicada.
- Como a paleta oficial foi incorporada.
- Como a Space Grotesk foi configurada ou reutilizada.
- Como os layouts se adaptam a mobile, tablet e desktop.
- Quais elementos do Stitch foram alterados para respeitar o branding da Modulus.

Não considerar a refatoração concluída se a logo oficial e a identidade visual aprovada não tiverem sido aplicadas.