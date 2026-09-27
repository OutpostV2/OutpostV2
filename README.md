# Outpost

Outpost is a portable modular monolith for guided learning and career readiness. Authentication is implemented. A live coordinator-to-student workflow now stores organizations, published roadmaps, cohorts, enrollment, and topic progress in PostgreSQL. The separate review scenario still contains illustrative peers.

## Prerequisites

- Node.js 24.15+ LTS or Node.js 26+ with npm
- Docker for the local PostgreSQL, Valkey, MinIO, and Mailpit services

## Start locally

With Docker Desktop running and dependencies installed in `backend-js/` and `frontend/`, start all local services and both development servers from the repository root:

```powershell
npm run dev
```

Open `http://localhost:5173`. The API runs at `http://127.0.0.1:8000`. Press Ctrl+C to stop the API and frontend. Docker services keep their data and continue running; stop them later with `npm run services:down`.

For a new checkout, create the ignored root and `backend-js/.env` files from their examples, run `npm ci` in each application folder, and run `npm run db:generate` in `backend-js/` once.

## Node backend

The Express API in `backend-js/` is the active runtime. Its 30 API routes and Prisma baseline have been verified against the existing PostgreSQL schema. The pre-baseline database backup is kept in the Git-ignored `local-backups/` directory. Set `OUTPOST_DATABASE_URL` in the ignored `backend-js/.env` file. Both the API and Prisma CLI accept the legacy Psycopg URL form. From `backend-js/`:

```powershell
npm ci
npm run db:generate
npm test
npm run dev
```

`npm start` starts the server without watch mode. Both commands use port 8000 by default. Operational endpoints are `/health` and `/ready`; product APIs remain under `/api/v1`.

## Database migrations

The existing database was created by Alembic. Prisma migration `0_baseline` was compared against an isolated database, backed up, and marked applied without changing the existing tables. Never reset the local database or use `prisma db push` against it. From `backend-js/`, run `npx prisma migrate status` to inspect migrations and `npm run test:db` to check database access.

The frozen API compatibility contract is in [`docs/architecture/javascript-api-contract.md`](docs/architecture/javascript-api-contract.md).

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

Create `backend-js/.env` from `backend-js/.env.example` for a new installation and set the local PostgreSQL URL there. This file is ignored by Git.

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

The current Compose file starts PostgreSQL, Valkey, MinIO, and Mailpit. The Node API and Vite run locally during development. The frontend image builds the static JavaScript app. Build either image from the repository root so the root `.dockerignore` applies:

```powershell
docker build --file backend-js/Dockerfile --tag outpost-backend-js:local .
docker build --file frontend/Dockerfile --tag outpost-frontend:local .
```

The Node backend image runs Express on port 8000. The frontend image serves the static application with Nginx.

## Architecture records

The governing build specification is in [`docs/OUTPOST-MASTER-BUILD-PROMPT.md`](docs/OUTPOST-MASTER-BUILD-PROMPT.md). Accepted architecture decisions are indexed in [`docs/OUTPOST-DECISIONS.md`](docs/OUTPOST-DECISIONS.md).

## College review demonstration

Open [the review walkthrough](docs/REVIEW-DEMO.md) for the local setup, five-minute presentation path, and a clear description of illustrative versus working features.
