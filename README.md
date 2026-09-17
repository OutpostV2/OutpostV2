# Outpost

Outpost is being built as a portable modular monolith. Phase 1 provides the repository and tooling foundation only; product behavior begins in later phases.

## Prerequisites

- Python 3.13
- Node.js 24.15+ LTS or Node.js 26+ with npm
- Docker for optional image builds and the Phase 2 local service stack

## Backend

From the repository root:

```powershell
py -3.13 -m venv backend/.venv
backend\.venv\Scripts\python.exe -m pip install -e "backend[dev]"
```

Run the backend quality gate from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m mypy
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m build --wheel
```

## Frontend

Run the frontend setup and quality gate from `frontend/`:

```powershell
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Use `npm run dev` to start the Vite development server. Copy `frontend/.env.example` to `frontend/.env` when a local override is needed.

## Local PostgreSQL

Copy the root environment example once, then start and verify PostgreSQL from the repository root:

```powershell
Copy-Item .env.example .env
docker compose up --detach postgres
docker compose ps postgres
docker compose exec --no-TTY postgres pg_isready -U outpost -d outpost
docker compose exec --no-TTY postgres psql -U outpost -d outpost -c "SELECT current_database(), current_user;"
```

PostgreSQL is exposed to the host at `127.0.0.1:5433` by default so it can coexist with a native PostgreSQL installation. Override `POSTGRES_PORT` in the root `.env` file when another host port is required.

Copy the backend environment example, then run the backend's independent SQLAlchemy connection probe from `backend/`:

```powershell
Copy-Item .env.example .env
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

When Docker is available, build the initial images from the repository root so the root `.dockerignore` applies:

```powershell
docker build --file backend/Dockerfile --tag outpost-backend:local .
docker build --file frontend/Dockerfile --tag outpost-frontend:local .
```

The backend image validates the installable package foundation. The frontend image builds the static application and serves it with Nginx. The local Compose stack contains PostgreSQL, Redis-compatible Valkey, MinIO object storage, and Mailpit email capture.

## Architecture records

The governing build specification is in [`docs/OUTPOST-MASTER-BUILD-PROMPT.md`](docs/OUTPOST-MASTER-BUILD-PROMPT.md). Accepted architecture decisions are indexed in [`docs/OUTPOST-DECISIONS.md`](docs/OUTPOST-DECISIONS.md).
