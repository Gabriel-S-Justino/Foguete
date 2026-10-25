# Modelos 3D da NASA: fontes, uso e processamento

Atualizado em 2026-10-25 (rodada 4).

## Modelos integrados

| Modelo | Onde aparece | Arquivo no projeto | Origem |
|---|---|---|---|
| Landsat 8 (LDCM) | Hangar da sonda, botão "Nave real" da missão de órbita terrestre | `frontend/public/models/nasa/landsat8.glb` | [3D Models/Landsat 8/Landsat 8.glb](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Landsat%208) |
| Lunar Reconnaissance Orbiter (LRO) | Hangar da sonda, botão "Nave real" da missão lunar | `frontend/public/models/nasa/lro.glb` | [3D Models/Lunar Reconnaissance Orbiter (A)/Lunar Reconnaissance Orbiter (A).glb](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Lunar%20Reconnaissance%20Orbiter%20(A)) |
| Juno | Hangar da sonda ("Nave real" da missão a Júpiter) e tela inicial, onde substitui a sonda decorativa procedural | `frontend/public/models/nasa/juno.glb` | [3D Models/Juno (B)/Juno (B).glb](https://github.com/nasa/NASA-3D-Resources/tree/master/3D%20Models/Juno%20(B)) |

Os arquivos foram baixados de `raw.githubusercontent.com/nasa/NASA-3D-Resources/master/...` em 2026-10-25.

## Cena orbital (operações e planejamento)

Na cena orbital a sonda é o **modelo procedural montado pelo jogador** (os mesmos componentes do hangar, em tamanho real), acoplado ao **último estágio do lançador escolhido** (também procedural, de `rocketModel.ts`) até a separação. Nenhum modelo da NASA é usado nessa cena: Landsat 8, LRO e Juno são naves reais diferentes da sonda do jogador e apareceriam no lugar dela. A esfera amarela que marcava a sonda foi removida; quando a sonda fica pequena demais na tela, só um rótulo HTML ("Sonda") indica a posição.

## Condições de uso

- O README do repositório diz: "These assets are free and without copyright" e remete às diretrizes de uso de mídia da NASA: <https://www.nasa.gov/nasa-brand-center/images-and-media>.
- Pelas diretrizes da NASA, o material não pode sugerir endosso da NASA, e a logomarca e os emblemas da NASA têm uso restrito. O jogo não usa logomarcas da NASA; os modelos aparecem identificados como referência real, com link para a fonte.
- O repositório tem contribuições de terceiros (lista no README: Ball Aerospace, DigitalSpace Corporation, entre outros). **Não foi possível ler os metadados de cada modelo**: deste ambiente só os arquivos diretos (`raw.githubusercontent.com`) são acessíveis; a navegação pelo github.com e o site nasa3d.arc.nasa.gov estão bloqueados. Antes de uma distribuição comercial, vale conferir a página de cada modelo no repositório.

## Processamento (otimização para o navegador)

Feito com `@gltf-transform` 4.5.1, `draco3dgltf` 1.5.7 e `meshoptimizer` 0.22.0 (script em ambiente temporário, não versionado):

1. Descompactação Draco (os originais usam `KHR_draco_mesh_compression`; sem isso o Babylon precisaria baixar o decodificador de um CDN).
2. `dedup`, `flatten`, `join`, `weld`; normais e UVs removidas antes da simplificação (os modelos não têm texturas) e normais recalculadas depois.
3. Simplificação (meshoptimizer) e quantização (`KHR_mesh_quantization`, suportada nativamente pelo Babylon).

| Modelo | Original | Otimizado |
|---|---|---|
| Landsat 8 | 780 KB (Draco), ~85 mil triângulos, 33 materiais | 1,46 MB, ~30 mil triângulos |
| LRO | 655 KB (Draco), ~76 mil triângulos, 34 materiais | 1,12 MB, ~23 mil triângulos |
| Juno (B) | 262 KB (Draco), ~30 mil triângulos, 24 materiais | 0,88 MB, ~18 mil triângulos |

Os modelos são carregados sob demanda: o carregador glTF do Babylon fica num pacote separado (cerca de 220 KB) e só é baixado ao abrir o hangar ou a tela inicial. Se um arquivo falhar, a cena continua sem ele, com um aviso no console. A sonda procedural da tela inicial continua como reserva.

Ajustes visuais no carregamento: os materiais com nomes de folha metálica ou manta térmica (gold, bronze, silver, foil, thermal) recebem metalicidade 0,75 e rugosidade 0,38, para refletir o ambiente como as mantas reais. Os modelos ficam em **escala de exposição** (maior dimensão de 5 a 6,5 m no hangar) e não em escala real.

## Modelos não integrados e motivos

| Elemento do jogo | Situação |
|---|---|
| Sonda montada pelo jogador | Continua procedural: cada componente é instalado, removido, destacado e animado (painéis, antena, braços robóticos). Um modelo estático da NASA quebraria a montagem. |
| Lançadores (Falcon 9, Falcon Heavy, Starship, Soyuz, New Glenn) | Não são veículos da NASA, e o repositório não tem modelos deles. |
| SLS | Nenhum arquivo encontrado nos caminhos testados (`3D Models/SLS/…`, `Space Launch System/…`, `Space Launch System (SLS)/…` e variações). Sem listagem do repositório, não dá para afirmar que ele não existe. Mesmo que exista, precisaria ser dividido por estágio para manter a separação animada. |
| Sol, planetas e Lua | Esferas em shader próprio com texturas (`docs/texture-sources.md`). Do NASA-3D-Resources vieram as texturas de **Marte** (`Images and Textures/Mars/Mars.jpg`, sem alteração) e **Vênus** (`Images and Textures/Venus/Venus.jpg`, mapa de radar Magellan usado só como relevo sob a cor das nuvens). Terra e Lua usam imagens da NASA obtidas por outros caminhos; Mercúrio, Júpiter, Saturno, Urano, Netuno e o Sol usam a Solar System Scope (CC BY 4.0). Nenhum modelo 3D de planeta foi encontrado nos caminhos testados. |
| Terra (satélite) | O arquivo existe (2,1 MB), mas aponta para texturas externas `.tga` que não estão no `.glb`. Substituído pelo Landsat 8. |
| Galileo, Saturn V, Clementine, Pioneer 10, Dawn, Space Shuttle (A), ISS (A), Apollo Lunar Module | Encontrados e verificados, mas sem lugar coerente nas três missões atuais. Podem entrar como peças de exposição em versões futuras. |
| Juno (A) | 9 MB; usada a variante Juno (B), mais leve. |
