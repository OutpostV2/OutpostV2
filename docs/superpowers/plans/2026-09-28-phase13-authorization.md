# Phase 13 Authorization Consolidation Plan

**Goal:** Centralize API authorization and enforce account, tenant, role, cohort, and parent-resource invariants on every live learning/review operation.

**Role policy:** Organization owners retain membership and invitation administration. Active `owner`, `admin`, and `coordinator` memberships can manage/read learning resources and view cohort reports. `mentor` has no cohort permission until a persisted cohort assignment exists. Students can join and access only published cohorts where they have an active enrollment and active student membership. Account type and membership role must agree (`student` ↔ `student`; `coordinator` ↔ staff roles). The account type alone never grants tenant access.

**Architecture:** Add composable policies under `backend-js/src/core/authorization.js`; route handlers resolve actual tenant/resource scope through persisted parent relationships and then invoke the appropriate role/enrollment policy. Continue using PostgreSQL state on each request. Existing authentication middleware remains responsible for live account/session status.

## Tasks

1. [x] Add PostgreSQL-backed HTTP tests for role denials, organization isolation, mismatched cohort/version/topic parents, active membership/enrollment, and suspended access. The first run failed on the intended admin access assertion before policy implementation.
2. [x] Implement shared account-type, organization membership/role, published-version, cohort-access, and assigned-topic policies; use them on learning and illustrative review endpoints.
3. [x] Run backend, PostgreSQL, schema, syntax, and live learning/organization smoke checks. No frontend source changed, so frontend checks were not part of this backend task.
4. [x] Record the role policy in ADR-006 and align ADR-004. Commit the verified implementation before editing Layer 4 in a separate checkpoint commit.

## Verification record

- `npm test`: 38 passed; the three PostgreSQL files are intentionally skipped in this command. The test scripts now use one worker so the existing Argon2 tests complete reliably on this machine.
- `npm run test:db`: three PostgreSQL-backed files passed, including direct HTTP cases for active roles, guessed and cross-tenant IDs, mismatched parent records, inactive membership/enrollment, and an already-issued session after account suspension.
- `npm run db:validate`: valid Prisma schema. `npx prisma migrate status`: two migrations, database up to date. No schema or migration changed in Phase 13.
- `node --check` passed for the changed backend source and test files. `git diff --check` passed.
- Live API smoke scripts for the learning and organization flows passed against port 8001 with PostgreSQL; their temporary rows were removed and that API listener was stopped. Port 8000 belonged to an unrelated local app and was left untouched.

**Stop boundary:** Complete Phase 13 only; select Phase 14 as next work without implementing draft/version governance.
