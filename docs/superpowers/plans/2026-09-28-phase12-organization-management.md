# Phase 12 Organization Management Implementation Plan

Implementation record for the Phase 12 task. Each checked item was verified before the project commit.

**Goal:** Complete safe organization/member administration and owner-issued staff onboarding on the active JavaScript stack.

**Architecture:** Extend the existing Express learning module with owner-scoped reads and mutations. Add one Prisma invitation table with hashed, expiring codes. Keep membership authorization in PostgreSQL, then connect the organization workspace to the new API.

**Tech Stack:** Express 5, Prisma 7, PostgreSQL 17, React 19 JSX, Vitest/Supertest.

**Spec:** [ADR-006](../../decisions/ADR-006-organization-membership-management.md).

## Global Constraints

- Preserve the existing Prisma baseline and local data; use an additive migration only.
- Never grant tenant authority from account type or frontend state alone.
- Keep invitations and credential/session data out of member-directory responses and logs.
- Stop at Phase 12; Phase 13 handles general authorization consolidation.

## Review Focus

- An inactive owner or member cannot retain access through an old token.
- Cross-tenant membership IDs cannot be changed or used for transfer.
- Two concurrent invitation accepts cannot create duplicate memberships or reuse a code.
- A general member edit cannot remove the last owner.
- Review progress and credentials never appear in tenant member responses.

---

### Task 1: Organization and member reads

**Files:** `backend-js/src/modules/learning/routes.js`, `backend-js/tests/learning/routes.test.js`, `frontend/src/features/workspace/pages/OrganizationsPage.jsx`, `frontend/src/features/workspace/pages/OrganizationDetailPage.jsx`, `frontend/src/features/workspace/learningApi.js`, `frontend/src/app/App.jsx`.

- [x] Write failing owner, inactive, outsider, and safe-field route tests; run the targeted backend test.
- [x] Add owner-scoped detail and member-list routes; rerun the targeted test.
- [x] Write failing frontend navigation/member-list tests, connect the API and responsive page, then rerun frontend tests.

### Task 2: Membership status, staff role, and ownership transfer

**Files:** `backend-js/src/modules/learning/routes.js`, `backend-js/tests/learning/routes.test.js`, `frontend/src/features/workspace/pages/OrganizationDetailPage.jsx`.

- [x] Write failing tests for non-owner status/role changes, owner self-protection, cross-tenant IDs, and transfer.
- [x] Implement owner-authorized transactional mutations; rerun tests.
- [x] Add UI controls and a focused component test; rerun tests.

### Task 3: Staff invitations

**Files:** `backend-js/prisma/schema.prisma`, `backend-js/prisma/migrations/`, `backend-js/src/modules/learning/routes.js`, `backend-js/tests/learning/`, `frontend/src/features/workspace/pages/OrganizationDetailPage.jsx`, `frontend/src/features/workspace/pages/OrganizationsPage.jsx`.

- [x] Write failing invite issue/accept/revoke tests covering email verification, expiry, uniqueness, and one-time use.
- [x] Add the reviewed Prisma migration and generate the client; implement transactional invite routes.
- [x] Add issue, list, revoke, and accept UI with loading/error states; run focused UI tests.

### Task 4: End-to-end verification and handoff

**Files:** `backend-js/scripts/`, `docs/REVIEW-DEMO.md`, `docs/OUTPOST-MASTER-BUILD-PROMPT.md` Layer 4.

- [x] Run Prisma validation/migration status and PostgreSQL-backed integration plus live API smoke checks.
- [x] Run backend/frontend suites, frontend format/lint/build, and `git diff --check`.
- [x] Inspect the exact diff and secret hygiene; commit verified task changes, then update and commit Layer 4 separately.
