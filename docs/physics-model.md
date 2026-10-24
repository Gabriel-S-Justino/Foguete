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
- Transferências lunar e joviana em modelo coplanar circular; a janela de Júpiter é ilustrativa e não substitui efemérides (SPICE/Horizons).
- Atmosfera acima de 86 km sem variação solar.
- Custos, massas e consumos de componentes são didáticos.
- O servidor recalcula massa, custo, capacidade, tanque, Δv disponível e requisitos, mas recebe do cliente o Δv **necessário** (que depende do modelo orbital completo, implementado só no frontend).
