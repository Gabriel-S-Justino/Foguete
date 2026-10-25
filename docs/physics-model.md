# Modelos físicos e limites

Todas as grandezas internas estão em SI (m, kg, s, N, J, W). Conversões para km, t, dias ou graus só acontecem na interface. Os modelos são **educacionais**: corretos na física de base, mas simplificados. Cada simplificação está listada abaixo e, quando relevante, aparece no jogo.

## Propulsão — `frontend/src/engine/propulsion/rocket.ts`

- **Tsiolkovsky**: Δv = Isp · g₀ · ln(m₀/m_f), com g₀ = 9,80665 m/s² (valor convencional). O Δv da sonda usa a massa seca real (soma dos componentes instalados) e o propelente carregado, limitado à capacidade dos tanques.
- **Propelente para um Δv**: m_p = m₀ (1 − e^(−Δv/(Isp·g₀))). Cada manobra consome propelente com a massa do momento, então manobras posteriores ficam mais baratas.
- **Tempo de queima** com empuxo constante e verificação de perdas gravitacionais na captura (queima longa comparada ao período no periapse gera aviso).
- **Empuxo × pressão**: interpolação linear entre empuxo ao nível do mar e no vácuo pela pressão ambiente.
- O Δv do lançador **nunca** é somado ao da sonda. O lançador entrega a sonda no perfil (órbita baixa, TLI ou C3); a aprovação usa a capacidade **documentada** para esse perfil.

## Atmosfera — `engine/atmosphere/us76.ts`

- 0–86 km: U.S. Standard Atmosphere 1976 por camadas (gradiente térmico linear ou isotérmico), altitude geopotencial.
- Acima de 86 km: densidade exponencial por faixas (tabela de Vallado). É usada para o arrasto residual em LEO e para o Δv de compensação de arrasto.
- Limite: não modela atividade solar variável (F10.7). A densidade real em 500–800 km pode variar uma ordem de grandeza ao longo do ciclo solar.

## Ascensão — `engine/physics/ascent.ts`

- Simulação 2D no plano orbital, referencial inercial centrado na Terra, integração **RK4 com passo fixo** (`ascentTimeStepS` em `simulation-config.json`), independente da taxa de quadros. Com aceleração de tempo, o controlador executa vários passos por quadro; se não couber no orçamento de tempo do quadro, a física é preservada e a interface informa a degradação.
- Forças: gravidade central, empuxo dependente da pressão, arrasto (C_d configurável, área pelo diâmetro do veículo, densidade US76, velocidade relativa ao ar com rotação da Terra).
- Massa variável por estágio; estágios paralelos (boosters) separam antes do núcleo; coifa descartada acima da atmosfera densa.
- Atitude: programa de arfagem no primeiro estágio (giro gravitacional) e guiamento em malha fechada no estágio superior com comando de aceleração radial `a_r = 6Δr/T² − 4v_r/T` (forma linear de guiamento por tempo-para-ir).
- Pressão dinâmica, Max-Q, temperatura de estagnação (T_ar + v²/2c_p), aceleração em g.
- Corte quando o periapse fica acima de max(150 km, alvo − 30 km). A partir daí a inserção final, a injeção translunar ou o C3 interplanetário são tratados **analiticamente** a partir da capacidade documentada do veículo.
- Massas, Isp e empuxos de estágios são aproximações públicas usadas **apenas** para a animação física da subida; não decidem aprovação.

## Mecânica orbital — `engine/orbital-mechanics/orbits.ts`

- Vis-viva, período, velocidade circular, elementos keplerianos a partir do estado.
- **Hohmann** entre órbitas circulares coplanares.
- **Órbita heliossíncrona**: inclinação que iguala a precessão nodal por J₂ à taxa média de translação da Terra; a interface recalcula ao mudar a altitude.
- **Eclipse**: fração da órbita na sombra cilíndrica da Terra em função do ângulo β; β aproximado a partir do horário local do nodo.
- **Lua**: cônicas ajustadas (patched conics) da órbita de estacionamento até a esfera de influência lunar, v∞ na chegada e Δv de inserção (LOI) para órbita circular.
- **Júpiter**: Hohmann heliocêntrica Terra→Júpiter, v∞ de chegada, Δv de captura no perijove para o período escolhido (efeito Oberth incluído). A **janela** usa longitudes médias J2000 do JPL (órbitas circulares e coplanares) para medir o erro de fase da data escolhida; a opção ΔV-EGA acrescenta o laço de ~2 anos e uma DSM.
- **Desorbitação** no fim da vida (LEO): queima retrógrada para perigeu de 50 km.
- **Integrador n-corpos RK4** (`engine/physics/integrator.ts`): testado (conservação de energia em 10 órbitas), disponível para propagação, mas as fases de cruzeiro do jogo usam as soluções analíticas acima.

## Trajetória da missão (rodada 4) — `engine/orbital-mechanics/missionTrajectory.ts`

Uma única linha do tempo física alimenta o planejamento, as operações e a cena orbital. Ela é uma sequência de trechos keplerianos (`Segment`), cada um com corpo central, instante inicial e estado inicial. A posição em qualquer instante vem de propagação kepleriana em variável universal (`kepler.ts`), não de interpolação na tela.

- **Constantes**: μ e raio médio de Terra, Lua, Sol e Júpiter, e esferas de influência (Laplace). Fontes em `data/scientific-sources/solar-system.json` (NASA Planetary Fact Sheets e JPL).
- **Efemérides**: elementos keplerianos aproximados do JPL (Standish, válidos de 1800 a 2050) para os 8 planetas; a Lua segue uma órbita circular média (raio 384.400 km), desenhada para a janela de lançamento.
- **Altitude × distância ao centro**: toda posição é guardada como distância ao **centro** do corpo; a altitude é `|r| − R`. A interface mostra as duas. Testes: na chegada à Lua e a Júpiter a sonda não desce abaixo da altitude planejada (50 km e 4.200 km) e o sobrevoo da Terra fica acima de 300 km.
- **Órbita de estacionamento**: parte do estado real do fim da subida (`OrbitInsertion`: altitude, velocidade, ângulo de trajetória, inclinação, alcance). O nodo ascendente é escolhido pela hora local (SSO), para conter o v∞ de partida (Júpiter) ou zero.
- **Volta completa antes da partida**: a volta é contada pelo **ângulo percorrido** em torno da Terra (`sweptAngle`, em passos de no máximo 1/36 do período), não por cronômetro. A queima de partida só é calculada depois de 360° **e** do comando do jogador; o estágio superior queima na próxima passagem pelo ponto de queima. Missões que ficam em órbita terrestre (LEO climática) também precisam da volta para liberar a ciência, mas não têm queima de partida. Missões reais que não passam por órbita de estacionamento (injeção direta, ex.: algumas sondas lançadas pelo Atlas V ou pelo SLS) saem da subida já na hipérbole; aqui todas as missões usam estacionamento, como no Falcon 9/Heavy.
- **Lua**: a TLI é dimensionada para um apogeu `max(fator, 1,08) × d_Lua` e o instante de partida é resolvido para que a sonda encontre a Lua; dentro da esfera de influência a trajetória é uma hipérbole selenocêntrica calculada por **alvo no plano B** (`hyperbolaFromAsymptote`, `normalForInclination`) com periselênio e inclinação escolhidos. A entrada na esfera de influência usa uma iteração de Lambert de ponto fixo (40 iterações) para que posição e velocidade sejam contínuas no remendo (erro < 2 mm).
- **Júpiter**: a hipérbole de partida pode ser não coplanar (o plano gira em torno do ponto de queima); o v∞ de partida é refinado por Newton 3×3 para zerar a TCM na trajetória direta. Na ΔV-EGA a busca percorre direção do v∞, data do sobrevoo da Terra e fração da DSM; o sobrevoo da Terra é uma hipérbole real (altitude mínima verificada). Lambert com bissecção até precisão de máquina (necessária em arcos de vários anos).
- **Resultado da chegada**: captura, órbita alta ou sobrevoo (sem captura) mudam o último trecho da trajetória.

## Atitude — `engine/orbital-mechanics/attitude.ts`

A atitude visual é **independente da velocidade**: cada trecho declara um modo, e a cena monta a base de atitude (tríade ortonormal) a partir do estado. Modos: `prograde` (eixo +Y na velocidade, nadir como segunda referência), `retrograde` (eixo −v, para queimas de captura), `nadir`, `sun` (painéis voltados ao Sol no cruzeiro). Em órbita de estacionamento o conjunto estágio superior + sonda fica prógrado; em espera para LOI/JOI fica retrógrado. A troca de modo é suavizada (slerp). Testes conferem ortonormalidade e o alinhamento prógrado/retrógrado dentro de 1e-5°.

## Separação de estágios — `engine/physics/debris.ts`

Uma peça solta começa **exatamente** no estado do veículo no instante da separação (posição e velocidade), mais a velocidade relativa do mecanismo (0,5 a alguns m/s). A partir daí é um corpo independente: gravidade central, referencial girante da plataforma (Coriolis e centrífuga) e arrasto quadrático com a densidade US76 da altitude. Integração leapfrog (kick-drift-kick) em subpassos de até 0,5 s; uma peça em velocidade orbital mantém a altitude dentro de 50 m em 10 minutos (o Euler semi-implícito anterior oscilava ~2 km). Nas operações, o estágio superior se afasta da sonda a 0,5 m/s depois da separação.

## Escalas de visualização — `engine/scenes/orbitScene.ts`

- **Escala física** (padrão): raios e distâncias reais. Corpos pequenos demais para aparecer recebem só um rótulo HTML na tela (não há malha marcadora).
- **Visualização didática**: cada corpo é ampliado até um tamanho angular mínimo de 0,0045 rad (limites: ×3000; Sol ×60; Lua ×30). O fator aparece no rótulo de cada corpo e no painel. **Distâncias e trajetória não mudam**, e a simulação não lê o modo de escala.
- **Profundidade**: as coordenadas da cena são as físicas (Y↔Z) com origem flutuante no foco. Há grupos de renderização com projeção própria: estrelas; corpos distantes (near = 0,1 × distância à superfície mais próxima); sonda, estágio e rastro local (near 0,05 m, far 500 km). Isso evita a cintilação (z-fighting) com valores de 22 m a 30 UA na mesma cena.

## Limitações da trajetória

- A Lua segue órbita circular desenhada para a janela, não a efeméride real.
- As TCMs entram como orçamento de Δv; a trajetória desenhada já é a corrigida.
- Sem precessão J2 da órbita de estacionamento nem perturbações de terceiro corpo dentro de cada trecho (cônicas ajustadas).
- A geometria da DSM calculada na ΔV-EGA (~0,9 km/s) é maior que o orçamento de 750 m/s do perfil da missão; o orçamento do jogo continua o do documento de missão; a nota do planejamento mostra o Δv da DSM calculado para a data.

## Sonda — `engine/entities/spacecraft.ts`

- Energia: painéis com potência a 1 UA escalada por 1/d² e degradação anual; RTG constante; baterias dimensionadas contra o consumo durante o eclipse com profundidade de descarga limitada.
- Comunicação: taxa de cada enlace cai com 1/d² além da distância de referência do equipamento; volume diário = taxa × horas de contato; atraso = distância / c.
- Capacidades efetivas dependem do ambiente: magnetotorquers não descarregam rodas longe da Terra; GPS não funciona fora da órbita terrestre.
- Radiação: dose anual didática por ambiente × fator de blindagem (cofre, estrutura, instrumentos externos) comparada com a tolerância de cada eletrônica.

## Falhas — `engine/failures/failures.ts`

- Probabilidade = probabilidade base × fatores transparentes (campanha de testes, histórico do veículo, clima, vibração, radiação, atividade solar, térmico). Os fatores aparecem para o jogador.
- Sorteio determinístico por campanha (`mulberry32` com semente da campanha e da tentativa): a mesma configuração reproduz os mesmos eventos, o que permite aprender com o erro.
- Probabilidades são **parâmetros de jogo**, não estatísticas de confiabilidade.

## Ciência e pontuação — `engine/science/operations.ts`

- Qualidade de cada checkpoint = produto de fatores: instrumentos que medem a grandeza, alcance em latitude (inclinação), altitude ótima do instrumento, apontamento fino, iluminação, saúde (radiação e danos), energia, enlace e tempo de observação. Sem instrumento adequado não há dado válido.
- Classificação objetiva: abortada (aborto pelo jogador), fracassada (falha de lançamento, captura não realizada ou ciência < 15), sucesso (ciência ≥ 75 e objetivos primários ≥ 50), parcial (≥ 50), limitada (≥ 15).

## Limitações conhecidas

- Ascensão 2D, sem vento, sem dispersões de desempenho dos motores e sem trajetória 3D de azimute.
- O orçamento de Δv do planejamento ainda usa as fórmulas analíticas acima; a trajetória desenhada usa efemérides aproximadas do JPL e cônicas ajustadas (não substitui SPICE/Horizons).
- Atmosfera acima de 86 km sem variação solar.
- Custos, massas e consumos de componentes são didáticos.
- O servidor recalcula massa, custo, capacidade, tanque, Δv disponível e requisitos, mas recebe do cliente o Δv **necessário** (que depende do modelo orbital completo, implementado só no frontend).
