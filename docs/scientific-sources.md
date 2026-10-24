# Fontes científicas e classificação dos dados

Catálogo de fontes `data/scientific-sources/sources.json` (versão 2026.10.1, consultado em 2026-10-24). Nenhum valor físico é usado sem uma fonte registrada ou sem a marcação explícita de dado didático.

## Classificação

| Status | Significado |
|---|---|
| validado | Valor lido diretamente em documento oficial do fabricante/agência e conferido. |
| derivado | Calculado a partir de um valor validado/aproximado por relação física explícita. |
| aproximado | Valor público de fonte secundária (ex.: Wikipedia citando o fabricante) ou demonstração em voo que não é o limite máximo. |
| didático | Parâmetro de jogo (custos, massas e consumos de componentes, orçamentos), escolhido pela ordem de grandeza dos documentos de referência. |
| pendente | Não há valor documentado. O jogo **bloqueia** o uso (nunca deduz). |

## Fontes registradas

| id | Título | Conferida | Observação |
|---|---|---|---|
| `doc-orcamento` | Orçamentos de Missões e Foguetes Espaciais (orcamento_missoes_espaciais.md) (`reference/orcamento_missoes_espaciais.md`) | sim | Fonte obrigatória para preços de lançamento e orçamentos históricos. Valores são reportados pelo documento, não cotações garantidas. |
| `doc-componentes` | Componentes para 3 missões espaciais (componentes-sondas.md) (`reference/componentes-sondas.md`) | sim | Define categorias de componentes e arquiteturas de referência. O próprio documento declara que massas e números são ordens de grandeza; não fornece custo nem consumo por componente. |
| `ntrs-sls-2020` | [NASA's Space Launch System: New Launch Capability for Artemis Lunar and Deep Space Science Missions](https://ntrs.nasa.gov/citations/20205000062) | sim | SLS Block 1: mais de 27 t para injeção translunar (TLI). Não informa capacidade para C3 de Júpiter. |
| `soyuz-csg-manual-2012` | [Soyuz at the Guiana Space Centre — User's Manual, Issue 2 (março 2012)](https://courses.edx.org/asset-v1:DelftX+AEASM1x+1T2023+type@asset+block/Soyuz-Users-Manual-March-2012.pdf) | sim | Soyuz-2/Fregat a partir do CSG: SSO 820 km ≈ 4 400 kg; LEO 920 km/52° = 4 850 kg; GTO ≈ 3 250 kg; escape C3 0–25 km²/s² ≈ 2 400–1 000 kg (apenas gráfico). Desempenho a partir de Baikonur/Plesetsk é diferente. |
| `spacex-capabilities` | [SpaceX Capabilities & Services (valores via Wikipedia, que cita o documento)](https://en.wikipedia.org/wiki/Falcon_9) | **não** (conferência pendente) | O PDF do fabricante não pôde ser aberto neste ambiente. Falcon 9 FT expendable: LEO 22 800 kg, GTO 8 300 kg, Marte 4 020 kg. Falcon Heavy expendable: LEO 63 800 kg, GTO 26 700 kg, Marte 16 800 kg. Confirmar no documento primário. |
| `falcon-9-iridium` | [Iridium satellite constellation — Iridium NEXT (689 kg por satélite, 10 por lançamento Falcon 9, Vandenberg, 86,4°)](https://en.wikipedia.org/wiki/Iridium_satellite_constellation) | **não** (conferência pendente) | Demonstração histórica usada como limite inferior para órbita baixa quase polar. A órbita de inserção foi mais baixa que a operacional (781 km). |
| `falcon-heavy-history` | [Falcon Heavy — histórico de lançamentos (Europa Clipper, 2024-10-14, 6 065 kg, configuração totalmente descartável, trajetória com sobrevoos de Marte e Terra)](https://en.wikipedia.org/wiki/Falcon_Heavy) | **não** (conferência pendente) | Demonstração histórica usada como limite inferior de capacidade para perfil interplanetário com assistência gravitacional. Confirmar no press kit da NASA. |
| `new-glenn-secondary` | [New Glenn — ficha técnica (Next Spaceflight)](https://www.nextspaceflight.com/rockets/67/) | **não** (conferência pendente) | LEO 45 000 kg, GTO 13 000 kg, 98 m, 2 estágios, 7× BE-4. Sem dados de TLI ou C3 interplanetário. |
| `jpl-approx-positions` | [Approximate Positions of the Planets (E. M. Standish)](https://ssd.jpl.nasa.gov/planets/approx_pos.html) | **não** (conferência pendente) | Longitudes médias J2000 e taxas usadas para a janela educacional Terra–Júpiter (órbitas circulares coplanares). |
| `jpl-astro-par` | [Astrodynamic Parameters](https://ssd.jpl.nasa.gov/astro_par.html) | **não** (conferência pendente) | Parâmetros gravitacionais (GM) e raios. Valores do motor foram transcritos de conhecimento técnico corrente e devem ser conferidos nesta página. |
| `nssdc-factsheets` | [Planetary Fact Sheets](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) | **não** (conferência pendente) | Distâncias médias ao Sol, raios, períodos. Conferir. |
| `us-standard-atmosphere-1976` | [U.S. Standard Atmosphere, 1976](https://ntrs.nasa.gov/search?q=U.S.%20Standard%20Atmosphere%201976) | **não** (conferência pendente) | Modelo de camadas de 0–86 km usado (temperatura linear por camada, pressão hidrostática). Identificador NTRS exato não conferido nesta sessão; a URL aponta para a busca. |
| `iso-80000-g0` | [Aceleração padrão da gravidade g0 = 9,80665 m/s² (valor convencional, 3ª CGPM 1901)](https://www.bipm.org/en/publications/si-brochure) | **não** (conferência pendente) | Valor definido por convenção. |
| `vallado-exponential-atmosphere` | [Fundamentals of Astrodynamics and Applications — modelo de atmosfera exponencial (tabela por faixas)](https://celestrak.org/software/vallado-sw.php) | **não** (conferência pendente) | Densidades de referência acima de 86 km usadas no arrasto em órbita baixa. Conferir a tabela na edição do livro. |
| `game-design` | Parâmetro didático do Space Mission Architect (`docs/physics-model.md`) | sim | Valor criado para equilibrar o jogo. Não representa dado oficial. |

Fontes marcadas como “não conferida” foram registradas a partir de páginas secundárias ou de memória técnica e precisam de leitura do documento primário antes de serem promovidas a *validado*. A interface exibe “(conferência pendente)” ao lado delas.

## Capacidade dos lançadores por perfil

A capacidade nunca é extrapolada entre perfis (por exemplo, de órbita baixa para lunar). Perfis: `leo-polar` = Órbita baixa polar / heliossíncrona (≈600–850 km, i≈97–99°) (C3 —); `tli` = Injeção translunar (TLI, C3 ≈ −2 km²/s²) (C3 -2); `jupiter-ga` = Partida interplanetária com assistência gravitacional (C3 ≈ 10–31 km²/s²) (C3 31); `jupiter-direct` = Transferência direta Terra–Júpiter (C3 ≈ 77–85 km²/s²) (C3 80).

| Veículo | leo-polar | tli | jupiter-ga | jupiter-direct |
|---|---|---|---|---|
| Falcon 9 | 6.890 kg (aproximado) | 4.020 kg (derivado) | pendente | pendente |
| Falcon Heavy | 6.890 kg (derivado) | 16.800 kg (derivado) | 6.065 kg (aproximado) | pendente |
| Starship | pendente | pendente | pendente | pendente |
| Soyuz | 4.400 kg (validado) | 2.400 kg (aproximado) | pendente | pendente |
| New Glenn | pendente | pendente | pendente | pendente |
| SLS (Space Launch System) | pendente | 27.000 kg (validado) | pendente | pendente |

Notas por célula estão em `data/launch-vehicles/launch-vehicles.json` (campo `notes`). Preços vêm de `orcamento_missoes_espaciais.md`; quando o documento dá uma faixa, o jogo usa o valor máximo (conservador) e mostra o texto original.

## Constantes físicas

| Parâmetro | Valor | Unidade | Fonte | Status |
|---|---|---|---|---|
| g0 | 9.80665 | m/s^2 | `iso-80000-g0` | validado |
| AU | 149597870700 | m | `jpl-astro-par` | validado |
| c | 299792458 | m/s | `iso-80000-g0` | validado |
| solarConstant1AU | 1361 | W/m^2 | `nssdc-factsheets` | aproximado |
| μ Sol | 1.327124e+20 | m³/s² | `jpl-astro-par` | validado |
| raio Sol | 695700000 | m | `jpl-astro-par` | validado |
| μ Terra | 3.986004e+14 | m³/s² | `jpl-astro-par` | validado |
| raio Terra | 6378137 | m | `jpl-astro-par` | validado |
| μ Lua | 4.902800e+12 | m³/s² | `nssdc-factsheets` | validado |
| raio Lua | 1737400 | m | `nssdc-factsheets` | validado |
| μ Júpiter | 1.266865e+17 | m³/s² | `nssdc-factsheets` | validado |
| raio Júpiter | 71492000 | m | `nssdc-factsheets` | validado |

## Dados didáticos

- Orçamentos das missões (status `didático`): Observação Climática Terrestre US$ 280 mi (reserva 10%), Mapeamento Lunar para Pesquisa de Hélio-3 US$ 450 mi (reserva 15%), Sonda de Observação de Júpiter US$ 750 mi (reserva 20%).
- Conversão para reais: Taxa ilustrativa fixa (R$ 5,00 / US$) — parâmetro do jogo, NÃO é cotação atual.
- Massa, custo, consumo, taxas de dados e de enlace dos componentes: ordem de grandeza coerente com `componentes-sondas.md`, cada item cita a linha de origem (`documentRow`).
- Probabilidades de falha (`data/simulation/simulation-config.json`): parâmetros de jogo, não estatísticas de confiabilidade reais.
- Doses de radiação por ano e fatores de blindagem: valores didáticos para ilustrar a diferença entre LEO, Lua e Júpiter.

