# PROMPT MASTER: SPACE MISSION ARCHITECT
## Simulador Espacial 3D Cinematográfico, Educacional e Baseado em Física

Você atuará como um engenheiro de software sênior, arquiteto de sistemas, desenvolvedor de jogos 3D, especialista em simulação física, engenharia aeroespacial e design de experiências educacionais.

Sua missão é **desenvolver uma aplicação completa e funcional chamada Space Mission Architect**, um simulador interativo de planejamento, montagem, lançamento e operação de missões espaciais.

Não quero apenas uma demonstração visual, landing page, protótipo estático ou conjunto de telas desconectadas. Quero um jogo jogável, com progressão real entre etapas, sistemas integrados, decisões com consequências, cálculos consistentes, interface cinematográfica e infraestrutura preparada para produção.

O usuário deve experimentar o ciclo completo de uma missão espacial, desde a escolha do objetivo científico até o relatório final de resultados.

---

# 1. OBJETIVO DO PRODUTO

Criar um simulador educacional no qual o jogador precisa:

1. Identificar o objetivo científico da missão.
2. Planejar a distribuição do orçamento.
3. Montar uma sonda espacial em um hangar 3D.
4. Selecionar instrumentos científicos e subsistemas.
5. Escolher um veículo de lançamento compatível.
6. Planejar a trajetória, a janela de lançamento e as manobras.
7. Validar a viabilidade técnica e financeira.
8. Executar os procedimentos pré-lançamento.
9. Lançar o foguete e acompanhar sua ascensão.
10. Realizar a separação dos estágios e a inserção orbital.
11. Executar correções de trajetória e operações científicas.
12. Coletar dados nos objetivos definidos.
13. Receber um relatório de missão com resultados, pontuação e explicações educacionais.

O jogo deverá ensinar, por meio da experiência prática, conceitos de engenharia aeroespacial, orçamento, gerenciamento de recursos, mecânica orbital, propulsão, energia, instrumentação científica e gerenciamento de riscos.

**Princípio central:** todas as decisões relevantes devem produzir consequências perceptíveis no jogo. Um equipamento não pode ser apenas um objeto visual; ele deve possuir propriedades técnicas que influenciem a missão.

---

# 2. INSTRUÇÕES OBRIGATÓRIAS PARA O CLAUDE CODE

Antes de começar a implementar:

1. Inspecione integralmente o repositório existente.
2. Identifique a estrutura de pastas, tecnologias, dependências, componentes, serviços, modelos de dados, arquivos de configuração e funcionalidades existentes.
3. Leia integralmente os arquivos `orcamento_missoes_espaciais.md` e `componentes-sonda.md`, respeitando os nomes exatos encontrados no repositório.
4. Examine a imagem de referência anexada pelo usuário, que representa o hangar de integração de uma espaçonave.
5. Identifique o que pode ser reutilizado, o que precisa ser corrigido e o que precisa ser desenvolvido.
6. Elabore um plano de implementação por etapas, identificando dependências técnicas e riscos.
7. Comece a implementar o produto, sem encerrar o trabalho após apresentar o plano.

Não destrua funcionalidades existentes sem antes compreender sua finalidade.

Não substitua uma aplicação existente por um projeto genérico. Preserve e integre os componentes úteis, mantendo a consistência arquitetural.

Se o repositório estiver vazio, inicialize a estrutura completa.

Se houver limitações no ambiente, resolva-as com a alternativa tecnicamente mais adequada e documente a decisão.

Não interrompa o desenvolvimento para pedir confirmação sobre decisões técnicas comuns. Faça escolhas fundamentadas, registre as premissas e prossiga.

Não declare funcionalidades como concluídas se estiverem apenas simuladas visualmente, implementadas parcialmente ou sem testes.

---

# 3. TECNOLOGIAS E ARQUITETURA

## 3.1. Stack obrigatória

### Frontend

- React.
- TypeScript em modo estrito.
- Vite.
- Babylon.js com suporte a WebGL 2.
- React BabylonJS, caso a integração realmente simplifique a arquitetura, ou integração direta entre React e Babylon.js.
- Sistema de componentes reutilizáveis.
- Gerenciamento de estado tipado.
- CSS modular, SCSS ou solução equivalente consistente.
- Interface responsiva para desktop, com prioridade para monitores de 1920×1080 e 1366×768.

A experiência 3D deve ser renderizada no navegador por meio do Babylon.js. Não substitua o ambiente 3D por imagens estáticas, vídeos pré-renderizados ou capturas de tela.

### Backend

- Python.
- FastAPI.
- Pydantic para validação de dados.
- SQLAlchemy ou SQLModel para persistência, conforme a compatibilidade escolhida.
- Alembic para migrações de banco de dados.
- Testes automatizados com pytest.

### Banco de dados

- PostgreSQL.
- Neon como opção de PostgreSQL gerenciado para produção.
- Compatibilidade com PostgreSQL local via Docker Compose.

### Infraestrutura

- Docker e Docker Compose para desenvolvimento local.
- Git e GitHub.
- Deploy na Vercel.
- Variáveis de ambiente para configurações e segredos.
- Pipeline de build, testes e verificação de tipos.

## 3.2. Arquitetura proposta

Organize o projeto de forma clara, com separação entre apresentação, simulação, regras de negócio, persistência e infraestrutura.

Estrutura inicial sugerida:

```text
space-mission-architect/
├── frontend/
│   ├── public/
│   │   ├── assets/
│   │   │   ├── models/
│   │   │   ├── textures/
│   │   │   ├── hdr/
│   │   │   ├── audio/
│   │   │   └── fonts/
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── player/
│   │   │   ├── missions/
│   │   │   ├── spacecraft/
│   │   │   ├── launch-vehicles/
│   │   │   ├── mission-planning/
│   │   │   ├── launch-control/
│   │   │   ├── simulation/
│   │   │   └── mission-report/
│   │   ├── engine/
│   │   │   ├── core/
│   │   │   ├── scenes/
│   │   │   ├── entities/
│   │   │   ├── physics/
│   │   │   ├── orbital-mechanics/
│   │   │   ├── propulsion/
│   │   │   ├── atmosphere/
│   │   │   ├── failures/
│   │   │   └── effects/
│   │   ├── services/
│   │   ├── store/
│   │   ├── types/
│   │   ├── styles/
│   │   └── main.tsx
│   ├── package.json
│   └── vite.config.ts
├── api/
│   ├── index.py
│   └── ...
├── backend/
│   ├── app/
│   │   ├── api/
│   │   ├── core/
│   │   ├── models/
│   │   ├── schemas/
│   │   ├── services/
│   │   ├── simulation/
│   │   └── repositories/
│   ├── tests/
│   └── requirements.txt
├── data/
│   ├── missions/
│   ├── components/
│   ├── launch-vehicles/
│   └── scientific-sources/
├── docs/
│   ├── architecture.md
│   ├── physics-model.md
│   ├── scientific-sources.md
│   └── deployment.md
├── docker-compose.yml
├── Dockerfile
├── vercel.json
├── .env.example
└── README.md
```

Essa estrutura é uma referência, não uma exigência de criar pastas vazias. Ajuste-a conforme as necessidades reais do projeto.

Evite duplicação de regras entre frontend e backend.

Os dados apresentados no catálogo devem possuir uma única fonte de verdade. O frontend poderá utilizar arquivos JSON versionados para os dados estáticos do catálogo e deverá consultar o backend para operações persistentes e resultados que precisem ser validados.

O motor de simulação deverá ficar desacoplado da interface React.

**Importante:** não presuma que um container Docker tradicional possa ser executado como servidor persistente na Vercel. Configure o frontend estático e as funções Python de acordo com as limitações reais da plataforma. O Docker deverá servir principalmente ao ambiente local, testes e desenvolvimento.

Caso o repositório ou a configuração atual não seja compatível com a arquitetura proposta, escolha a adaptação mínima que preserve os requisitos.

---

# 4. IDENTIDADE VISUAL E DIREÇÃO DE ARTE

O jogo deve transmitir a sensação de estar operando um programa espacial profissional.

A direção de arte combina:

- Realismo industrial.
- Cinematografia de ficção científica hard sci-fi.
- Interfaces de controle de missão.
- Ambientes de integração de satélites.
- Modelos tridimensionais detalhados.
- Iluminação fisicamente plausível.
- Instrumentação científica legível.
- Efeitos visuais utilizados com moderação e propósito.

Utilize uma paleta de cores frias, com predominância de grafite, aço, branco industrial, azul tecnológico e detalhes em âmbar. Verde deve ser utilizado principalmente para estados operacionais e telemetria.

Evite interfaces excessivamente coloridas, aparência infantil, excesso de neon, cartões genéricos ocupando toda a tela ou elementos visuais que pareçam pertencer a um dashboard administrativo convencional.

O ambiente 3D deve ser o protagonista.

Os painéis devem complementar a cena, sem ocultar a sonda, o foguete ou os elementos necessários à interação.

## 4.1. Qualidade visual

Utilize:

- PBR Materials.
- Texturas adequadas às escalas dos objetos.
- Sombras e iluminação coerentes.
- Reflexos controlados.
- Ambientação industrial detalhada.
- Câmeras cinematográficas.
- Animações suaves.
- Partículas para efeitos de propulsão.
- Pós-processamento moderado, quando houver benefício visual.
- Modelos 3D próprios, licenciados ou gerados proceduralmente.

Não utilize uma esfera metálica ou um conjunto de caixas primitivas como representação final de uma sonda científica complexa.

Modelos procedurais são aceitáveis para construir a geometria base, mas devem receber detalhes, materiais, proporções e acessórios suficientes para apresentar aparência de equipamento aeroespacial.

Não dependa de serviços externos que exijam chaves de API para renderizar o ambiente básico.

Se modelos externos forem utilizados, registre suas licenças e forneça alternativas locais.

---

# 5. FLUXO COMPLETO DO JOGO

Implemente as seguintes etapas como estados reais de uma campanha.

```text
IDENTIFICAÇÃO DO JOGADOR
        ↓
SELEÇÃO DA MISSÃO
        ↓
HANGAR DE MONTAGEM DA SONDA
        ↓
SELEÇÃO DO VEÍCULO DE LANÇAMENTO
        ↓
PLANEJAMENTO DA TRAJETÓRIA
        ↓
BRIEFING E VALIDAÇÃO TÉCNICA
        ↓
CENTRO DE CONTROLE E PLATAFORMA
        ↓
CONTAGEM REGRESSIVA E LANÇAMENTO
        ↓
ASCENSÃO E SEPARAÇÃO DE ESTÁGIOS
        ↓
INSERÇÃO ORBITAL E MANOBRAS
        ↓
CHECKPOINTS CIENTÍFICOS
        ↓
RELATÓRIO E AVALIAÇÃO DA MISSÃO
```

O usuário não poderá avançar livremente para uma etapa que dependa de validações ainda não concluídas.

Implemente navegação consistente, estados de carregamento, recuperação de erros e possibilidade de retornar às etapas anteriores quando isso for permitido.

A campanha deverá preservar as decisões tomadas pelo jogador.

---

# 6. TELA INICIAL E IDENTIFICAÇÃO DO JOGADOR

Crie uma tela inicial cinematográfica.

Elementos:

- Logotipo Space Mission Architect.
- Cena espacial animada ao fundo.
- Uma espaçonave ou planeta visível em segundo plano.
- Campo para o nome do jogador.
- Botão para iniciar.
- Identidade visual coerente com o restante do jogo.

O nome é obrigatório, deve ter tamanho limitado e não pode ser composto apenas por espaços.

Após confirmar, registre a identidade da sessão e encaminhe o jogador à seleção de missão.

Não obrigue o usuário a criar uma conta apenas para iniciar uma partida.

Persistência local poderá ser utilizada para recuperar o progresso no mesmo navegador. A persistência no PostgreSQL deverá ser utilizada para campanhas salvas e relatórios associados a um identificador de jogador ou sessão.

Não exponha informações pessoais desnecessárias.

---

# 7. SELEÇÃO DE MISSÕES

Implemente inicialmente três missões, com informações científicas e objetivos claros.

## MISSÃO 01: OBSERVAÇÃO CLIMÁTICA TERRESTRE

Dificuldade: fácil.

Objetivo:

Projetar e lançar um satélite de observação para uma órbita baixa da Terra, capaz de coletar dados relacionados às condições climáticas.

Requisitos de gameplay:

- Escolher instrumentos de observação.
- Selecionar sistemas de energia.
- Configurar armazenamento de dados.
- Configurar comunicação com a Terra.
- Dimensionar a massa da espaçonave.
- Selecionar um foguete compatível.
- Planejar uma órbita terrestre apropriada.
- Executar uma inserção orbital válida.
- Coletar dados científicos em checkpoints.

A missão deve apresentar dificuldades introdutórias e explicar os conceitos necessários ao jogador.

Não fixe altitude, inclinação ou período orbital sem relacioná-los aos requisitos científicos e às características da órbita escolhida.

## MISSÃO 02: MAPEAMENTO LUNAR PARA PESQUISA DE HÉLIO-3

Dificuldade: média.

Objetivo:

Enviar uma sonda para a região lunar definida pela missão, mapear áreas de interesse e produzir dados científicos relacionados à distribuição potencial de recursos.

Requisitos:

- Trajetória de transferência Terra-Lua.
- Escolha de instrumentos de mapeamento.
- Consideração da geometria de observação.
- Planejamento da chegada e inserção orbital lunar.
- Correções de trajetória.
- Gestão de energia e comunicação.
- Coleta de dados nos pontos científicos definidos.

**Rigor científico:** o jogo não deve apresentar a presença de Hélio-3 economicamente extraível como algo já comprovado em qualquer ponto escolhido pelo jogador. Diferencie medição, estimativa de abundância, potencial de exploração e viabilidade econômica.

## MISSÃO 03: SONDA DE OBSERVAÇÃO DE JÚPITER

Dificuldade: difícil.

Objetivo:

Enviar uma sonda à região de Júpiter para estudar o planeta, sua magnetosfera e a relação entre o ambiente joviano e a população de objetos menores do Sistema Solar.

A missão deverá apresentar os seguintes desafios:

- Viagem interplanetária de longa duração.
- Seleção de trajetória e janela de lançamento.
- Planejamento de assistência gravitacional, quando aplicável.
- Gestão energética em grande distância do Sol.
- Comunicação com grandes atrasos.
- Proteção dos instrumentos contra o ambiente de radiação.
- Planejamento de correções de trajetória.
- Inserção orbital ou trajetória de observação compatível com os objetivos científicos.

A descrição da missão deve explicar uma distinção fundamental: Júpiter influencia as trajetórias de cometas e asteroides, mas sua gravidade não constitui um escudo universal da Terra. O efeito sobre os impactos terrestres depende das populações de objetos, condições iniciais e interações gravitacionais.

O jogador deverá estudar essas relações por meio de dados e objetivos científicos, e não receber uma conclusão simplificada e incorreta.

## 7.1. Estrutura de dados das missões

Cada missão deve ser definida em dados versionados, incluindo:

- Identificador.
- Nome.
- Descrição.
- Dificuldade.
- Objetivos científicos.
- Orçamento disponível.
- Objetivos orbitais.
- Corpos celestes envolvidos.
- Requisitos mínimos de carga útil.
- Instrumentos recomendados.
- Requisitos energéticos.
- Requisitos de comunicação.
- Requisitos de propulsão.
- Critérios de sucesso.
- Critérios de pontuação.
- Eventos e checkpoints.
- Fontes científicas.
- Limitações conhecidas do modelo.

Não codifique todas as regras de missão diretamente dentro dos componentes React.

A inclusão de novas missões deverá ser possível por meio de arquivos de configuração e serviços reutilizáveis.

---

# 8. SISTEMA DE ORÇAMENTO

O arquivo `orcamento_missoes_espaciais.md` é uma fonte obrigatória para os preços de lançamento e os orçamentos históricos nele registrados.

Leia o arquivo integralmente e transforme seus dados em uma estrutura tipada e validada.

O documento apresenta, entre outros itens:

- Falcon 9: US$ 67 milhões.
- Falcon Heavy: US$ 97 milhões.
- Starship: estimativa de US$ 90 milhões a US$ 150 milhões.
- Soyuz: US$ 80 milhões.
- New Glenn: estimativa de US$ 100 milhões a US$ 120 milhões.
- SLS: US$ 2,2 bilhões, conforme o documento.

Esses valores devem ser identificados como valores reportados pelo documento, com sua classificação, observações e ressalvas.

Não trate preços estimados, preços históricos, custos governamentais acumulados e custos comerciais por lançamento como valores equivalentes.

Não apresente esses números como cotações garantidas ou necessariamente atuais.

## 8.1. Orçamento variável por missão

Cada missão deverá possuir um orçamento de jogo próprio.

Como o documento não define diretamente os orçamentos disponíveis para as três missões fictícias, crie uma configuração de orçamento para gameplay com:

- Valor disponível.
- Moeda de referência.
- Política de conversão, caso necessária.
- Custos dos componentes.
- Custo de lançamento.
- Reserva de contingência.
- Custos operacionais.
- Custos de testes.
- Custo de desenvolvimento, se incluído no escopo da missão.

Não invente que os orçamentos criados para gameplay são oficiais. Identifique-os como parâmetros didáticos configuráveis.

A configuração deverá permitir ajustar a dificuldade sem alterar o código do simulador.

## 8.2. Conversão de moeda

O jogo deverá ter uma moeda de referência claramente definida.

Como os custos fornecidos estão em dólares, mantenha o dólar como moeda-base para os dados de origem.

Se for oferecida uma visualização em reais, utilize uma taxa de conversão configurada, acompanhada da data ou da indicação de que se trata de um parâmetro ilustrativo.

Não utilize uma cotação cambial inventada como se fosse atual.

## 8.3. Custos calculados

Calcule, no mínimo:

- Custo dos componentes.
- Custo do veículo de lançamento.
- Custo total da configuração.
- Saldo disponível.
- Percentual do orçamento utilizado.
- Reserva de contingência.
- Excesso orçamentário.

A reserva de contingência deve ser configurável por missão e não poderá ser contabilizada duas vezes.

Não permita que uma missão seja considerada financeiramente válida quando ultrapassar o limite definido, incluindo os custos obrigatórios da configuração.

---

# 9. HANGAR 3D DE MONTAGEM DA SONDA

Esta é uma das telas centrais do jogo.

O ambiente deverá ser construído com Babylon.js e WebGL 2.

Utilize a imagem anexada como referência visual para o hangar: uma instalação aeroespacial industrial de grandes dimensões, com estruturas metálicas, iluminação de teto, piso técnico, guindastes, equipamentos de integração e braços robóticos.

Não reproduza a imagem como plano de fundo estático. Construa um ambiente tridimensional interativo.

## 9.1. Ambiente

O hangar deve incluir:

- Estrutura metálica industrial.
- Colunas, vigas e passarelas.
- Portões de grandes dimensões.
- Iluminação industrial.
- Piso técnico.
- Bancadas de integração.
- Cabos e conexões de serviço.
- Carrinhos de ferramentas.
- Equipamentos de inspeção.
- Duas unidades de braços robóticos.
- Plataforma central de montagem.
- Sonda visível no centro da cena.

A escala deve ser coerente entre os objetos.

Utilize uma câmera controlável por mouse, com zoom, rotação e enquadramento automático da sonda.

Permita alternar entre a visão geral do hangar e uma câmera de inspeção próxima.

## 9.2. Sonda modular

A sonda deve ser um modelo tridimensional composto por módulos independentes.

Cada componente adicionado precisa ter:

- Identificador único.
- Tipo.
- Nome.
- Modelo 3D ou configuração geométrica.
- Massa.
- Custo.
- Consumo de energia.
- Dimensões.
- Requisitos de conexão.
- Compatibilidade.
- Função científica ou operacional.
- Descrição didática.
- Fonte técnica.
- Limitações.
- Estado de instalação.

A montagem deverá produzir uma representação visual coerente, não apenas uma lista de itens comprados.

Exemplos de categorias:

- Estrutura principal.
- Computador de bordo.
- Sistema de energia.
- Painéis solares.
- Baterias.
- Antenas.
- Transmissores.
- Propulsão.
- Tanques.
- Sensores.
- Câmeras.
- Espectrômetros.
- Instrumentos de radar.
- Sistemas de controle de atitude.
- Rodas de reação.
- Rastreadores estelares.
- Sensores solares.
- Sistemas térmicos.
- Blindagem e proteção.
- Armazenamento de dados.

A lista definitiva e os atributos específicos devem vir do arquivo `componentes-sonda.md`, caso ele esteja presente no repositório.

Não invente componentes e os apresente como se estivessem documentados no arquivo.

Caso o arquivo esteja ausente, documente a ausência, crie uma estrutura de dados provisória claramente identificada e não afirme ter realizado a integração dos dados originais.

## 9.3. Catálogo à esquerda

O lado esquerdo da tela deverá apresentar uma lista vertical de componentes disponíveis.

Cada item deve exibir:

- Imagem ou miniatura.
- Nome.
- Categoria.
- Descrição resumida.
- Custo.
- Massa.
- Consumo energético.
- Disponibilidade ou compatibilidade.

Inclua busca, filtros por categoria e ordenação por custo, massa ou consumo.

O catálogo não deve ocupar uma área que torne impossível visualizar a sonda.

Quando um componente for selecionado, mostre uma prévia e a opção de adicioná-lo.

Componentes incompatíveis devem indicar claramente o motivo da incompatibilidade.

## 9.4. Painel didático à direita

Ao selecionar um componente, apresente:

- Nome.
- Imagem ou visualização.
- Função.
- Importância para a missão atual.
- Massa.
- Custo.
- Consumo.
- Benefícios.
- Limitações.
- Dependências.
- Consequências de sua ausência.
- Fontes técnicas disponíveis.

A explicação deve se adaptar à missão selecionada.

Um instrumento pode ser útil para uma missão e irrelevante para outra. O jogo precisa explicar essa diferença.

## 9.5. Interação 3D

Ao adicionar um componente:

1. Atualize a configuração lógica da sonda.
2. Atualize os cálculos de massa, energia e custo.
3. Crie ou instancie o modelo 3D correspondente.
4. Posicione o componente em um ponto de montagem compatível.
5. Execute uma animação de instalação.
6. Atualize os braços robóticos.
7. Atualize o catálogo e os painéis.

Ao remover um componente, execute o processo inverso.

A sonda deve refletir visualmente seu estado atual. Não aceite que o painel indique um instrumento instalado enquanto o modelo 3D o representa como ausente.

## 9.6. Braços robóticos

Implemente dois braços robóticos funcionais.

Cada braço deverá possuir uma hierarquia articulada, movimentos animados e uma ferramenta de manipulação.

As animações devem incluir:

- Orientação para o componente.
- Aproximação.
- Alinhamento.
- Fixação.
- Retorno à posição de espera.

Não é necessário implementar um sistema industrial completo de controle robótico, mas os movimentos devem ser visualmente coerentes e sincronizados com as ações do jogador.

Os braços não devem se mover aleatoriamente. Devem responder às operações de montagem e desmontagem.

## 9.7. Integridade estrutural

Implemente regras de compatibilidade e dependências.

Por exemplo:

- Um instrumento precisa possuir uma forma de comunicação ou armazenamento para que seus dados sejam úteis.
- Um subsistema de energia deve ser capaz de atender às cargas previstas.
- Um equipamento que exija apontamento deve ser compatível com os sistemas de atitude.
- Componentes de propulsão precisam de interfaces, alimentação e propelente compatíveis.
- A massa total precisa ser calculada a partir dos componentes efetivamente instalados.

Não bloqueie combinações arbitrariamente. Toda restrição deverá possuir uma explicação técnica ou uma justificativa de gameplay documentada.

---

# 10. SELEÇÃO DO FOGUETE E HANGAR DE LANÇADORES

Após concluir a montagem da sonda, encaminhe o jogador para a escolha do veículo de lançamento.

A tela também será um ambiente 3D cinematográfico construído com Babylon.js.

Diferentemente do hangar de sondas, este ambiente deverá ser muito maior e dimensionado para comportar o maior veículo de lançamento incluído no catálogo.

## 10.1. Hangar de foguetes

O ambiente deverá apresentar:

- Galpão industrial de grande altura.
- Estruturas de sustentação.
- Plataformas e passarelas.
- Equipamentos de transporte.
- Sistemas de inspeção.
- Iluminação cinematográfica.
- Escala física coerente.
- Câmera capaz de mostrar o foguete inteiro.

O foguete não pode aparecer cortado pelo teto ou parcialmente fora do cenário.

Implemente enquadramento automático conforme as dimensões do veículo.

## 10.2. Catálogo de foguetes

As opções iniciais devem vir da coluna Foguete do arquivo `orcamento_missoes_espaciais.md`, conforme os nomes e dados efetivamente encontrados.

Inclua os veículos identificados no documento, sem presumir que todos estarão automaticamente disponíveis para todas as missões.

Para cada veículo, registre:

- Nome.
- Fabricante ou agência.
- Custo por lançamento.
- Tipo.
- Capacidade de carga útil.
- Capacidade conforme a órbita de destino.
- Massa máxima suportada.
- Número de estágios.
- Características de propulsão.
- Estado de reutilização.
- Limitações operacionais.
- Fonte dos dados.
- Data ou contexto de referência.

**Não deduza a capacidade para a órbita lunar ou para trajetórias interplanetárias diretamente de uma capacidade declarada para órbita baixa terrestre.**

Quando um valor estiver ausente nas fontes disponíveis, marque-o como pendente de validação e procure uma fonte técnica adequada antes de utilizá-lo em cálculos que determinam a aprovação da missão.

Não invente capacidades para fazer um foguete passar na validação.

## 10.3. Seleção e visualização

Ao selecionar um foguete:

- Atualize o modelo 3D.
- Exiba o perfil técnico.
- Mostre o custo.
- Mostre a capacidade de carga.
- Compare a carga útil com a massa da sonda.
- Exiba uma indicação de compatibilidade com a missão.
- Mostre os principais limites de operação.
- Explique por que o veículo é adequado ou inadequado.

A seleção do veículo deverá atualizar o estado persistente da campanha.

---

# 11. PLANEJAMENTO DA MISSÃO E MECÂNICA ORBITAL

O planejamento orbital deverá ser um sistema funcional, e não um formulário que produz resultados aleatórios.

O jogador deverá poder configurar:

- Órbita ou trajetória desejada.
- Altitude de órbita, quando aplicável.
- Inclinação orbital.
- Excentricidade.
- Órbita circular ou elíptica.
- Número de órbitas terrestres antes da próxima manobra.
- Janela de lançamento.
- Data e horário da partida.
- Manobras previstas.
- Correções de trajetória.
- Duração estimada.
- Órbita ou trajetória de chegada.
- Objetivos científicos.
- Restrições de comunicação.
- Restrições energéticas.

Os parâmetros disponíveis deverão variar conforme a missão.

Uma missão lunar não pode utilizar exatamente o mesmo planejamento de uma missão interplanetária a Júpiter.

## 11.1. Física orbital

Implemente um motor de simulação separado da interface.

O modelo inicial deve incluir, conforme o estágio de desenvolvimento:

- Gravitação newtoniana.
- Parâmetros gravitacionais dos corpos.
- Posição e velocidade da espaçonave.
- Massa total.
- Propulsão.
- Consumo de propelente.
- Delta-v.
- Trajetórias orbitais.
- Transferências orbitais.
- Inserção orbital.
- Correções de trajetória.
- Gravidade de mais de um corpo, quando necessária.
- Propagação numérica do estado da espaçonave.

Utilize unidades explícitas e consistentes, preferencialmente SI nos cálculos físicos.

Não misture quilômetros com metros ou horas com segundos sem conversão.

Separe a escala visual do Babylon.js das unidades físicas utilizadas no motor.

O estado da simulação deverá incluir, no mínimo:

- Tempo de missão.
- Posição.
- Velocidade.
- Massa.
- Propelente restante.
- Energia disponível.
- Estado dos subsistemas.
- Estado orbital.
- Eventos ocorridos.

## 11.2. Delta-v

Calcule o delta-v disponível a partir dos parâmetros reais ou documentados do sistema de propulsão.

Quando os dados forem adequados, utilize a equação do foguete de Tsiolkovsky:

Δv = Isp × g₀ × ln(m₀ / mf)

Em que:

- Isp representa o impulso específico.
- g₀ representa a aceleração padrão da gravidade.
- m₀ representa a massa inicial.
- mf representa a massa final após o consumo do propelente considerado.

A equação deve ser aplicada somente ao sistema de propulsão e à configuração de massas compatíveis com suas premissas.

Não trate o delta-v do foguete lançador como se fosse automaticamente o delta-v disponível à sonda após a separação.

Calcule e documente os orçamentos de delta-v por fase da missão, incluindo as manobras necessárias e as margens adotadas.

## 11.3. Órbitas e transferências

Para a primeira versão, priorize um conjunto de modelos bem definidos:

- Órbita terrestre.
- Transferência Terra-Lua.
- Inserção orbital lunar.
- Transferência interplanetária.
- Chegada e captura em torno de Júpiter.

Quando necessário, utilize modelos de dois corpos para o cálculo inicial e propagação numérica com múltiplos corpos para cenários que realmente exijam esse nível de fidelidade.

Uma aproximação simplificada deve ser identificada na documentação e na interface.

Não apresente uma trajetória de transferência simplificada como se fosse uma efeméride operacional de alta precisão.

Se a missão depender de uma janela de lançamento real, utilize dados orbitais e efemérides de fontes técnicas verificáveis. Caso contrário, identifique a janela como calculada pelo modelo educacional.

---

# 12. BRIEFING INTERATIVO 3D

Após o planejamento, exiba um briefing completo da missão.

O cenário deverá apresentar a sonda e o veículo de lançamento em 3D, com iluminação e enquadramento cinematográficos.

O briefing deve funcionar como uma inspeção técnica interativa.

Ao clicar em um componente, mostre:

- Nome.
- Função.
- Massa.
- Custo.
- Consumo.
- Características.
- Relevância para a missão.
- Fonte técnica.
- Estado de funcionamento.

Permita alternar entre uma visão geral e uma inspeção dos componentes.

## 12.1. Validação técnica

O briefing deverá executar e exibir verificações reais.

### Validação financeira

- Orçamento disponível.
- Custo da sonda.
- Custo do foguete.
- Custos adicionais aplicáveis.
- Reserva de contingência.
- Saldo.
- Excesso orçamentário.

### Validação de massa

- Massa da sonda.
- Massa dos componentes.
- Massa dos propelentes.
- Massa da carga útil.
- Capacidade admissível do veículo para o perfil selecionado.
- Margem de carga útil.

### Validação de propulsão

- Empuxo.
- Massa no momento considerado.
- Relação empuxo-peso.
- Propelente disponível.
- Delta-v estimado.
- Delta-v necessário.
- Margem de delta-v.
- Compatibilidade entre a configuração e as manobras.

### Validação de subsistemas

- Geração e consumo de energia.
- Capacidade de armazenamento.
- Comunicação.
- Controle de atitude.
- Gestão térmica.
- Compatibilidade dos instrumentos.
- Dependências estruturais.

### Validação orbital

- Compatibilidade do perfil de lançamento.
- Viabilidade da trajetória.
- Necessidade de manobras adicionais.
- Janela de lançamento.
- Requisitos de chegada.

## 12.2. Aprovação de lançamento

Crie um sistema centralizado de validação.

Cada verificação deverá retornar:

- Identificador.
- Estado: aprovada, aviso ou reprovada.
- Resultado calculado.
- Limite exigido.
- Margem.
- Explicação didática.
- Ação corretiva recomendada.
- Fonte utilizada, quando aplicável.

Se uma condição obrigatória falhar, bloqueie o lançamento.

O botão de prosseguimento deverá encaminhar o jogador à etapa necessária para corrigir o problema.

Exemplo: se a capacidade de carga útil for insuficiente, recomende reduzir a massa da sonda ou selecionar outro veículo compatível.

Não permita contornar uma reprovação obrigatória apenas clicando em um botão de confirmação.

Os critérios de aprovação devem estar centralizados no motor de regras, não distribuídos por componentes de interface.

---

# 13. PLATAFORMA DE LANÇAMENTO E CENTRO DE CONTROLE

Após a aprovação técnica, encaminhe o jogador para uma plataforma de lançamento situada em um ambiente diferente do hangar.

O cenário deverá ser um ambiente 3D de grande escala, com o foguete posicionado verticalmente.

Inclua:

- Plataforma de lançamento.
- Estrutura de sustentação.
- Torres de acesso.
- Linhas de abastecimento.
- Cabos e conexões.
- Sistemas de suporte em solo.
- Área de segurança.
- Céu e condições ambientais.
- Câmeras de observação.
- Iluminação natural ou artificial coerente.

O foguete deve ser o elemento visual central.

A câmera deverá permitir observar o veículo inteiro e alternar para ângulos cinematográficos.

Não utilize o mesmo hangar de montagem como cenário da plataforma.

## 13.1. Telemetria do centro de controle

No canto inferior esquerdo, exiba um painel inspirado em terminais técnicos de controle de missão.

O painel terá tipografia monoespaçada, texto predominantemente verde e atualização em tempo real.

Inclua verificações de:

- Comunicação.
- Software de voo.
- Sistemas elétricos.
- Sensores.
- Pressurização.
- Sistemas de propulsão.
- Temperaturas.
- Vibração.
- Integridade estrutural.
- Sistemas de solo.
- Condições ambientais.
- Estado da contagem regressiva.

As informações deverão derivar do estado da simulação.

Não gere uma lista de mensagens aleatórias sem relação com o veículo.

## 13.2. Vibração

Implemente uma variável de vibração coerente com a fase operacional.

A interface poderá exibir classificações como:

- Vibração sutil.
- Pouca vibração.
- Vibração moderada.
- Vibração considerável.
- Vibração crítica.

Os limites de classificação devem ser configuráveis e associados a unidades físicas quando os dados estiverem disponíveis.

Durante as fases de preparação, ignição, ascensão e separação de estágios, os níveis poderão variar conforme o modelo utilizado.

Se o modelo não possuir dados estruturais suficientes para simular tensões reais, apresente a vibração como uma variável didática de risco, sem alegar que representa uma análise estrutural certificada.

## 13.3. Pressurização e sistemas

Implemente verificações coerentes para:

- Pressão dos tanques.
- Estado das válvulas.
- Alimentação elétrica.
- Sistemas de controle.
- Sensores.
- Software de voo.
- Sistemas de ignição.
- Sistemas de solo.
- Condições ambientais.

As falhas deverão afetar o estado do sistema correspondente.

Uma falha elétrica, por exemplo, não pode ser apenas uma mensagem na tela. Ela deve produzir consequências coerentes com o subsistema afetado.

---

# 14. CONTAGEM REGRESSIVA E DECISÕES DE LANÇAMENTO

Implemente uma sequência operacional.

A interface deverá oferecer controles de:

- Iniciar procedimentos.
- Pausar a simulação, quando permitido.
- Abortar a missão.
- Confirmar o lançamento.

As ações disponíveis deverão variar conforme o estado operacional.

## 14.1. Ignição

Ao iniciar a sequência de ignição, execute uma animação com:

- Partículas de gases.
- Emissão de luz.
- Fumaça.
- Aquecimento visual.
- Ondas de calor, quando apropriadas.
- Efeitos de propulsão.
- Vibração da câmera, com moderação.
- Som, se houver recursos de áudio licenciados.

As chamas não devem aparecer instantaneamente sem transição.

A animação deverá acompanhar a sequência de ignição e o estado dos motores.

## 14.2. Falhas e aborto

As falhas deverão resultar de um sistema de eventos baseado em probabilidades configuráveis e condições operacionais.

A ocorrência deverá considerar fatores como:

- Qualidade dos componentes.
- Estado dos sistemas.
- Condições ambientais.
- Nível de manutenção ou testes.
- Exposição a condições adversas.
- Configuração da missão.

Não use falhas aleatórias sem relação com as decisões do jogador.

O jogador deverá poder abortar o lançamento diante de condições inseguras.

Quando a missão ainda estiver na plataforma, o procedimento de aborto deverá desligar os sistemas de propulsão de acordo com a sequência modelada, interromper a contagem e atualizar o estado operacional.

Se houver falhas, mas nenhuma condição obrigatória de segurança estiver violada, a simulação poderá apresentar alertas e permitir que o jogador decida como proceder, respeitando as regras configuradas.

**Importante:** não permita que o usuário ignore bloqueios técnicos obrigatórios definidos no briefing.

O comportamento de insistência deverá ser aplicado apenas a situações em que a simulação permita uma decisão operacional arriscada.

---

# 15. ANIMAÇÃO DE LANÇAMENTO

Quando o lançamento for autorizado, execute uma sequência cinematográfica contínua.

A sequência deverá incluir:

1. Ativação dos motores.
2. Formação do fluxo de gases.
3. Expansão da pluma de exaustão.
4. Formação de fumaça e poeira.
5. Iluminação do ambiente pela exaustão.
6. Liberação das estruturas de sustentação.
7. Elevação do foguete.
8. Aceleração progressiva.
9. Mudança de enquadramento da câmera.
10. Ascensão atmosférica.
11. Separação dos estágios.
12. Continuação da trajetória.
13. Descarte ou recuperação de estágios, quando aplicável ao modelo selecionado.
14. Desligamento de motores.
15. Inserção orbital.

Não represente todo o lançamento como uma animação independente da física.

A posição do foguete deverá estar vinculada ao estado calculado pelo motor de simulação.

Os efeitos visuais devem acompanhar o movimento físico, respeitando a escala visual e o tempo da simulação.

## 15.1. Modelo de ascensão

Considere:

- Gravidade.
- Massa variável.
- Empuxo.
- Consumo de propelente.
- Resistência atmosférica.
- Densidade atmosférica.
- Pressão dinâmica.
- Perfil de atitude.
- Separação dos estágios.
- Limites de operação.

Utilize um integrador numérico apropriado e um passo de tempo controlado.

A interface não deve depender exclusivamente da taxa de quadros para calcular a física.

A renderização e a simulação deverão possuir relógios independentes, com controle explícito do passo temporal.

Se a simulação ficar lenta, preserve a consistência física e informe a degradação de desempenho.

## 15.2. Painel interno do foguete

Durante a ascensão, o painel de telemetria deverá representar a perspectiva operacional do veículo.

Mostre:

- Altitude.
- Velocidade.
- Aceleração.
- Massa.
- Propelente restante.
- Pressão dinâmica.
- Temperatura estimada.
- Estado dos motores.
- Estado dos estágios.
- Orientação.
- Estado do sistema de navegação.
- Eventos da sequência de voo.

Os valores deverão vir do motor de simulação.

Não mostre astronautas como tripulantes se o veículo selecionado for uma missão robótica não tripulada.

## 15.3. Aborto em voo

Durante a ascensão, o jogador poderá solicitar um aborto quando o cenário e o modelo operacional permitirem.

O jogo deverá distinguir:

- Interrupção da sequência de lançamento.
- Desligamento dos motores.
- Separação de uma carga útil.
- Perda de controle.
- Destruição controlada do veículo.
- Falha catastrófica.

Não trate esses procedimentos como equivalentes.

Um foguete não deve simplesmente explodir de forma controlada ao pressionar qualquer botão. O resultado deve depender da fase de voo, da arquitetura do veículo e dos sistemas de segurança representados no modelo.

As consequências deverão ser explicadas no relatório final.

---

# 16. SISTEMA DE FALHAS

Implemente um sistema de falhas modular, com eventos associados a subsistemas.

Categorias possíveis:

- Falha elétrica.
- Falha de comunicação.
- Falha de sensores.
- Falha de pressurização.
- Falha de ignição.
- Anomalia de vibração.
- Falha de software.
- Desempenho insuficiente de propulsão.
- Superaquecimento.
- Falha de atitude.
- Degradação de energia.
- Perda de capacidade de transmissão.
- Falha de separação de estágios.

Cada evento deverá possuir:

- Condições de ativação.
- Probabilidade, quando aplicável.
- Gravidade.
- Subsistema afetado.
- Consequências.
- Opções de resposta.
- Critérios de recuperação.
- Efeito sobre o objetivo científico.

A probabilidade de falhas deverá ser transparente o suficiente para permitir aprendizado.

Não transforme uma missão bem projetada em fracasso arbitrário por meio de eventos aleatórios excessivos.

As probabilidades iniciais deverão ser configuráveis e documentadas como parâmetros de simulação, a menos que existam dados confiáveis para caracterizar um veículo específico.

---

# 17. AMBIENTE ESPACIAL E CONDIÇÕES ADVERSAS

O simulador deverá considerar progressivamente os seguintes fatores:

- Gravidade dos corpos celestes.
- Atmosfera terrestre.
- Variação da densidade atmosférica com a altitude.
- Arrasto atmosférico.
- Vento.
- Temperatura.
- Pressão dinâmica.
- Exposição à radiação.
- Atividade solar.
- Variação de energia solar recebida.
- Detritos espaciais.
- Cometas.
- Asteroides.
- Meteoroides.
- Riscos de impacto, quando aplicáveis.
- Ocultações de comunicação.
- Atraso de comunicação.
- Perda de energia.
- Limitações térmicas.
- Condições de observação científica.

Diferencie os conceitos de meteoroide, meteoro e meteorito.

Não inclua todos esses fenômenos como efeitos aleatórios em todas as missões.

Cada fenômeno deverá aparecer quando for pertinente ao ambiente e à fase da missão.

## 17.1. Atividade solar

Eventos solares deverão afetar a missão de acordo com um modelo explícito.

Possíveis efeitos:

- Aumento do risco de radiação.
- Interferência em sensores.
- Degradação temporária de comunicação.
- Necessidade de colocar instrumentos em modo de proteção.
- Redução da geração elétrica em cenários definidos.

Não apresente tempestades solares como eventos que sempre destroem sistemas eletrônicos.

## 17.2. Detritos e objetos menores

Objetos próximos da trajetória poderão gerar alertas ou riscos de impacto quando houver dados e condições adequadas.

Se forem utilizados campos de detritos ou encontros probabilísticos simplificados, identifique-os como modelos educacionais.

Não invente encontros com asteroides e os apresente como previsões reais.

## 17.3. Temperatura e energia

O modelo térmico deverá considerar os fatores disponíveis, como:

- Irradiação solar.
- Distância ao Sol.
- Sombreamento.
- Dissipação de calor.
- Consumo elétrico.
- Limites dos equipamentos.

Quando a fidelidade física for simplificada, documente as premissas.

---

# 18. COLETA DE CIÊNCIA E CHECKPOINTS

Após a inserção orbital ou chegada ao destino, a missão entrará na fase científica.

O jogador deverá encontrar checkpoints associados aos objetivos da missão.

Cada checkpoint poderá representar:

- Aquisição de uma imagem.
- Medição atmosférica.
- Observação de uma região.
- Coleta de dados espectrais.
- Mapeamento de superfície.
- Observação do campo gravitacional.
- Registro de parâmetros magnéticos.
- Análise de uma região de interesse.

A disponibilidade de cada ação deverá depender dos instrumentos instalados e do estado operacional da sonda.

Por exemplo, não permita que um instrumento ausente gere dados científicos válidos.

## 18.1. Pontuação científica

A pontuação deve considerar:

- Relevância do instrumento.
- Compatibilidade com o objetivo.
- Qualidade estimada dos dados.
- Cobertura da observação.
- Estado dos equipamentos.
- Disponibilidade de energia.
- Comunicação.
- Quantidade de dados recuperados.
- Restrições de tempo.
- Cumprimento dos objetivos.

Não conceda pontuação integral apenas por chegar ao destino.

O sucesso deverá representar a qualidade do resultado científico, não somente a conclusão da trajetória.

## 18.2. Relatório final

Gere um relatório detalhado com:

- Nome do jogador.
- Missão selecionada.
- Configuração final da sonda.
- Veículo utilizado.
- Orçamento previsto.
- Custo final.
- Resultado do lançamento.
- Resultado da trajetória.
- Objetivos científicos atingidos.
- Dados coletados.
- Eventos críticos.
- Falhas.
- Recursos restantes.
- Pontuação final.
- Classificação da missão.
- Explicações educacionais.
- Recomendações para uma nova tentativa.

Estados possíveis:

- Missão concluída com sucesso.
- Missão parcialmente concluída.
- Missão concluída com resultados científicos limitados.
- Missão abortada.
- Missão fracassada.

Defina critérios objetivos para cada classificação.

Permita revisar a configuração utilizada e iniciar uma nova tentativa.

---

# 19. SISTEMA DE DIFICULDADE E APRENDIZAGEM

Implemente três níveis de assistência.

### Modo iniciante

- Explicações contextuais.
- Sugestões de componentes.
- Alertas detalhados.
- Visualização dos cálculos.
- Recomendações de correção.
- Trajetórias inicialmente guiadas.

### Modo intermediário

- Menos assistência automática.
- Maior responsabilidade pelas escolhas.
- Alertas sem solução imediata.
- Planejamento orbital parcialmente manual.

### Modo avançado

- Mais parâmetros configuráveis.
- Menos recomendações.
- Exposição dos limites do modelo.
- Planejamento de manobras.
- Gestão mais rigorosa de recursos.
- Maior exigência de margens técnicas.

A dificuldade deve alterar regras de assistência e parâmetros documentados, sem modificar silenciosamente a física fundamental.

O modo iniciante não deve ocultar os princípios científicos. Ele deve explicá-los melhor.

---

# 20. FONTES CIENTÍFICAS E VALIDAÇÃO DOS DADOS

O usuário exige que dados, cálculos e componentes sejam fundamentados em informações oficiais do NTRS.

Interprete esse requisito como a obrigação de utilizar o NASA Technical Reports Server como fonte prioritária de relatórios técnicos, estudos, documentos de engenharia e publicações científicas pertinentes.

Não presuma que o NTRS contenha todos os dados operacionais atuais de todos os veículos ou que cada documento seja uma fonte oficial de todos os parâmetros necessários.

Para cada tipo de dado, procure a fonte técnica mais apropriada.

Quando necessário, utilize também documentação técnica primária de agências espaciais, publicações científicas, catálogos de parâmetros planetários e documentação oficial dos fabricantes.

Diferencie explicitamente as fontes.

## 20.1. Regras de pesquisa

Para cada parâmetro importante, registre:

- Nome.
- Valor.
- Unidade.
- Corpo ou sistema ao qual se aplica.
- Fonte.
- Título do documento.
- Instituição responsável.
- Identificador ou URL.
- Data de publicação ou revisão, quando disponível.
- Data de consulta.
- Premissas.
- Limitações.
- Nível de confiança.
- Estado de validação.

Não invente títulos, autores, números de relatório, URLs ou identificadores de publicações.

Não apresente um valor calculado pelo próprio jogo como se tivesse sido publicado pelo NTRS.

## 20.2. Catálogo de fontes

Crie um catálogo de fontes em `data/scientific-sources/` ou em uma estrutura equivalente.

Relacione os parâmetros utilizados pelo motor às fontes correspondentes.

Quando um parâmetro não possuir uma fonte adequada, identifique-o como provisório.

## 20.3. Separação entre realidade e gameplay

Classifique os parâmetros em:

- **Validado:** valor respaldado por fonte adequada.
- **Derivado:** valor calculado a partir de parâmetros documentados.
- **Aproximado:** modelo simplificado, com premissas registradas.
- **Didático:** parâmetro criado para equilibrar o jogo.
- **Pendente:** informação ainda não validada.

Essa classificação deverá ser acessível na documentação técnica e nos detalhes dos parâmetros relevantes.

A interface não precisa exibir todas as informações metodológicas ao mesmo tempo, mas deve permitir consultar as fontes.

## 20.4. Política de precisão

O jogo é um simulador educacional, não um sistema certificado para operação de missões reais.

Não alegue fidelidade de engenharia certificada.

A precisão deverá ser descrita por subsistema, indicando quais modelos são físicos, quais são aproximados e quais são utilizados apenas para gameplay.

---

# 21. DESEMPENHO DO MOTOR 3D

O jogo deverá funcionar em computadores pessoais comuns, sem exigir uma GPU profissional.

Implemente:

- Gerenciamento do ciclo de vida das cenas.
- Descarte de recursos não utilizados.
- Reutilização de materiais e geometrias quando apropriado.
- Instanciamento de objetos repetidos.
- Carregamento assíncrono de modelos.
- Indicadores de carregamento.
- Níveis de detalhe, quando necessários.
- Controle da qualidade de sombras.
- Redução de efeitos quando a taxa de quadros cair.
- Tratamento de perda e recuperação do contexto WebGL.
- Mensagem de compatibilidade quando WebGL 2 não estiver disponível.

Evite vazamentos de memória ao trocar de cenas.

Não mantenha múltiplas instâncias do motor Babylon.js ativas sem necessidade.

Não bloqueie a interface React durante cálculos extensos.

Se a simulação exigir computação pesada, avalie a execução em Web Workers ou a separação entre cálculos no frontend e backend.

A interface deverá apresentar o estado da simulação sem precisar reconstruir toda a cena a cada atualização de telemetria.

---

# 22. BACKEND, PERSISTÊNCIA E MODELOS DE DADOS

Implemente persistência para:

- Sessões de jogador.
- Campanhas.
- Missões selecionadas.
- Configuração da sonda.
- Veículo escolhido.
- Plano de missão.
- Eventos ocorridos.
- Resultados científicos.
- Relatórios.
- Histórico de tentativas.
- Versões das configurações utilizadas.

Crie modelos e relacionamentos coerentes.

A persistência deverá permitir recuperar uma campanha e continuar de uma etapa válida.

Não salve apenas o resultado final quando for necessário reconstruir o estado da missão.

Armazene a versão do catálogo, da missão e do modelo de simulação utilizado. Uma atualização futura dos componentes não deverá alterar retroativamente os resultados de uma campanha antiga.

## 22.1. API

Implemente endpoints versionados para operações como:

- Criação de sessão.
- Listagem de missões.
- Obtenção de detalhes da missão.
- Recuperação de catálogos.
- Salvamento da configuração da sonda.
- Seleção do veículo.
- Validação da missão.
- Salvamento do plano orbital.
- Registro dos eventos de voo.
- Registro de checkpoints científicos.
- Finalização da missão.
- Consulta do relatório.

Use esquemas de entrada e saída validados.

Os cálculos críticos de validação não deverão confiar exclusivamente em resultados enviados pelo navegador.

O backend deverá verificar novamente as condições necessárias antes de aceitar a aprovação de uma missão ou registrar um resultado final.

Não implemente autenticação complexa desnecessária para uma primeira versão local, mas não deixe rotas administrativas ou operações sensíveis desprotegidas em produção.

Inclua controles de acesso, validação de entrada, tratamento de erros e limites razoáveis para as requisições.

---

# 23. DEPLOY NA VERCEL

O projeto deverá ser entregue pronto para implantação na Vercel.

Antes de concluir, verifique a compatibilidade entre a estrutura da aplicação, o frontend Vite, o backend FastAPI, as funções Python da Vercel e o banco PostgreSQL gerenciado.

Não presuma que qualquer configuração de servidor Python funciona automaticamente na plataforma.

## 23.1. Frontend

Configure:

- Build de produção.
- Diretório de saída correto.
- Rotas da aplicação.
- Variáveis de ambiente públicas.
- URLs de API configuráveis.
- Carregamento dos assets 3D.
- Tratamento de rotas de SPA.

Não coloque credenciais secretas no bundle do frontend.

## 23.2. Backend

Configure uma entrada de aplicação compatível com o ambiente de funções Python da Vercel.

O backend deve ser stateless quando executado em funções serverless.

Não dependa de armazenamento local persistente.

Evite operações longas de simulação dentro de uma única requisição. Se o cálculo exceder os limites da plataforma, adapte o processamento ou utilize o frontend para a simulação em tempo real, mantendo a persistência e as validações necessárias no backend.

## 23.3. PostgreSQL e Neon

Prepare a integração com PostgreSQL e Neon.

Inclua:

- `DATABASE_URL`.
- Configuração de pool de conexões apropriada.
- Migrações.
- Tratamento de falhas de conexão.
- Estratégia de inicialização do banco.
- Instruções para configurar o banco na Vercel.
- Política de armazenamento de dados.

Não execute migrações destrutivas automaticamente em produção.

Não dependa de arquivos SQLite ou de dados armazenados no sistema de arquivos da função.

## 23.4. Docker

Forneça Dockerfiles e Docker Compose para desenvolvimento local.

O ambiente local deverá permitir iniciar o frontend, backend e PostgreSQL com instruções claras.

A configuração local deve ser compatível com a arquitetura final, mas não precisa reproduzir artificialmente a infraestrutura serverless da Vercel.

## 23.5. Entrega de implantação

Forneça:

- `.env.example`.
- `vercel.json`, se necessário.
- Configuração de build.
- Instruções de provisionamento do Neon.
- Instruções de variáveis de ambiente.
- Instruções de migração.
- Instruções de deploy.
- Checklist de verificação pós-deploy.

Não declare que o deploy foi realizado sem efetivamente executá-lo e verificar o resultado.

---

# 24. TESTES E CRITÉRIOS DE ACEITAÇÃO

A aplicação somente poderá ser considerada concluída quando os fluxos principais forem testados.

## 24.1. Testes de interface

Verifique:

- Entrada do nome.
- Seleção de missão.
- Abertura do hangar.
- Adição de componente.
- Remoção de componente.
- Atualização de custo e massa.
- Seleção de foguete.
- Planejamento.
- Briefing.
- Bloqueio de configurações inválidas.
- Procedimentos de lançamento.
- Transição para a fase científica.
- Geração do relatório.

## 24.2. Testes de física

Crie testes para:

- Conversão de unidades.
- Cálculo de massa.
- Consumo de propelente.
- Equação do foguete.
- Relação empuxo-peso.
- Capacidade de carga.
- Cálculo orbital.
- Propagação da trajetória.
- Energia.
- Validação de orçamento.
- Critérios de chegada.
- Regras de falhas.

Inclua casos de referência conhecidos e testes de consistência numérica.

## 24.3. Testes de integração

Verifique:

- Frontend e API.
- API e PostgreSQL.
- Persistência da campanha.
- Recuperação do estado.
- Migrações.
- Validação de configurações.
- Registro de eventos.
- Geração do relatório.

## 24.4. Testes de produção

Execute e corrija:

- Verificação de tipos TypeScript.
- Lint.
- Testes automatizados.
- Build de produção.
- Testes da API.
- Testes do banco.
- Verificação de variáveis de ambiente.
- Inspeção do console do navegador.
- Verificação de erros no carregamento de assets.
- Testes do fluxo principal de ponta a ponta.

Não ignore erros críticos do build ou falhas nos fluxos principais.

Se não for possível executar um teste específico, documente a limitação em vez de declarar o teste aprovado.

---

# 25. FASES DE IMPLEMENTAÇÃO

Implemente de forma incremental, mantendo a aplicação executável.

## Fase 1: Fundação

- Inspecionar o repositório.
- Definir arquitetura.
- Preparar React e TypeScript.
- Preparar Babylon.js.
- Preparar FastAPI.
- Preparar PostgreSQL.
- Configurar Docker.
- Configurar build.
- Criar o fluxo inicial do jogador.

## Fase 2: Dados e catálogo

- Ler os arquivos de orçamento e componentes.
- Estruturar os dados.
- Implementar modelos e validações.
- Criar o catálogo de missões.
- Criar o catálogo de componentes.
- Criar o catálogo de foguetes.
- Registrar fontes técnicas.

## Fase 3: Hangar de sondas

- Criar o cenário industrial.
- Criar a sonda modular.
- Criar catálogo lateral.
- Criar painel didático.
- Implementar instalação e remoção.
- Implementar braços robóticos.
- Implementar atualização de massa, custo e energia.

## Fase 4: Foguetes e planejamento

- Criar hangar de lançadores.
- Implementar seleção de veículos.
- Implementar cálculos de carga útil.
- Implementar o planejamento orbital.
- Implementar o motor de regras.
- Implementar briefing e bloqueios técnicos.

## Fase 5: Lançamento e voo

- Criar a plataforma.
- Implementar telemetria.
- Implementar contagem regressiva.
- Implementar ignição.
- Implementar ascensão.
- Implementar separação de estágios.
- Implementar falhas.
- Implementar aborto.
- Implementar inserção orbital.

## Fase 6: Ciência e conclusão

- Implementar checkpoints.
- Implementar coleta de dados.
- Implementar pontuação.
- Implementar relatório.
- Implementar histórico de tentativas.
- Implementar recuperação de campanha.

## Fase 7: Refinamento

- Melhorar modelos 3D.
- Refinar materiais.
- Refinar iluminação.
- Refinar animações.
- Otimizar desempenho.
- Corrigir acessibilidade e responsividade.
- Completar testes.
- Validar deploy.

As fases não precisam ser executadas como tarefas isoladas. Integre continuamente o que já foi desenvolvido e preserve um build funcional.

---

# 26. REGRAS DE IMPLEMENTAÇÃO

Siga estas regras durante todo o desenvolvimento:

1. Não implemente botões sem comportamento.
2. Não utilize dados aleatórios para preencher métricas que deveriam ser calculadas.
3. Não use valores fictícios como se fossem oficiais.
4. Não substitua o ambiente 3D por imagens estáticas.
5. Não simule a montagem apenas alterando uma lista textual.
6. Não permita que o modelo 3D e os dados lógicos fiquem inconsistentes.
7. Não implemente o motor físico dentro de componentes React.
8. Não misture unidades físicas.
9. Não distribua regras críticas de validação pela interface.
10. Não permita que uma missão tecnicamente reprovada seja lançada por um simples clique.
11. Não dependa de serviços pagos ou chaves externas para abrir o jogo.
12. Não inclua segredos no código.
13. Não abandone o projeto após gerar a estrutura inicial.
14. Não deixe funcionalidades essenciais apenas como TODOs.
15. Não declare sucesso sem testes.
16. Não adicione dependências desnecessárias.
17. Não reescreva componentes funcionais sem necessidade.
18. Documente aproximações físicas.
19. Mantenha os dados de catálogo separados do código.
20. Preserve a jogabilidade mesmo quando determinados serviços externos estiverem indisponíveis.

Quando uma funcionalidade for grande demais para uma implementação completa imediata, construa uma versão funcional, coerente e explicitamente limitada. Não crie uma fachada que pareça concluída, mas não execute a lógica correspondente.

---

# 27. DEFINIÇÃO DE PRONTO

A aplicação estará pronta quando um jogador conseguir executar o seguinte fluxo sem depender de intervenção manual no código:

1. Abrir a aplicação.
2. Informar seu nome.
3. Escolher uma das três missões.
4. Consultar as informações científicas da missão.
5. Montar uma sonda em 3D.
6. Adicionar e remover componentes visualmente.
7. Consultar os efeitos das escolhas sobre massa, energia e orçamento.
8. Selecionar um foguete.
9. Planejar uma trajetória.
10. Receber um briefing técnico.
11. Identificar e corrigir configurações inválidas.
12. Iniciar a sequência de lançamento.
13. Acompanhar a telemetria.
14. Vivenciar uma ascensão com efeitos visuais sincronizados à simulação.
15. Acompanhar a trajetória.
16. Executar operações científicas.
17. Coletar dados nos checkpoints.
18. Receber um relatório final.
19. Consultar o resultado e iniciar outra tentativa.
20. Recuperar a campanha quando a persistência estiver habilitada.

O produto final deve combinar engenharia, ciência, gerenciamento e experiência cinematográfica sem sacrificar a coerência das regras.

---

# 28. ENTREGA FINAL DO CLAUDE CODE

Ao concluir o trabalho:

1. Apresente um resumo da arquitetura implementada.
2. Liste as funcionalidades efetivamente concluídas.
3. Liste os testes executados e seus resultados.
4. Identifique os modelos físicos implementados e suas limitações.
5. Identifique os parâmetros científicos validados e os que ainda são provisórios.
6. Informe como iniciar o projeto localmente.
7. Informe como configurar o PostgreSQL.
8. Informe como executar as migrações.
9. Informe como executar os testes.
10. Informe como configurar e realizar o deploy na Vercel.
11. Liste as variáveis de ambiente necessárias.
12. Liste os problemas conhecidos que ainda precisam ser resolvidos.
13. Não afirme que uma tarefa está concluída se não houver evidência de sua implementação.

**Comece agora:** inspecione o repositório e os arquivos disponíveis, formule o plano de implementação e execute as etapas de desenvolvimento na ordem mais segura. Priorize um produto funcional e integrado, não uma apresentação visual que apenas aparenta ser um simulador espacial completo.