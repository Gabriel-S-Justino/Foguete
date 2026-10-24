# Space Mission Architect

Simulador educacional 3D de arquitetura de missões espaciais. O jogador projeta uma sonda num hangar de integração, escolhe o lançador, planeja a trajetória, passa por um briefing de validação, conduz a contagem regressiva e o lançamento no centro de controle, executa as manobras e as observações científicas e recebe um relatório final.

Três missões: **observação climática em órbita baixa heliossíncrona**, **mapeamento lunar de indicadores de hélio-3** e **orbitador de Júpiter**.

## Tecnologias

- Frontend: React 18, TypeScript estrito, Vite, Babylon.js 7 (WebGL 2), zustand, SCSS, Vitest, Playwright (E2E).
- Backend: FastAPI, Pydantic 2, SQLAlchemy 2, Alembic, pytest.
- Dados: PostgreSQL (Neon em produção, Docker Compose localmente). Catálogos científicos versionados em `data/`.
- Deploy: Vercel (frontend estático + função Python).

## Início rápido

```bash
docker compose up --build        # http://localhost:5173
```

ou, sem Docker, veja [docs/deployment.md](docs/deployment.md). O jogo também roda só com o frontend (`cd frontend && npm ci && npm run dev`), salvando o progresso no navegador.

## Documentação

- [Arquitetura](docs/architecture.md)
- [Modelos físicos e limites](docs/physics-model.md)
- [Fontes científicas e classificação dos dados](docs/scientific-sources.md)
- [Execução local, banco, testes e deploy](docs/deployment.md)
- [Estado da implementação](docs/implementation-status.md)

## Material de referência

`reference/` guarda os documentos fornecidos para o projeto: o prompt de arquitetura, `componentes-sondas.md`, `orcamento_missoes_espaciais.md` e a imagem de referência do hangar (Amazônia-1).
