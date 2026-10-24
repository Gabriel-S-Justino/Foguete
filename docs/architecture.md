# Arquitetura

```
data/                     Fonte única de verdade (JSON versionado): fontes, constantes, lançadores,
                          componentes, missões, configuração da simulação, vetores de teste compartilhados
frontend/                 React + TypeScript estrito + Vite + Babylon.js (WebGL 2)
  src/engine/             Motor sem React: física, regras, falhas, ciência, cenas 3D
    catalog/              Importação tipada dos JSON de /data e checagem de integridade
    core/                 SceneManager (Engine único, troca de cenas, perda de contexto, qualidade adaptativa), RNG, unidades
    atmosphere/ propulsion/ orbital-mechanics/ physics/   Modelos físicos (ver physics-model.md)
    rules/                Motor de regras centralizado: orçamento, perfil de Δv, validação, arquiteturas de referência
    entities/             Análise da sonda; modelos 3D da sonda, foguetes e braços robóticos
    scenes/               Cenas: hangar da sonda, hangar de lançadores, briefing, plataforma, visualização orbital
    simulation/           LaunchController (verificações, contagem, holds, abortos, ascensão com passo fixo)
    failures/ science/    Falhas determinísticas; manobras, checkpoints, relatório
  src/store/              Estado da campanha (zustand + persistência local + sincronização com a API)
  src/features/           Telas por etapa (player, missions, spacecraft, launch-vehicles, mission-planning,
                          launch-control, simulation, mission-report)
  src/services/api.ts     Cliente da API /api/v1 (tolerante a falhas: o jogo funciona offline)
  e2e/run-e2e.mjs         Teste ponta a ponta com Playwright/Chromium
backend/                  FastAPI + Pydantic + SQLAlchemy + Alembic
  app/rules.py            Espelho das regras críticas em Python (mesmos ids/status; vetores compartilhados)
  app/routers/api.py      Rotas versionadas
  alembic/                Migrações
api/index.py              Entrada da função Python na Vercel
```

## Princípios

- **Regras em um lugar**: a interface nunca decide aprovação; ela exibe o resultado de `validateMission`. O backend repete as regras críticas e prevalece em caso de divergência.
- **Modelo lógico → modelo 3D**: a cena da sonda é sincronizada a partir de `campaign.spacecraft.installed`; o 3D nunca é fonte de verdade.
- **Física desacoplada da renderização**: o LaunchController avança em passo fixo; a cena apenas lê o estado.
- **Um único Engine Babylon**: as cenas são descartadas ao trocar de etapa (`scene.dispose()`), materiais PBR compartilhados por cena, instâncias finas para estruturas repetidas, redução automática de qualidade quando a taxa de quadros cai.
- **Determinismo**: semente por campanha e tentativa.
- **Sem segredos no frontend**: somente `VITE_API_URL` (pública). Nenhuma chave paga é necessária.

## Fluxo da campanha

identificação → missão → hangar da sonda → lançador → trajetória → briefing/validação → plataforma e controle → voo e manobras → ciência → relatório. `canEnter` (store) impede avançar sem as condições de cada etapa; o lançamento exige a validação aprovada.

## API (`/api/v1`)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/health` | Estado do serviço, do banco e versões dos catálogos |
| POST | `/sessions` | Cria sessão de jogador (nome validado); devolve token (só o hash é salvo) |
| PUT | `/campaigns/{id}` | Salva o estado da campanha (revisão incremental) |
| GET | `/campaigns`, `/campaigns/{id}` | Lista/recupera campanhas da sessão |
| POST | `/campaigns/{id}/validate` | Revalidação das regras críticas no servidor |
| POST | `/campaigns/{id}/events` | Registra eventos de voo |
| POST | `/campaigns/{id}/finalize` | Recalcula regras e custo, valida o relatório e o grava (uma linha por tentativa) |
| GET | `/reports` | Histórico de relatórios da sessão |

Autenticação: cabeçalho `X-Session-Token`. Uma sessão só acessa as próprias campanhas.

## Banco de dados

`player_sessions`, `campaigns` (estado JSON + revisão + versões dos catálogos), `flight_events`, `mission_reports` (único por campanha e tentativa, com o resultado da revalidação do servidor).
