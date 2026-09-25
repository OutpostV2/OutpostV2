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

Create `.env` from `.env.example` for a new setup. Keep database and signing credentials in this ignored file. The API and Prisma CLI read it and normalize a legacy `postgresql+psycopg://` URL if present. Do not commit secrets.

The existing PostgreSQL schema was baselined as `0_baseline`. Run `npx prisma migrate status` to inspect it. Do not use `prisma db push` or reset the existing database. Run `npm run test:db` to verify against a running database.

Google login requires a real OAuth client ID and secret; phone SMS is captured only by the development provider.
