# Componentes para 3 missões espaciais

Arquiteturas de referência com **categorias de componentes** e exemplos reais de missões. Servem como ponto de partida, não como especificação de projeto. Massas e números são ordens de grandeza.

---

## Missão 1: Satélite de monitoramento climático em órbita baixa (Fácil)

**Conceito:** órbita heliossíncrona de cerca de 600 a 850 km, com 500 a 1000 kg. Referências: NOAA/JPSS, Landsat e satélites das classes CubeSat/SmallSat.

| Subsistema | Componente | Observação |
|---|---|---|
| Carga útil | Imageador multiespectral (visível e infravermelho) | Nuvens, vegetação e temperatura da superfície |
| Carga útil | Sondador de infravermelho/micro-ondas | Perfis de temperatura e umidade da atmosfera |
| Carga útil | Radiômetro de balanço de radiação | Energia que entra e sai da Terra |
| Estrutura | Barramento (bus) de alumínio/compósito | Pode ser comprado pronto de plataformas comerciais |
| Energia | Painéis solares de células GaAs de tripla junção + baterias de íon-lítio | Baterias cobrem o eclipse |
| Atitude | Rastreadores estelares (star trackers), rodas de reação, magnetotorquers, sensor solar, giroscópios | Apontamento preciso para o imageamento |
| Propulsão | Propulsores de hidrazina ou elétricos pequenos | Manutenção de órbita e desorbitar no fim da vida |
| Computação | Computador de bordo com tolerância moderada a radiação | Na órbita baixa a radiação é mais branda |
| Comunicação | Banda X para dados científicos, banda S para comando e telemetria | Antenas de baixo ganho |
| GNSS | Receptor GPS | Posição e tempo |
| Térmico | Isolamento multicamada (MLI), radiadores, aquecedores | Ciclos térmicos curtos a cada órbita |

**Ponto de atenção:** o desafio aqui é o volume de dados e a calibração, mais do que o hardware.

---

## Missão 2: Sonda em órbita lunar para mapear Hélio-3 (Médio)

**Conceito:** órbita polar lunar baixa, de 50 a 100 km, com 500 a 1000 kg. Referências: LRO, Lunar Prospector e Chandrayaan.

| Subsistema | Componente | Para que serve |
|---|---|---|
| Carga útil | Espectrômetro de nêutrons | Mapeia hidrogênio e composição do regolito |
| Carga útil | Espectrômetro de raios gama | Elementos como Fe, Ti, Th e K |
| Carga útil | Radar de abertura sintética (SAR) em banda S/L | Profundidade do regolito |
| Carga útil | Espectrômetro/imageador no infravermelho próximo | Mineralogia, em especial a ilmenita (rica em titânio) |
| Carga útil | Câmera de alta resolução | Contexto geológico |
| Carga útil | Altímetro a laser | Topografia e correlação com a geologia |
| Estrutura | Barramento com tanque de propelente grande | Muito delta-v para a inserção lunar |
| Propulsão | Motor bipropelente principal (ex.: hipergólico) + propulsores de controle | Inserção na órbita lunar e correções |
| Energia | Painéis solares articulados + bateria | Eclipses mais longos que na órbita baixa da Terra |
| Atitude | Rastreadores estelares, rodas de reação, giroscópios | Apontamento estável dos instrumentos |
| Comunicação | Antena de alto ganho em banda S/X, rede de espaço profundo | Visibilidade da Terra limitada na órbita polar |
| Navegação | Rádio com ranging/Doppler, relógio estável | Determinação precisa da órbita |
| Térmico | Aquecedores, MLI, radiadores | Ciclos térmicos mais severos |

**Observações:**

- **Caveat científico:** o Hélio-3 não pode ser detectado diretamente por sensoriamento remoto orbital. Ele vem do vento solar e fica implantado no regolito em concentrações muito baixas (partes por bilhão). O que se mapeia são indicadores indiretos: ilmenita (Ti), maturidade do solo e profundidade do regolito, a partir de nêutrons, raios gama e infravermelho.
- **Radiação:** maior que na órbita baixa da Terra, mas ainda moderada.

---

## Missão 3: Sonda em órbita de Júpiter (Difícil)

**Conceito:** órbita polar muito excêntrica, com 3000 a 4000 kg. Referências: Juno e Europa Clipper.

| Subsistema | Componente | Para que serve |
|---|---|---|
| Carga útil | Magnetômetro (fluxgate) em haste longa | Campo magnético |
| Carga útil | Experimento de gravidade (transponder Ka/X de alta estabilidade, medidas Doppler) | Mapeia o campo gravitacional pelas perturbações da órbita |
| Carga útil | Radiômetro de micro-ondas | Estrutura profunda da atmosfera |
| Carga útil | Detectores de partículas e plasma | Ambiente de radiação e magnetosfera |
| Carga útil | Câmera de contexto | Imagens |
| Estrutura | Cofre de radiação em titânio (radiation vault) | Protege os eletrônicos sensíveis, como na Juno |
| Propulsão | Motor principal de grande porte + muito propelente | Inserção na órbita de Júpiter (JOI), a manobra mais crítica |
| Energia | Painéis solares gigantes de alta eficiência **ou** RTG (gerador termoelétrico de radioisótopo) | Júpiter recebe cerca de 1/25 da luz solar da Terra. A Juno provou que painéis servem; o RTG é a alternativa |
| Atitude | Rastreadores estelares, giroscópios, rodas ou propulsores, rotação estabilizada | Apontamento sob radiação intensa |
| Computação | Computador de bordo endurecido contra radiação | Radiação é a maior ameaça à missão |
| Comunicação | Antena de alto ganho grande (cerca de 2,5 m ou mais), banda X e Ka | Grande atraso e pouca potência recebida na Terra |
| Térmico | Aquecedores, MLI, blindagem térmica | Ambiente frio e variações extremas |
| Segurança | Medidas de proteção planetária | Evitam contaminar luas como Europa |

**Observações:**

- **Premissa científica:** a ideia de que a gravidade de Júpiter nos protege de asteroides é debatida. Pesquisas indicam que Júpiter pode tanto desviar quanto lançar objetos para o Sistema Solar interno. Uma missão desse tipo mediria a gravidade e a estrutura interna do planeta e ajudaria a testar essas hipóteses, mas não "provaria" sozinha o efeito protetor.
- **Desafios principais:** radiação, energia e comunicação. É a missão mais cara e complexa das três.

---

## Comparação rápida

| | LEO (Fácil) | Lua (Médio) | Júpiter (Difícil) |
|---|---|---|---|
| Delta-v / propulsão | Baixo | Médio | Muito alto |
| Energia | Painéis | Painéis | Painéis grandes ou RTG |
| Radiação | Baixa | Baixa a média | Extrema |
| Comunicação | Simples | Rede de espaço profundo | Antena grande, links lentos |
| Instrumentação-chave | Imageador e sondador | Nêutrons, gama e radar | Gravidade e magnetômetro |
