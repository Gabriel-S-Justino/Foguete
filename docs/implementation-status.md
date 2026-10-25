# Estado da implementação

Última atualização: 2026-10-25 (rodada 4: física, escala, órbita de estacionamento e vista do Sistema Solar) · branch `claude/fisica-escala-orbita`

## Funcionalidades implementadas

### Fluxo do jogo (frontend, Babylon.js)
- [x] Identificação do jogador: nome obrigatório, sem nome só com espaços, máximo de 32 caracteres, sem `< > { }`.
- [x] Seleção de missão (LEO climática, Lua He-3, Júpiter) e nível de assistência (iniciante, intermediário, avançado).
- [x] Hangar de integração 3D, com a imagem do Amazônia-1 como referência: sala limpa, dolly, suporte, ponte rolante e dois braços robóticos que montam e desmontam componentes. O modelo 3D é sincronizado com a configuração lógica.
- [x] Catálogo com busca, filtro por categoria, ordenação, relevância para a missão e opção de ocultar itens irrelevantes. Painel didático com descrição, limitações, consequência da ausência, dependências e linha de origem no documento.
- [x] Regras de montagem: barramento primeiro, limite de instâncias, remover o barramento só por último. Propelente limitado ao tanque. Campanha de testes. Arquitetura de referência sugerida no modo iniciante.
- [x] Hangar de lançadores 3D com os 6 veículos do documento de orçamento, dimensionado para o maior deles. Compatibilidade por perfil e ficha com fonte, custo e limitações.
- [x] Planejamento de trajetória por missão:
  - LEO: altitude, excentricidade, órbita heliossíncrona calculada por J2, hora local do nodo, vida útil.
  - Lua: órbita de estacionamento, tipo de transferência, altitude e inclinação lunar, correções de trajetória (TCM).
  - Júpiter: ΔV-EGA ou direta, data de partida com erro de janela e ajuste para a janela mais próxima, perijove, período, inclinação, órbitas científicas.
  - Inclui orçamento de Δv por fase e visualização orbital 3D.
- [x] Briefing com inspeção 3D e tabela de validação por grupo (financeira, massa, propulsão, subsistemas, orbital), com valor, limite, margem, explicação, ação e botão para a etapa que corrige. O lançamento fica bloqueado até a aprovação, e o servidor revalida quando está disponível.
- [x] Plataforma de lançamento (ambiente distinto do hangar): torre, braços de acesso, linhas de abastecimento, trincheira de chamas, torre d'água e para-raios.
- [x] Centro de controle:
  - Terminal verde de eventos.
  - 12 verificações de sistemas derivadas do estado.
  - Condições sorteadas (clima, sensor, pressurização, energia de solo).
  - Comandos de hold, confirmação, aborto, terminação de voo, pausa, scrub e nova janela.
  - Aceleração de tempo de 1× a 20× e cinco câmeras com zoom (roda do mouse ou botões +/−) que não é desfeito no quadro seguinte:
    - **Geral**: câmera de rastreio de longo alcance fixa no solo, com zoom óptico que acompanha a distância.
    - **Rastreio**: órbita em volta do veículo (arrastar para girar).
    - **Cinemática**: gira lentamente em volta do veículo.
    - **Externa ↓**: presa ao último estágio, olhando para baixo (motores, pluma, separação do estágio, Terra).
    - **Externa ↑**: presa ao último estágio, olhando para cima (corpo do estágio e coifa).
- [x] Ascensão física com passo fixo, separação de estágios, Max-Q, falhas (ignição, perda de motor, separação, vibração) e telemetria completa.
- [x] Animação do lançamento (revisada em 2026-10-24):
  - Inclinação suave a partir da arfagem simulada, girando em torno do centro de massa e com a mesma compressão de escala da posição (o eixo coincide com a direção do movimento na tela). Antes a inclinação "pulava" aos 200 m e girava em torno do solo.
  - Estágios separados mantêm a velocidade do veículo, recebem empurrão para trás e ficam para trás girando; a coifa abre em duas metades articuladas. Objetos soltos usam o relógio da simulação (respeitam pausa e aceleração de tempo).
  - Depois da órbita o veículo continua em voo paralelo à superfície; aborto em voo vira queda balística com explosão no impacto; terminação de voo destrói o veículo no ar com destroços. Antes o foguete congelava no céu.
  - Pluma com shader presa ao bocal (segue o eixo do motor em qualquer inclinação), cor por propelente (querosene, metano, hidrogênio com discos de Mach, sólido), expansão no vácuo, chamas locais, rastro de fumaça só em atmosfera densa, nuvem de vapor na plataforma, luz da exaustão.
  - Céu escurece com a altitude da câmera, estrelas aparecem acima da atmosfera e o terreno dá lugar à Terra texturizada abaixo, orientada para o Cabo Canaveral.
- [x] Planetas com texturas reais (Terra com dia, luzes noturnas, nuvens, reflexo nos oceanos e atmosfera; Lua com relevo; Júpiter), em shader próprio sem costura no antimeridiano. Fontes e licenças em `docs/texture-sources.md`.
- [x] Manobras da sonda pela equação de Tsiolkovsky com a massa real. A captura pode ser completa, em órbita alta ou falhar e virar sobrevoo. A dispersão aumenta sem TCM ou com sensor degradado.
- [x] Anomalias de cruzeiro e de ciência com respostas do jogador e efeitos persistentes.
- [x] Checkpoints científicos com fatores explicados: instrumento, latitude, altitude, apontamento, iluminação, saúde, energia, enlace e tempo.
- [x] Relatório final com classificação objetiva, objetivos, dados, custo em USD e BRL (didático), eventos críticos, lições e recomendações. Inclui histórico de tentativas e nova tentativa.
- [x] Persistência local (`localStorage`), sincronização best-effort com a API e retomada após recarregar.
- [x] Robustez gráfica: um único Engine, descarte de cenas, aviso sem WebGL 2, recuperação de perda de contexto e redução automática de qualidade.

### Rodada 2 (2026-10-25)
- [x] **Lançamento em escala real.** A cena usa a Terra com raio real (6.371 km) e origem flutuante (o cenário é reposicionado a cada 2 km, sem tremor de precisão). O foguete sobe pela posição e arfagem calculadas pela simulação, a curva de gravidade fica visível e a inclinação acompanha o horizonte local até a órbita. Antes a cena comprimia a altitude e o foguete "subia reto".
- [x] **Bug do foguete indo para o lado na decolagem corrigido.** No solo a posição horizontal era a distância percorrida pelo referencial inercial (rotação da Terra); agora usa o alcance relativo à superfície. O teste E2E confere menos de 60 m de deslocamento lateral e menos de 5° de inclinação na decolagem.
- [x] **Guiagem da subida revisada.** Taxa de arfagem limitada a 2,5°/s, primeiro estágio limitado a 35° acima de 60 km, tempo restante pela equação do foguete no último estágio, e para órbitas acima de 300 km: SECO-1, voo balístico até a apoapse e reignição para circularizar (como nas missões reais do Falcon 9). Falcon 9 a 700 km SSO: 676 × 705 km.
- [x] **Câmera de rastreio automática.** Acima de 250 m a câmera passa para o rastreio (a não ser que o jogador tenha escolhido outra), com o "para cima" na vertical local: o horizonte fica nivelado e a inclinação do foguete aparece em relação a ele até a órbita.
- [x] **Fumaça inclinada e rastro da trajetória.** A fumaça junto ao bocal segue o eixo do motor; um rastro de partículas no espaço do mundo fica ao longo da trajetória, denso até 15 km, afinando até 45 km, e não é emitido acima disso.
- [x] **Painéis solares recolhidos.** Os painéis são dobrados em sanfona e a antena do magnetômetro é telescópica: a sonda recolhida cabe na coifa (teste unitário com as três sondas de referência). Em órbita aparece o botão **Estender painéis solares**, na tela de lançamento e nas operações; a abertura é animada (8 s) e a câmera enquadra a sonda.
- [x] **Componentes funcionais.** Com painéis solares e sem RTG, a sonda não tem energia para manobras nem ciência enquanto os painéis estão dobrados (a interface explica e bloqueia).
- [x] **Visão do sistema acompanha a sonda até o destino.** A missão é dividida em trechos: Terra → Lua (transferência e chegada à órbita lunar, em escala própria centrada na Lua) e Terra → Júpiter (cruzeiro heliocêntrico com o Sol no centro, depois aproximação e captura em Júpiter). A sonda percorre a trajetória de forma contínua e a câmera a segue; entre trechos a câmera aproxima, a cena troca de escala e afasta. Há a vista "Sonda" (modelo 3D de perto). Antes a sonda era teleportada.
- [x] **Texturas realistas (procedurais).** Concreto com agregado e juntas, asfalto, grade de piso, aço galvanizado, aço escovado, tinta com desgaste, manta térmica MLI amassada, células solares de GaAs, piso epóxi, fibra de carbono, laranja industrial nos braços robóticos, painéis de parede do hangar; terreno com vegetação e oceano; reflexos de ambiente (hangar, exterior, espaço) em todos os materiais PBR.
- [x] **Sistema solar sem brilho estourado.** Brilho de Terra, Lua, Júpiter e atmosfera reduzidos, bloom só acima de 97% de luminância, exposição revista e iluminação vinda do Sol no cruzeiro.
- [x] **Cena que não terminava de carregar (Falcon Heavy/Júpiter) corrigida.** Materiais clonados duplicavam texturas procedurais vazias, que nunca ficavam prontas; agora os clones compartilham as texturas, e a troca de cena tem um limite de 20 s.

### Rodada 3 (2026-10-25)
- [x] **Bugs relatados após o merge da rodada 2 (decolagem para a lateral e painéis fora da coifa).** A Vercel publicou o commit da rodada 2 às 04:57 UTC (status do GitHub). O site não é acessível deste ambiente. Na versão atual, a posição do foguete foi registrada quadro a quadro: x = 0,0 m até 340 m de altitude, e depois a inclinação começa. Os painéis aparecem dentro da coifa nas câmeras da plataforma. Não reproduzido; pedido print ao Kali.
- [x] **Encaixe da sonda na coifa de qualquer lançador.** O teste anterior supunha a coifa do Falcon 9 e escala 0,9; o novo teste monta o foguete real com a sonda no suporte de carga e mede contra as malhas da coifa. Ele encontrou propulsores e o para-sol do imageador encostando na parede (até 0,6 m na Soyuz). Agora `fitPayload` reduz a escala da sonda só o necessário para deixar 20 cm de folga. Testado: 3 missões × 5 lançadores com coifa.
- [x] **Tela inicial sem 3D corrigida.** O efeito da tela pedia a cena antes de o App criar o Engine e o pedido era descartado; agora fica na fila até o canvas existir.
- [x] **Modelos 3D da NASA (NASA 3D Resources).** Landsat 8, Lunar Reconnaissance Orbiter e Juno, otimizados (sem Draco, simplificados e quantizados, 0,9 a 1,5 MB cada), carregados sob demanda:
  - Hangar da sonda: botão **Nave real** mostra a nave real equivalente à missão num expositor, com texto e link da fonte.
  - Tela inicial: a Juno da NASA substitui a sonda decorativa procedural.
  - A sonda montável e os lançadores continuam procedurais (montagem, animações e separação de estágios). Detalhes, licença e modelos não usados em `docs/model-sources.md`.

### Rodada 4 (2026-10-25)
Cada item abaixo teve a causa encontrada antes da correção. Detalhes da física em `docs/physics-model.md`.

- [x] **Cintilação das texturas na subida.** Causa: a Terra em tamanho real (milhares de km) e o terreno/plataforma (detalhes de cm) dividiam o mesmo buffer de profundidade, e o observador de malhas novas do Babylon (assíncrono) devolvia a Terra e o céu ao grupo local logo depois de montados. Agora cada escala tem um grupo de renderização com profundidade própria e as reservas de grupo são respeitadas (`renderGroups.ts`). O E2E de câmeras confere a Terra no grupo 1.
- [x] **Atitude da sonda em órbita.** A atitude visual é um modo por trecho (prógrado, retrógrado, nadir, Sol), montado como uma base ortonormal a partir do estado, e não mais a direção da velocidade. Na órbita de estacionamento o conjunto estágio + sonda fica prógrado; esperando a LOI/JOI fica retrógrado; no cruzeiro os painéis apontam para o Sol.
- [x] **Separação de estágios contínua.** A peça solta parte do estado exato do veículo, com a velocidade relativa do mecanismo, e segue com gravidade, referencial girante e arrasto. Nesta rodada o integrador passou de Euler semi-implícito para leapfrog: o anterior fazia a altitude de uma peça em órbita oscilar cerca de 2 km. Nas operações o estágio superior acompanha a sonda até a separação e depois se afasta a 0,5 m/s. Há 7 testes unitários novos e uma verificação no E2E de câmeras.
- [x] **Escala física com dados da NASA.** Raios, μ e elementos orbitais vêm de `data/scientific-sources/solar-system.json` (NASA Fact Sheets e JPL). A sonda guarda a distância ao centro do corpo, e a altitude é calculada a partir dela; a interface mostra as duas. A trajetória (cônicas ajustadas com alvo no plano B) leva a sonda ao periselênio e ao perijove planejados, sem atravessar a Lua, a Terra ou Júpiter.
- [x] **Esfera amarela removida.** A cena mostra só o modelo 3D da sonda, em tamanho real, acoplado ao último estágio do lançador até a separação. Quando a sonda fica pequena demais na tela, um rótulo HTML ("Sonda") indica a posição; ele some atrás de planetas. O E2E confere que não há malhas marcadoras.
- [x] **Volta completa na órbita da Terra.** O relógio da missão começa na inserção real da subida. A volta é contada pelo ângulo percorrido (360°), não por cronômetro. O painel mostra a fase e o progresso, e a injeção de partida só pode ser comandada depois da volta. O estágio superior queima na próxima passagem pelo ponto de queima calculado. Na missão LEO a volta libera o ajuste de órbita e a ciência. Uma missão real com injeção direta não passaria por essa fase (ver `docs/physics-model.md`).
- [x] **Vista do Sistema Solar.** Inclui o Sol, os 8 planetas com texturas (Saturno com anéis), a Lua, as órbitas em cinza e a trajetória colorida por fase. Os focos são Sistema Solar, Trajetória, Destino e Sonda, com enquadramento automático, transição suave e limite de zoom fora dos corpos. Ao trocar de trecho (ex.: estacionamento → TLI), a vista Trajetória se reenquadra. Os modos são **Escala física** (padrão) e **Visualização didática**, que amplia os corpos e mostra o fator de cada um no rótulo e no painel. O modo de escala não altera a simulação, e o E2E confere isso. O relógio tem aceleração de 1× a 100.000× e um modo automático que para em cada manobra.
- [x] **Manobras no instante calculado.** O relógio para no instante de cada manobra da trajetória, e só então o botão é liberado, mostrando o Δv calculado. A ordem segue a trajetória: no ΔV-EGA a DSM vem antes da TCM. Antes, a ordem da tabela travava a missão.
- [x] **Texturas e modelos.** Marte e Vênus usam texturas do NASA-3D-Resources, e Mercúrio, Saturno (com anéis), Urano, Netuno e o Sol usam a Solar System Scope (CC BY 4.0). A cena orbital não usa modelos da NASA, porque a sonda é a do jogador. Detalhes em `docs/model-sources.md` e `docs/texture-sources.md`.

### Backend (FastAPI)
- [x] Rotas versionadas em `/api/v1`: health, sessões, campanhas com revisão, validação, eventos, finalização e relatórios.
- [x] Sessão por token. Só o hash SHA-256 fica no banco, e cada sessão vê apenas as próprias campanhas.
- [x] Regras críticas espelhadas em Python (`app/rules.py`): orçamento com reserva única, capacidade documentada (perfil pendente bloqueia), limite estrutural, tanque, Δv disponível, requisitos e dependências.
- [x] A finalização recalcula as regras e o custo. Uma configuração reprovada que alega ter voado é registrada como "fracassada".
- [x] SQLAlchemy 2, migração Alembic `0001`, pool configurável, normalização de URL do Neon (`postgres://` para psycopg 3) e `pool_pre_ping`.

### Infraestrutura
- [x] `docker-compose.yml` (PostgreSQL 16, API e frontend), Dockerfiles, `.env.example`.
- [x] `vercel.json` (frontend estático e função Python `api/index.py`), `requirements.txt` na raiz para a função.

## Testes executados

### 2026-10-25, rodada 4 (contêiner de desenvolvimento)

| Suíte | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | sem erros |
| Lint | `npm run lint` | sem erros |
| Unitários | `npm test` (Vitest) | **108/108**. Novos: 21 de trajetória (inclui inserção em velocidade de escape) (Kepler/Lambert, efemérides contra a NASA, atitude, volta completa, partida só depois da volta e do comando, Lua, Júpiter direta e ΔV-EGA, continuidade nos remendos) e 7 de separação (estado inicial exato, sem salto por quadro, gravidade, arrasto, órbita estável, queda suborbital) |
| Build de produção | `npm run build` | ok |
| Backend, SQLite | `pytest` | **39/39** (backend não mudou) |
| E2E Lua, sem backend | `E2E_MISSION=lunar-he3 npm run test:e2e` | ok: sem malha marcadora, vista da sonda a 22 m com o estágio acoplado, volta completa em 88 min (360°), partida bloqueada antes, TLI, separação, painéis, escalas, TCM e LOI no instante calculado (LOI com atitude retrógrada, 50 km sobre a Lua), **sucesso** (ciência 95) |
| E2E Júpiter, sem backend | `E2E_MISSION=jupiter-system npm run test:e2e` | ok: Falcon Heavy, volta completa, partida, DSM (347 dias), TCM (809 dias) e JOI (2.048 dias, 4.200 km, retrógrada), **sucesso** (ciência 88) |
| E2E LEO, sem backend | `npm run test:e2e` | ok: volta completa antes do ajuste de órbita, órbita de ~700 km, **sucesso** (ciência 100) |
| E2E de câmeras, Falcon 9 | `npm run test:e2e:cameras` | ok: Terra no grupo de renderização 1; peça do primeiro estágio a 12 m do veículo na separação, afastando-se de forma contínua (13 → 17 m) a 3,1 km/s |

Os E2E rodam no SwiftShader (1–5 FPS). O E2E de câmeras com Falcon Heavy e os E2E com API + PostgreSQL não foram repetidos (o backend não mudou). Não houve teste em GPU real nem no site publicado.

### 2026-10-25, rodada 3 (contêiner de desenvolvimento)

| Suíte | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | sem erros |
| Lint | `npm run lint` | sem erros |
| Unitários | `npm test` (Vitest) | **80/80** (novo: sonda recolhida dentro da coifa real em 15 combinações missão × lançador) |
| Build de produção | `npm run build` | ok; pacote principal 473 KB (152 KB gzip), carregador glTF em pacote separado de 220 KB (50 KB gzip) |
| Backend, SQLite | `pytest` | **39/39** (backend não mudou) |
| E2E LEO, sem backend | `npm run test:e2e` | ok, **sucesso** (ciência 100) |
| E2E Júpiter, sem backend | `E2E_MISSION=jupiter-system npm run test:e2e` | ok, Falcon Heavy, painéis abertos até 100%, **sucesso** (ciência 88) |
| E2E de câmeras, Falcon 9 | `npm run test:e2e:cameras` | ok, decolagem vertical, inclinação crescente, fumaça, órbita |
| Modelos da NASA | script Playwright temporário | os três modelos carregam no hangar (Landsat 8, LRO, Juno), sem erros no console; capturas conferidas; tela inicial mostra a Terra e a Juno |
| Decolagem quadro a quadro | script Playwright temporário | x = 0,0 m até 340 m de altitude; inclinação começa depois |

O E2E da missão lunar não foi repetido nesta rodada (a missão lunar usa o Falcon 9, coberto pelo E2E LEO e pelo de câmeras). Impacto no desempenho: os modelos só existem no hangar e na tela inicial (18 a 30 mil triângulos cada); no SwiftShader o hangar rodou a 1–2 FPS com o modelo exposto (sem medição comparável de antes). Em GPU real não foi medido.

### 2026-10-25, rodada 2 (contêiner de desenvolvimento)

| Suíte | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | sem erros |
| Lint | `npm run lint` | sem erros |
| Unitários | `npm test` (Vitest) | **68/68** (novos: inserção em órbitas altas com SECO-1/reignição, alcance relativo à superfície, azimute de lançamento, bloqueio por energia, sonda recolhida dentro da coifa) |
| Build de produção | `npm run build` | ok |
| Backend, SQLite | `pytest` | **39/39** (backend não mudou) |
| E2E LEO, sem backend | `npm run test:e2e` | ok: órbita 676 × 705 km, painéis estendidos na tela de lançamento, **sucesso** (ciência 100) |
| E2E Lua, sem backend | `E2E_MISSION=lunar-he3 npm run test:e2e` | ok: manobras bloqueadas com painéis dobrados, abertura animada até 100%, sonda percorre a transferência e a chegada à Lua sem salto, **sucesso** (ciência 95) |
| E2E Júpiter, sem backend | `E2E_MISSION=jupiter-system npm run test:e2e` | ok: Falcon Heavy, mesmas verificações de painéis, cruzeiro heliocêntrico e captura sem salto, **sucesso** (ciência 88) |
| E2E de câmeras, Falcon 9 | `npm run test:e2e:cameras` | ok: decolagem sem deslocamento lateral, inclinação crescente na subida (24° → 66°), rastro de fumaça presente (> 30 partículas, até ~3.300), em órbita a inclinação acompanha o horizonte local e a câmera segue o veículo |

Os E2E com API + PostgreSQL não foram repetidos nesta rodada (o backend não mudou). O E2E de câmeras com Falcon Heavy não foi repetido; o Falcon Heavy foi coberto pelo E2E da missão Júpiter.

### 2026-10-24, revisão de animações, texturas e câmeras (contêiner de desenvolvimento)

| Suíte | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | sem erros |
| Lint | `npm run lint` | sem erros |
| Unitários | `npm test` (Vitest) | **54/54** (inclui 3 novos de orientação da textura da Terra) |
| Build de produção | `npm run build` | ok |
| Backend, SQLite | `pytest` | **39/39** (backend não mudou) |
| E2E LEO, sem backend | `npm run test:e2e` | ok, órbita, classificação **sucesso** (ciência 100) |
| E2E Júpiter, sem backend | `E2E_MISSION=jupiter-system npm run test:e2e` | ok, **sucesso** (ciência 88) |
| E2E de câmeras, Falcon 9 | `npm run test:e2e:cameras` | ok: as 5 câmeras têm posições distintas, o zoom persiste (botões e roda do mouse), a câmera externa acompanha a subida, órbita atingida; capturas em `frontend/e2e/artifacts/cameras-*.png` |
| E2E de câmeras, Falcon Heavy | `E2E_MISSION=jupiter-system npm run test:e2e:cameras` | ok, mesmas verificações |
| Aborto e terminação de voo | script temporário (não versionado) | conferidos por captura: queda balística após corte de motores; explosão com destroços na terminação |

Os E2E com API + PostgreSQL não foram repetidos nesta revisão (o backend não mudou). As texturas foram conferidas visualmente na tela inicial, na visualização orbital e numa página de teste com os três planetas.

### 2026-10-24, versão inicial

| Suíte | Comando | Resultado |
|---|---|---|
| Typecheck | `npm run typecheck` | sem erros |
| Lint | `npm run lint` | sem erros |
| Unitários do motor | `npm test` (Vitest) | **51/51** (física, ascensão dos 6 veículos, regras, vetores compartilhados) |
| Build de produção | `npm run build` | ok |
| Backend, SQLite | `pytest` | **39/39** |
| Backend, PostgreSQL 16 real | `TEST_DATABASE_URL=… pytest` | **39/39** |
| Migrações | `alembic upgrade head`, `alembic check`, `downgrade base`, `upgrade head` | ok, sem divergência entre modelos e migração |
| E2E LEO, sem backend | `npm run test:e2e` | ok, órbita atingida, classificação **sucesso** (ciência 100) |
| E2E Lua, com API + PostgreSQL | `E2E_MISSION=lunar-he3 E2E_EXPECT_BACKEND=1` | ok, revalidação do servidor confirmada, **sucesso** (ciência 95), relatório gravado no banco |
| E2E Júpiter, com API + PostgreSQL | `E2E_MISSION=jupiter-system E2E_EXPECT_BACKEND=1` | ok, janela ajustada, **sucesso** (ciência 88) |

O E2E roda no Chromium com renderização por software (SwiftShader), a cerca de 5–15 FPS. A redução automática de qualidade foi acionada, como esperado.

## Não executado / pendências

- Deploy na Vercel com Neon feito pelo Kali e confirmado funcionando (2026-10-24). Esta sessão não tem acesso à Vercel, então cada rodada só vai para produção depois do merge e do novo deploy automático. Ver `docs/deployment.md`.
- **Docker Compose não foi testado**, porque o daemon Docker não está disponível no contêiner. Os mesmos serviços foram validados manualmente: PostgreSQL 16 local, `alembic upgrade head`, uvicorn e Vite.
- Fontes marcadas como "conferência pendente" em `docs/scientific-sources.md` precisam de leitura do documento primário: capacidades Falcon 9/Heavy via Wikipedia, New Glenn, constantes do JPL e US76.
- Capacidades **pendentes** (bloqueiam o uso): Starship e New Glenn em todos os perfis; Falcon 9 e Soyuz para Júpiter; SLS em LEO polar e Júpiter; Falcon Heavy na trajetória direta para Júpiter.
- O Δv **necessário** é calculado só no cliente (modelo orbital completo). O servidor usa esse valor informado pelo cliente.
- O bundle do Babylon.js tem cerca de 5 MB (1,1 MB gzip), porque é importado pelo pacote raiz `@babylonjs/core`. Imports profundos reduziriam o tamanho.
- Sem testes de componentes React isolados; a interface é coberta pelo E2E.
- A Lua segue uma órbita circular desenhada para a janela (não a efeméride real); as TCMs são orçamento de Δv (a trajetória desenhada já é a corrigida); sem precessão J2 na órbita de estacionamento.
- O Δv calculado pela trajetória aparece ao lado de cada manobra, mas o jogo cobra o valor do orçamento do planejamento (ex.: JOI 654 m/s calculado × 544 m/s orçado na data padrão, porque o orçamento usa Hohmann).
- A DSM calculada no ΔV-EGA (~0,9 km/s na data padrão) é maior que o orçamento de 750 m/s do perfil; o jogo continua cobrando o valor do orçamento.
- As texturas da plataforma, do hangar e da sonda são procedurais (geradas no navegador), inspiradas em fotos de referência; não são fotografias.
- A pluma e a fumaça são efeitos visuais calibrados a olho a partir de fotos e vídeos de lançamentos, não uma simulação de escoamento.
- No SwiftShader (renderização por software usada nos testes) a cena de lançamento roda a cerca de 2–8 FPS; em GPU real não foi medido nesta sessão.
- Ascensão 2D sem vento, sem azimute 3D e sem dispersões de motor. O orçamento de Δv do planejamento usa fórmulas analíticas; a trajetória desenhada usa efemérides aproximadas do JPL (ver `docs/physics-model.md`).
- Acessibilidade parcial: rótulos ARIA nos controles principais e navegação por teclado na seleção de missão, sem revisão completa.
