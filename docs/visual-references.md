# Referências visuais, dimensões e aproximações (rodada 5)

Atualizado em 2026-10-25. Este documento separa o que vem de fonte documentada, o que é aproximação visual
coerente com a fonte e o que é elemento criado para o jogo. Nada aqui altera a física da missão: as dimensões
abaixo afetam só a geometria 3D.

Acesso a partir do ambiente de desenvolvimento: as páginas da NASA, do JPL e da ESA abriram normalmente; o
`github.com` e o `nasa3d.arc.nasa.gov` estão bloqueados (só `raw.githubusercontent.com` funciona). Por isso
nenhum modelo 3D novo de terceiros foi integrado nesta rodada (ver "Recursos externos").

## Estrelas

| Item | Fonte | Uso |
|---|---|---|
| Catálogo Yale Bright Star Catalogue, 5ª ed. (BSC5): 9.110 objetos, 9.096 estrelas com posição, J2000 | Hoffleit & Warren (1991), Yale University Observatory, distribuído pelo CDS/NASA HEASARC (dados públicos); convertido para JSON por Bretton Wade (repositório `brettonw/YaleBrightStarCatalog`, licença MIT), arquivo `bsc5-short.json` obtido por `raw.githubusercontent.com` | `frontend/public/data/stars/bsc5.bin` (181.920 bytes, gerado por `frontend/scripts/build-starfield.mjs`): direção unitária equatorial J2000, magnitude V e temperatura de cor estimada pelo índice B–V |
| Número de estrelas visíveis a olho nu (~9.100 até V = 6,5) | Sky & Telescope, "How Many Stars Are There in the Night Sky?" (https://skyandtelescope.org/astronomy-resources/how-many-stars-night-sky-09172014/) | Confere a contagem do catálogo |
| Aparência em fotos do espaço | Imagens da ISS e de sondas no NASA Image and Video Library (https://images.nasa.gov/) | Estrelas são pontos; com o Sol, a Terra iluminada ou a nave no quadro a exposição curta mostra poucas ou nenhuma estrela |

Aproximações: a cor vem de uma relação B–V → temperatura → RGB com saturação reduzida (0,55); o tamanho do
ponto é uma PSF gaussiana de σ ≈ 0,62 px, que só cresce até 1,56× nas mais brilhantes; o pico de brilho é
limitado a 0,8 (abaixo do limiar do bloom, 0,9). A magnitude limite é 6,2 no espaço, 5,0 no céu da plataforma
(com a Terra e o Sol em quadro) e 5,2 na tela inicial. Sem cintilação (não há atmosfera). Na plataforma o céu é
orientado pela hora sideral de Greenwich no instante da cena e pela latitude/longitude da base.

## Sonda

| Item | Fonte | Valor usado |
|---|---|---|
| Juno: corpo hexagonal de ~3,5 m, 3 asas com 11 painéis, cofre de radiação de titânio (~1 m, paredes de 1 cm, ~200 kg), motor principal Leros-1b de 645 N, 12 propulsores em 4 módulos (REM) | JPL, Juno press kit, "Spacecraft" (https://www.jpl.nasa.gov/news/press_kits/juno/spacecraft) | REM em 4 cantos com 3 bocais cada; cofre como caixa de titânio; tubeira de proporção Rao no motor principal |
| Antena de alto ganho | Mesma fonte (HGA de 2,5 m da Juno) e fotos de integração da Cassini/Juno no NASA Image Library | Paraboloide com f/D = 0,35, borda, 8 nervuras, montagem em cone de 6 barras de titânio, subrefletor Cassegrain em tripé e corneta |
| Mantas MLI, radiadores com venezianas, rastreador estelar com para-sol | Fotos de integração (NASA Image Library) | Materiais com rugosidade 0,28–0,3 (MLI), branco de radiador fosco; não cromados |
| Tanques de propelente e pressurizante | Arquitetura típica de sondas bipropelente (tubo de empuxo central, COPV externos) | Tubo de empuxo, dois COPV com cintas, tubos de alimentação e painel de válvulas; **disposição genérica**, não de uma sonda específica |

As proporções exatas de cada componente do jogo continuam as do catálogo (`data/components`); os detalhes
acrescentados (nervuras, cintas, dobradiças, chicotes) são aproximações visuais. Detalhes de até ~10 cm
somem a mais de 80 m da câmera (LOD).

## Braços robóticos

| Item | Fonte | Uso |
|---|---|---|
| Canadarm2: 17,6 m, 7 juntas, lanças de 35 cm, 1.800 kg | Mobile Servicing System (https://en.wikipedia.org/wiki/Mobile_Servicing_System), dados da CSA/NASA | Referência de articulação (juntas com carcaça, motor e flange) |
| Robôs industriais de 6 eixos usados em integração (fotos do NASA Image Library e da "robot factory" do JPL: https://www.nasa.gov/centers-and-facilities/jpl/space-history-is-made-in-this-nasa-robot-factory/) | | Base aparafusada, J1–J6, garra paralela, mangueiras com braçadeiras, lâmpada de estado |

Os comprimentos dos segmentos (2,4 / 2,1 / 0,7 m, base a 1,5 m) são os da cinemática inversa que já existia;
não foram alterados para não mudar os alcances da montagem.

## Hangar de integração da sonda

| Item | Fonte | Uso |
|---|---|---|
| JPL Spacecraft Assembly Facility, High Bay 1: sala limpa classe 10.000, piso epóxi dissipativo, ponte rolante de 13,6 t com "guarda-chuva" branco no gancho, macacões "bunny suit", chuveiro de ar | NASA/JPL (link acima) | Sala limpa, HEPA na parede oeste, ponte rolante com guarda-chuva, antecâmara com chuveiro de ar, equipe de macacão branco com capuz, máscara e óculos |
| Foto do Amazônia-1 no INPE (fornecida pelo usuário, `reference/`) | | Dolly laranja |

Dimensões adotadas (aproximação, não planta de uma instalação real): 40 × 50 m, 18 m até o banzo inferior das
treliças, ponte rolante a 14 m, portão de 10 × 12 m, mezanino a 4,5 m, plataforma elevatória com piso a 2,4 m.

## Pessoas

| Item | Fonte | Uso |
|---|---|---|
| Estatura de referência 1,75 m | Pedido do usuário. A página do NASA-STD-3001 consultada (https://www.nasa.gov/reference/appendix-e-vol-2) não trouxe tabela legível de estatura | Alturas de 1,63 a 1,84 m (variação natural) |
| Proporções dos segmentos | Drillis & Contini (1966), frações da estatura (tronco, coxa, perna, braço, antebraço, cabeça) | `BODY` em `humans.ts` |

Os personagens são construídos na escala do mundo (1 unidade = 1 m) e um teste unitário mede a altura de cada
um no mundo. Bancadas (0,9 m), degraus da escada (0,22 m), guarda-corpos (1,1 m) e o portão (12 m) servem de
comparação nas capturas. Roupas: macacão de sala limpa no hangar da sonda; macacão de trabalho com capacete no
hangar de lançadores. Nenhum personagem usa traje extraveicular.

## Plataformas de lançamento

| Família | Fontes | Valores usados |
|---|---|---|
| Falcon 9 / Falcon Heavy (LC-39A) | LC-39A/B (https://www.globalsecurity.org/space/facility/lc-39ab.htm); LC-40 (https://en.wikipedia.org/wiki/LC-40) | Trincheira de chamas (no LC-39: 13 m de profundidade × 137 m × 18 m; aqui 14 m de largura até o nível do terreno), caixa d'água de 88,9 m, esferas de LOX, FSS treliçada de 12 m de lado com escada, elevador e guindaste de topo, braço de acesso da tripulação, transportador-eretor (strongback) que recua ~2° antes da ignição, garras de fixação |
| SLS (LC-39B) | NASA, Mobile Launcher 1 fact sheet (https://www.nasa.gov/wp-content/uploads/2021/04/final_-_mobile_launcher_1_fact_sheet.pdf) | Base de 50 × 41 × 7,6 m sobre 6 mecanismos de 6,7 m (deque a 14,3 m), abertura de exaustão de 10,4 × 19,5 m, torre de 12,2 m de lado e 105 m acima do deque, 8 postes de apoio (4 por booster), braço da tripulação e umbilicais, esferas de LOX e LH2 |
| Starship (Starbase) | Guinness World Records, torre de integração de 146 m (https://www.guinnessworldrecords.com/world-records/694843-tallest-launch-tower) | Torre de 146 m com os "chopsticks", mesa orbital anelar sobre 6 pernas com o veículo a ~20 m do chão (aproximação), 20 garras, defletor de aço no chão (sem trincheira), fazenda de tanques verticais |
| New Glenn (LC-36) | Fotos públicas da Blue Origin (não consultadas por página nesta rodada) | **Aproximação**: transportador-eretor largo com umbilicais, mesa com garras, trincheira, mastros de para-raios |
| Soyuz | ESA, "Building the Soyuz launch facility at Europe's Spaceport, part two" (https://www.esa.int/Enabling_Support/Space_Transportation/Building_the_Soyuz_launch_facility_at_Europe_s_Spaceport_part_two) | Poço de chamas sob a plataforma, veículo suspenso por 4 braços de apoio com contrapeso ("tulipa") que abrem na decolagem, dois meios-pórticos de serviço que tombam para fora, mastro de cabos |

A altura da base do foguete (deque) agora depende da família: Falcon 14 m, New Glenn 16 m, SLS 22,3 m,
Starship 20 m, Soyuz 7 m (bocais dentro do poço). Isso muda só a posição de repouso na cena; a altitude da
simulação continua sendo medida a partir do lançamento.

## Iluminação por ambiente

| Ambiente | Perfil |
|---|---|
| Hangar da sonda | Exposição 1,0; luz direcional de 2,1 quase vertical (as luminárias do teto), hemisférica 0,45, cubo de ambiente com faixas de LED; bloom só acima de 0,92 |
| Hangar de lançadores | Exposição 1,15, cubo de ambiente de hangar |
| Plataforma | Sol direcional (3,0), céu com gradiente, névoa leve que some com a altitude; estrelas só fora da atmosfera |
| Espaço | Só o Sol (2,4) na direção do Sol real; hemisférica 0,06 e ambiente 0,3 (a face na sombra fica escura, sem luz "de estúdio") |

## Recursos externos

Nenhum modelo 3D, textura ou animação de terceiros novo foi integrado nesta rodada. Motivos: deste ambiente
não é possível navegar no `github.com` nem no `nasa3d.arc.nasa.gov` para conferir a página, a licença e a
procedência de cada modelo; os modelos já integrados do NASA 3D Resources (Landsat 8, LRO, Juno) são naves
inteiras e estáticas; e a sonda, os braços e as plataformas precisam de partes móveis (montagem, juntas, braços
que recolhem, garras que abrem). Por isso estruturas, braços e personagens são procedurais, construídos a partir
das fontes acima. O único dado externo novo é o catálogo BSC5 (dados públicos; conversão JSON sob licença MIT).
