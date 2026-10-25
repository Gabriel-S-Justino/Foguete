# Estado da implementação

Última atualização: 2026-10-25 (rodada 2: trajetória real do lançamento, sonda funcional, acompanhamento até o destino, texturas) · branch `claude/launch-trajectory-probe`

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
- A visão do sistema usa escalas didáticas: no cruzeiro para Júpiter os planetas aparecem ampliados, e cada trecho (Terra–Lua, órbita lunar, heliocêntrico, sistema joviano) tem escala própria.
- As texturas da plataforma, do hangar e da sonda são procedurais (geradas no navegador), inspiradas em fotos de referência; não são fotografias.
- A pluma e a fumaça são efeitos visuais calibrados a olho a partir de fotos e vídeos de lançamentos, não uma simulação de escoamento.
- No SwiftShader (renderização por software usada nos testes) a cena de lançamento roda a cerca de 2–8 FPS; em GPU real não foi medido nesta sessão.
- Ascensão 2D sem vento, sem azimute 3D e sem dispersões de motor. Janela de Júpiter em modelo circular coplanar (ver `docs/physics-model.md`).
- Acessibilidade parcial: rótulos ARIA nos controles principais e navegação por teclado na seleção de missão, sem revisão completa.
