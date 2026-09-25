# JavaScript stack migration

The user-selected target is React 19 with JavaScript/JSX, Vite, and React Router; Node.js 24+ with Express 5, Zod, and JavaScript ES modules; Prisma ORM/Migrate with PostgreSQL and the pg adapter; and Vitest/Supertest. PostgreSQL, Valkey, MinIO, Mailpit, Docker Compose, and the modular-monolith domain boundaries remain.

## Compatibility contract

- Preserve every currently used `/api/v1` route, request/response JSON shape, status code, and session/cookie behavior until the React client has been moved.
- Preserve existing PostgreSQL data. The Alembic-created schema is introspected and baselined in Prisma; migration tooling must never reset the current database.
- Preserve Argon2id hashes, JWT issuer/audience/15-minute lifetime, DB-backed refresh rotation, email verification and password-reset semantics, phone OTP rate limits, Google OIDC checks, and organization/cohort access boundaries.
- Keep JavaScript source in `.js`/`.jsx`, including tests and build configuration. Generated Prisma artifacts may include type declarations inside `node_modules`.
- Preserve the existing visual design and user flows while converting frontend syntax.

## Cutover

Build the new Express app beside the existing FastAPI app. Verify API parity and database compatibility against an isolated PostgreSQL database, then point Vite and Docker at Node. Remove the Python runtime only after the JavaScript implementation and frontend have passed the contract, integration, and browser checks. Existing local data is not deleted.

## Current limitations

Google OAuth needs externally issued client credentials. Development SMS remains an in-memory provider, not real delivery. Preview pages remain previews; changing languages does not make unfinished product features live.

## Verified local cutover (2026-09-25)

The Node API now registers all 30 frozen /api/v1 operations. Prisma's introspected baseline was compared in an isolated database against 274 live schema catalog entries, then marked applied to the existing PostgreSQL database after a readable full backup was saved under the Git-ignored local-backups/ directory. Prisma reports the database schema up to date; existing tables and rows were not reset.

The JavaScript API test suite covers route parity, Argon2 hash compatibility, JWTs, registration/login, recovery, OAuth callback checks, phone OTP, review progress, and learning permissions. Live database smoke checks exercised registration, duplicate rejection, refresh rotation/replay revocation, and the coordinator → roadmap → cohort → student progress/report flow. A separate live phone OTP check used a fictional number and an in-memory SMS capture. The React JavaScript app passes formatting, lint, tests, and production build; the Vite /api proxy reaches Node. The production Node image builds and its /ready endpoint reaches PostgreSQL.

A non-mutating 29-operation comparison against the retained Python server found no status-code differences for malformed or unauthenticated requests. The OAuth authorization endpoint is excluded because it creates temporary login state when configured. The Python service remains as a documented compatibility fallback and Alembic history is retained. Google requires externally issued OAuth credentials, the development SMS provider does not deliver real texts, and the frontend's Google callback handoff is still a product gap. Prisma CLI transitive advisories remain in local development dependencies; the unused Prisma CLI, MySQL driver, and affected helper packages are absent from the production Node image.
