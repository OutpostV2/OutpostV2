# Outpost JavaScript API

Node.js 24+, Express 5, Zod, Prisma, PostgreSQL, Valkey, JOSE, and Argon2id.

From this directory, with the root Docker Compose services running:

```powershell
npm ci
npm run db:generate
npm test
npm run dev
```

The API listens on `127.0.0.1:8000` by default. Use `PORT` and `HOST` to change the bind address. `/health` is liveness, `/ready` checks PostgreSQL, and product routes live under `/api/v1`. Vite proxies `/api` to this server.

Create `.env` from `.env.example` for a new setup. During migration, if no `backend-js/.env` exists, the runtime can read the existing ignored `backend/.env` and normalize its `postgresql+psycopg://` URL. Prisma CLI likewise reads `OUTPOST_DATABASE_URL` or `DATABASE_URL` and supports that legacy file. Do not commit secrets.

The existing PostgreSQL schema was baselined as `0_baseline`. Run `npx prisma migrate status` to inspect it. Do not use `prisma db push` or reset the existing database. To verify against a running database, run `node --env-file=../backend/.env ./node_modules/vitest/vitest.mjs run tests/db` or set `OUTPOST_DATABASE_URL` explicitly.

For a non-mutating status comparison, run the legacy API on port 8001 beside Node on port 8000, then run `npm run contract:compare:invalid`. It checks 29 malformed or unauthenticated requests and skips Google authorization, which can create temporary state.

Google login requires a real OAuth client ID and secret; phone SMS is captured only by the development provider. The legacy FastAPI backend remains in `backend/` for compatibility and data lineage.
