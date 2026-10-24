# Execução local, banco de dados e deploy

## Requisitos

- Node.js 22 e npm; Python 3.12+ (testado com 3.13); PostgreSQL 16 (ou Docker).
- Navegador com WebGL 2 (Chrome, Edge ou Firefox recentes).

## Opção A — Docker Compose (tudo junto)

```bash
docker compose up --build
# frontend: http://localhost:5173   API: http://localhost:8000/api/docs
```

O serviço `backend` roda `alembic upgrade head` antes de subir (apenas no ambiente local descartável).

## Opção B — manual

```bash
# 1. Banco local (exemplo com PostgreSQL já instalado)
createuser sma --pwprompt          # senha local de desenvolvimento
createdb sma -O sma

# 2. Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL=postgresql://sma:<senha>@localhost:5432/sma
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 3. Frontend (outro terminal)
cd frontend
npm ci
npm run dev                        # http://localhost:5173 (proxy /api → :8000)
```

Sem backend o jogo continua funcionando: o progresso fica no `localStorage` e a barra superior mostra “Servidor indisponível”.

## Migrações

```bash
cd backend
alembic upgrade head               # aplica
alembic downgrade -1               # desfaz a última (destrutivo: remove tabelas/colunas)
alembic revision --autogenerate -m "descrição"   # nova migração após alterar app/models.py
alembic check                      # confere se os modelos e as migrações estão alinhados
```

Em produção as migrações **não** rodam automaticamente. Rode `alembic upgrade head` manualmente apontando `DATABASE_URL` para o Neon, depois de revisar o arquivo da migração. Faça backup (branch do Neon) antes de qualquer migração que remova dados.

## Testes

```bash
cd frontend && npm run typecheck && npm run lint && npm test     # Vitest (motor, regras, vetores)
cd frontend && npm run build && npm run test:e2e                 # Playwright/Chromium, fluxo completo
cd backend && pytest                                              # SQLite temporário
cd backend && TEST_DATABASE_URL=postgresql://sma:<senha>@localhost:5432/sma_test pytest   # PostgreSQL real
```

Variáveis do E2E: `E2E_MISSION` (`leo-climate`, `lunar-he3`, `jupiter-system`), `E2E_URL` (servidor já em execução), `E2E_EXPECT_BACKEND=1` (exige revalidação no servidor), `E2E_HEADED=1`.

Os vetores `data/test-vectors/validation-vectors.json` são gerados pelo motor TypeScript (`UPDATE_VECTORS=1 npx vitest run vectors`) e verificados pelos dois lados.

## Deploy na Vercel com Neon

> O deploy **não foi executado** nesta entrega. Os passos abaixo descrevem a configuração preparada no repositório.

1. Crie um projeto no Neon e copie a connection string (com `sslmode=require`). Para funções serverless prefira a URL *pooled* (host com `-pooler`).
2. Aplique as migrações a partir da sua máquina: `DATABASE_URL=<url do Neon> alembic upgrade head` (em `backend/`).
   Alternativa sem instalar nada: cole `docs/sql/0001_esquema_inicial.sql` no **SQL Editor** do Neon e execute (gerado por `alembic upgrade head --sql`; também grava a versão `0001` em `alembic_version`, então migrações futuras continuam pelo Alembic).
3. Importe o repositório na Vercel com *Root Directory* `./` e *Application Preset* **Other** (não use o preset “Services” nem “Import single project” de `backend`, `frontend` ou `app`: o projeto é um só, e o `vercel.json` — com `"framework": null` — controla build e rotas). O `vercel.json` já define:
   - instalação e build do frontend (`frontend/dist` como saída);
   - a função Python `api/index.py` (FastAPI), incluindo `backend/app` e `data/`;
   - reescritas `/api/*` → função e demais rotas → `index.html`.
   As dependências Python da função estão em `requirements.txt` na raiz (mantenha igual a `backend/requirements.txt`).
4. Variáveis de ambiente na Vercel (Production e Preview):
   - `DATABASE_URL` — URL do Neon (segredo; nunca no código).
   - `CORS_ORIGINS` — domínio público (ex.: `https://seu-projeto.vercel.app`); como frontend e API compartilham a origem, é necessário só para outros domínios.
   - `DB_POOL_SIZE=1`, `DB_MAX_OVERFLOW=0` (recomendado em serverless com a URL pooled).
   - `VITE_API_URL` vazio (usa `/api` na mesma origem).
5. Após o deploy, confira `https://<domínio>/api/v1/health` (`database: ok`).

## Variáveis de ambiente

Veja `.env.example`. Somente variáveis `VITE_*` chegam ao navegador; nenhuma delas é secreta.
