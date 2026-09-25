# Outpost

Outpost is a portable modular monolith for guided learning and career readiness. Authentication is implemented. A live coordinator-to-student workflow now stores organizations, published roadmaps, cohorts, enrollment, and topic progress in PostgreSQL. The separate review scenario still contains illustrative peers.

## Prerequisites

- Node.js 24.15+ LTS or Node.js 26+ with npm
- Docker for the local PostgreSQL, Valkey, MinIO, and Mailpit services
- Python 3.13 only when running the legacy FastAPI fallback

## Node backend

The Express API in `backend-js/` is the active runtime. Its 30 API routes and Prisma baseline have been verified against the existing PostgreSQL schema. The pre-baseline database backup is kept in the Git-ignored `local-backups/` directory. Set `OUTPOST_DATABASE_URL` in `backend-js/.env`, or use the existing ignored `backend/.env` during migration. Both the API and Prisma CLI accept the legacy Psycopg URL form. From `backend-js/`:

```powershell
npm ci
npm run db:generate
npm test
npm run dev
```

`npm start` starts the server without watch mode. Both commands use port 8000 by default. Operational endpoints are `/health` and `/ready`; product APIs remain under `/api/v1`.

## Legacy FastAPI fallback

The Python backend remains available during the compatibility cutover. From the repository root, install it:

```powershell
py -3.13 -m venv backend/.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
```

Run its quality gate from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m build --wheel
```

Run the fallback API from `backend/` after creating `backend/.env`:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

## Database migrations

The existing database was created by Alembic. Prisma migration `0_baseline` was compared against an isolated database, backed up, and marked applied without changing the existing tables. `npx prisma migrate status` reports the schema up to date. Never reset the local database or use `prisma db push` against it. To inspect the legacy revision from `backend/`, with `backend/.env` configured:

```powershell
.\.venv\Scripts\python.exe -m alembic current
```

The migration plan and compatibility contract are in [`docs/architecture/javascript-stack-migration.md`](docs/architecture/javascript-stack-migration.md).

## Frontend

Run the frontend setup and quality gate from `frontend/`:

```powershell
npm install
npm run format:check
npm run lint
npm test
npm run build
```

Use `npm run dev` to start Vite. Its `/api` proxy targets the active Node API at port 8000. Copy `frontend/.env.example` to `frontend/.env` when a local override is needed.

## Local PostgreSQL

Copy the root environment example once, then start and verify PostgreSQL from the repository root:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose up --detach postgres
docker compose ps postgres
docker compose exec --no-TTY postgres pg_isready -U outpost -d outpost
docker compose exec --no-TTY postgres psql -U outpost -d outpost -c "SELECT current_database(), current_user;"
```

PostgreSQL is exposed to the host at `127.0.0.1:5433` by default so it can coexist with a native PostgreSQL installation. Override `POSTGRES_PORT` in the root `.env` file when another host port is required.

For the FastAPI fallback, copy its environment example and run the SQLAlchemy connection probe from `backend/`:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
.\.venv\Scripts\python.exe -m app.database
```

A successful probe prints the connected database, user, and PostgreSQL version. The backend environment file is ignored by Git and uses the Psycopg driver explicitly; local development and integration testing do not use SQLite.

Stop the Compose stack with `docker compose down`. Named volumes preserve service data between container recreations; use `docker compose down --volumes` only when intentionally deleting all local service data.

## Local Valkey

Start and verify the Redis-compatible Valkey service from the repository root:

```powershell
docker compose up --detach --wait valkey
docker compose ps valkey
docker compose exec --no-TTY valkey valkey-cli ping
```

Valkey uses append-only persistence in the `valkey_data` named volume. `docker compose down` preserves this data; `docker compose down --volumes` deletes it intentionally.

## Local MinIO

Start and verify the S3-compatible object-storage service from the repository root:

```powershell
docker compose up --detach --wait minio
docker compose ps minio
Invoke-WebRequest http://127.0.0.1:9000/minio/health/live
```

The S3 API is available at `http://127.0.0.1:9000`, and the browser console is available at `http://127.0.0.1:9001`. Sign in with `MINIO_ROOT_USER` and `MINIO_ROOT_PASSWORD` from the root `.env` file. MinIO stores objects in the `minio_data` named volume.

## Local Mailpit

Start and verify the local SMTP capture service from the repository root:

```powershell
docker compose up --detach --wait mailpit
docker compose ps mailpit
Invoke-WebRequest http://127.0.0.1:8025/readyz
```

Applications can send unauthenticated development email to `127.0.0.1:1025`. Inspect captured messages in the browser at `http://127.0.0.1:8025`. Mailpit stores captured messages in the `mailpit_data` named volume.

## Container foundations

The current Compose file starts PostgreSQL, Valkey, MinIO, and Mailpit. The Node API and Vite run locally during development. The Python backend image remains a compatibility fallback; the frontend image builds the static JavaScript app. Build either image from the repository root so the root `.dockerignore` applies:

```powershell
docker build --file backend-js/Dockerfile --tag outpost-backend-js:local .
docker build --file frontend/Dockerfile --tag outpost-frontend:local .
```

The Node backend image runs Express on port 8000. The frontend image serves the static application with Nginx. The legacy FastAPI image remains available as a fallback.

## Architecture records

The governing build specification is in [`docs/OUTPOST-MASTER-BUILD-PROMPT.md`](docs/OUTPOST-MASTER-BUILD-PROMPT.md). Accepted architecture decisions are indexed in [`docs/OUTPOST-DECISIONS.md`](docs/OUTPOST-DECISIONS.md).

## College review demonstration

Open [the review walkthrough](docs/REVIEW-DEMO.md) for the local setup, five-minute presentation path, and a clear description of illustrative versus working features.
