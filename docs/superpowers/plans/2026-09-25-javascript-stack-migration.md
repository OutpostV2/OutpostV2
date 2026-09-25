# JavaScript Stack Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Move Outpost to React JavaScript and Node/Express/Prisma without losing current API behavior or PostgreSQL data.

**Architecture:** Keep the `/api/v1` contract and PostgreSQL schema stable while introducing a parallel Express app. Introspect and baseline the existing Alembic schema with Prisma, port domain services module by module, convert React TSX to JSX, then cut over local run/build/test commands after parity verification.

**Tech Stack:** React 19, JavaScript ES modules, Vite, Express 5, Zod, Prisma ORM/Migrate, PostgreSQL with pg adapter, Argon2id, JOSE, Valkey, Nodemailer, Vitest, Supertest.

**Spec:** `docs/architecture/javascript-stack-migration.md` and the user's pasted stack proposal.

## Global Constraints

- Preserve current uncommitted user work and existing PostgreSQL records.
- Do not reset the local database or run `prisma db push` against it.
- Preserve API paths, JSON fields, status codes, role checks, and refresh-cookie behavior.
- Keep the old Python backend available until the Node backend passes parity checks.
- Do not invent Google OAuth credentials or claim development SMS sends real texts.

## Review Focus

- Existing Argon2id password hashes must authenticate in Node.
- Existing refresh sessions must rotate and reject replay with the same status behavior.
- A student must not gain coordinator or cross-organization access.
- Existing database constraints and rows must survive Prisma baselining.
- Frontend login, learning, and review pages must still work after `.tsx`/`.ts` conversion.

### Task 1: Freeze the API and database contracts

**Files:** Create `backend-js/tests/contracts/`; inspect `backend/app/modules/`, `backend/alembic/`, and frontend API clients.

- [x] Record mounted `/api/v1` methods, paths, status codes, and representative response shapes from the current FastAPI app.
- [x] Record tables, columns, indexes, constraints, and migration revision from a read-only database inspection.
- [x] Add parity fixtures/tests that can run against both servers without changing shared user records.

### Task 2: Introduce Prisma without data loss

**Files:** Create `backend-js/package.json`, `backend-js/prisma/schema.prisma`, `backend-js/prisma.config.*`, `backend-js/prisma/migrations/0_baseline/migration.sql`, `backend-js/src/db/`.

- [x] Install pinned Prisma, `@prisma/client`, `@prisma/adapter-pg`, `pg`, and testing dependencies compatible with Node 24+.
- [x] Introspect the current PostgreSQL schema, mapping existing snake_case names without table recreation.
- [x] Generate a baseline migration and verify it builds an equivalent schema in an isolated empty PostgreSQL database.
- [x] Mark the baseline as applied to the existing database only after schema comparison and backup/export checks.
- [x] Verify Prisma Client reads existing users and learning records without altering them.

### Task 3: Port the HTTP and authentication boundary

**Files:** Create `backend-js/src/app.js`, `server.js`, `config/`, `middleware/`, `modules/auth/`, `modules/users/`, and matching `backend-js/tests/`.

- [x] Add Express request IDs, structured errors, logging, Zod validation, health/readiness, and `/api/v1` discovery.
- [x] Port password registration/login, Argon2id hashing, JWT issuance/validation, current user, and DB-backed session issuance.
- [x] Port refresh rotation, logout/revocation/listing, email verification/reset, phone OTP and rate limits, and Google OIDC state/callback using Valkey and provider adapters.
- [x] Verify each route against the frozen contract and existing-hash/session security tests.

### Task 4: Port learning and review domains

**Files:** Create `backend-js/src/modules/learning/`, `backend-js/src/modules/review/`, and integration tests.

- [x] Port organization ownership, published roadmap versions, cohorts/join codes, student enrollment, topic progress, and coordinator reports.
- [x] Port the clearly labelled review scenario and its per-user progress behavior.
- [ ] Test tenant isolation, assigned-topic checks, duplicate joins, zero-progress students, and cross-role denial against PostgreSQL.

### Task 5: Convert the frontend to JavaScript

**Files:** Rename `frontend/src/**/*.ts(x)` to `.js(x)`, update Vite/ESLint/package scripts and tests.

- [x] Strip TypeScript-only syntax while preserving React behavior and CSS.
- [x] Remove TypeScript-only dependencies/configuration; keep Vite, React Router, ESLint, Prettier, Vitest, and React Testing Library.
- [ ] Run frontend lint, formatting, tests, and production build; manually smoke the key role flows.

### Task 6: Cut over local runtime and documentation

**Files:** Update `README.md`, `frontend/README.md`, Dockerfiles/Compose, CI, and canonical stack references in `docs/`.

- [x] Point frontend proxy and run commands to Express only after API parity passes.
- [ ] Verify a browser flow with the Node API and existing PostgreSQL: register/login, create roadmap/cohort, join, complete, and report.
- [x] Preserve or archive Alembic history for data lineage, then remove Python from the active build/runtime and update all developer instructions.
- [x] Run all Node/frontend checks and database migration status checks, inspect `git diff --check`, and report any remaining product gaps.

Remaining checks above require a full browser-driven two-account walkthrough and additional live tenant-isolation coverage. API-level live smoke tests, visual page checks, and unit/integration tests have passed.
