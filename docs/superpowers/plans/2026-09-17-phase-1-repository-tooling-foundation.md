# Phase 1 Repository and Tooling Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the verified Python and React/TypeScript development foundations required by Phase 1, including consistent formatting, linting, type checking, tests, environment examples, and initial Dockerfiles.

**Architecture:** Keep the repository split into independent `backend` and `frontend` projects. The backend is an installable Python package with development-only quality tools. The frontend is a minimal Vite application with its own quality and test tooling. Root files document and normalize the two projects without introducing product features or Phase 2 services.

**Tech Stack:** Python 3.13, Hatchling, pytest, Ruff, mypy; React, TypeScript, Vite, ESLint, Prettier, Vitest, React Testing Library; Dockerfile foundations.

**Spec:** `docs/OUTPOST-MASTER-BUILD-PROMPT.md`

## Global Constraints

- Layers 1–3 of the master build prompt govern all implementation choices.
- Install only dependencies required for Phase 1 tooling.
- Do not implement product behavior, persistence, APIs, authentication, or Phase 2 services.
- Use the repository's two-commit task loop: implementation and stable Layer 3 updates in Commit A, then a Layer 4-only handoff in Commit B.
- Dockerfiles receive static checks because the Docker CLI is unavailable in the current environment.

## Task 1: Backend Python Foundation

**Files:**
- Create: `backend/pyproject.toml`
- Create: `backend/app/__init__.py`
- Create: `backend/tests/test_package.py`
- Create: `backend/.env.example`
- Modify: `docs/OUTPOST-MASTER-BUILD-PROMPT.md` Layer 3 only

- [x] Define an installable Python package with no runtime dependencies and a `dev` extra for Hatchling, pytest, Ruff, and mypy.
- [x] Add a package version and a packaging smoke test that compares it with installed metadata.
- [x] Create a minimal environment example limited to runtime mode and log level.
- [x] Install the editable project into `backend/.venv` and run format, lint, type, test, and wheel-build checks.
- [x] Replace the backend `pyproject.toml` and environment-example placeholders in Layer 3 with canonical contents.
- [x] Review and commit the backend foundation as Commit A, then update only Layer 4 and commit the checkpoint as Commit B.

## Task 2: Frontend React and TypeScript Foundation

**Files:**
- Create: `frontend/package.json` and lockfile
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/App.test.tsx`
- Create: `frontend/src/test/setup.ts`
- Create or modify: Vite, TypeScript, ESLint, and Prettier configuration files under `frontend/`
- Modify: `docs/OUTPOST-MASTER-BUILD-PROMPT.md` Layer 3 only

- [x] Scaffold a minimal React and TypeScript Vite application.
- [x] Add only the formatting, linting, type-checking, and unit-test dependencies needed in Phase 1.
- [x] Replace starter product/demo content with a neutral foundation screen and a matching smoke test.
- [x] Run format, lint, type-check, unit-test, and production-build checks.
- [x] Replace the frontend package and TypeScript/Vite placeholders in Layer 3 with canonical contents.
- [x] Review and commit the frontend foundation as Commit A, then update only Layer 4 and commit the checkpoint as Commit B.

## Task 3: Repository, Environment, Documentation, and Docker Foundations

**Files:**
- Create: `.editorconfig`
- Create: `.gitattributes`
- Create: `.dockerignore`
- Create: `README.md`
- Create: `docs/architecture/README.md`
- Create: `backend/Dockerfile`
- Create: `frontend/Dockerfile`
- Create: `frontend/.env.example`
- Modify: `.gitignore`
- Modify: `docs/OUTPOST-MASTER-BUILD-PROMPT.md` Layers 3 and 4 according to the repository loop

- [ ] Normalize text, editor, ignored-file, and Docker build-context conventions.
- [ ] Document the supported setup and verification commands for both projects.
- [ ] Add initial backend and frontend Dockerfiles and statically verify their required instructions.
- [ ] Add the frontend API-base environment convention without implementing an API integration.
- [ ] Run the complete Phase 1 backend and frontend verification suites from a clean working tree candidate.
- [ ] Update the stable Layer 3 `.gitignore` and directory-tree records and mark this plan complete.
- [ ] Review and commit the final Phase 1 foundation as Commit A, then update only Layer 4 to the first Phase 2 task and commit the checkpoint as Commit B.
