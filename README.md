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

## Container foundations

When Docker is available, build the initial images from the repository root so the root `.dockerignore` applies:

```powershell
docker build --file backend/Dockerfile --tag outpost-backend:local .
docker build --file frontend/Dockerfile --tag outpost-frontend:local .
```

The backend image validates the installable package foundation. The frontend image builds the static application and serves it with Nginx. Local PostgreSQL, Redis-compatible storage, object storage, and mail services belong to Phase 2.

## Architecture records

The governing build specification is in [`docs/OUTPOST-MASTER-BUILD-PROMPT.md`](docs/OUTPOST-MASTER-BUILD-PROMPT.md). Accepted architecture decisions are indexed in [`docs/OUTPOST-DECISIONS.md`](docs/OUTPOST-DECISIONS.md).
