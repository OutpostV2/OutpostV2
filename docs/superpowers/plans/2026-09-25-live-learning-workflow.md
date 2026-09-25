# Live learning workflow implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a coordinator create an organization, publish a simple roadmap, create a cohort, invite a student, and see that student's persisted topic progress.

**Architecture:** Add organization-owned learning records in PostgreSQL with an immutable first roadmap version. A random cohort join code enrolls a student without exposing the user directory. Backend checks account type, organization ownership, enrollment, and topic-to-cohort assignment; React pages use real API responses.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, PostgreSQL, React, TypeScript, Vite, Vitest.

**Spec:** `docs/OUTPOST-MASTER-BUILD-PROMPT.md` Layers 1–3, especially the organization, roadmap, cohort, progress, and authorization sections.

## Global constraints

- Preserve current auth, review scenario, and unrelated worktree changes.
- Never infer authorization from a frontend route alone.
- A cohort pins an exact published roadmap version.
- Progress is student-and-topic scoped; no row means not started.
- Published content is immutable in this workflow.
- Do not claim later build-guide phases complete.

## Review focus

- A student cannot create or read another coordinator's organization or cohort.
- A coordinator cannot update a student's progress.
- A student cannot update a topic outside an enrolled cohort.
- A join code cannot enroll twice or leak unrelated user details.
- A coordinator sees a zero-progress student in cohort reporting.

### Task 1: Persist the workflow
- [x] Write failing API integration tests for create, join, progress, and authorization.
- [x] Add Alembic migration and SQLAlchemy models.
- [x] Verify migration upgrade and downgrade on a temporary PostgreSQL database.

### Task 2: Build the API
- [x] Implement organization, roadmap, cohort, enrollment, progress, and report endpoints.
- [x] Enforce ownership and enrollment at each endpoint.
- [x] Run focused and full backend tests, Ruff, mypy, and Alembic check.

### Task 3: Connect the frontend
- [x] Add typed API client functions and role-specific workflow pages.
- [x] Integrate them into existing protected navigation and dashboard paths.
- [x] Add frontend tests for create, join, progress, and error states.
- [x] Run format, lint, typecheck, tests, and build.

### Task 4: Verify the full journey
- [x] Exercise coordinator and student accounts through the API using temporary PostgreSQL.
- [x] Smoke-test the browser flow where local tools permit.
- [x] Update project docs to distinguish live workflow from preview pages and list remaining gaps.
