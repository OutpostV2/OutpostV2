# Phase 16 — Student Live Progress Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the student's existing authorized progress read so the frontend can show each active cohort's pinned roadmap version and ordered phase → week → topic tree with that student's saved completion.

**Architecture:** Enrich `GET /api/v1/progress/me` from the existing learning module. Derive version and hierarchy data from the active enrollment's exact `roadmapVersionId`, keep the current flat `topics` and summary fields for compatibility, and attach progress only for the authenticated user. This is a read-contract change; it needs no migration, new storage, or activity-event model.

**Tech Stack:** Node.js 24, Express 5, Prisma 7, PostgreSQL, Vitest, Supertest.

**Spec:** `docs/OUTPOST-MASTER-BUILD-PROMPT.md`, Layer 2, Phase 16.

## Global Constraints

- Product APIs remain under `/api/v1`.
- PostgreSQL is authoritative; the student's progress is scoped to the authenticated user.
- Every returned assignment must come from an active, authorized enrollment and its exact pinned roadmap version, including when that version is archived.
- Keep published roadmap versions immutable and preserve the existing flat progress response fields.
- Do not reset the database or use `prisma db push`; this read-only contract change requires no migration.
- The illustrative review scenario remains separate from live cohort data.

## Review Focus

- No active enrollments, including after withdrawal or staff removal, returns `[]`.
- An enrolled cohort continues to return its pinned archived version rather than following a newer roadmap version.
- Two students in the same cohort receive independent completion state for the same topic.
- Phases, weeks, and topics are returned in their persisted `orderIndex` order.
- Adding the nested hierarchy preserves the existing flat topic list, completion total, and percentage contract.

---

### Task 1: Enrich the authorized student progress response

**Files:**
- Modify: `backend-js/src/modules/learning/routes.js`
- Test: `backend-js/tests/db/cohort-governance.test.js`

**Interfaces:**
- Consumes: the authenticated user, active `CohortEnrollment` rows, and `requireCohortAccess` for the enrollment's cohort.
- Produces: each existing assignment object retains `cohort_id`, `cohort_name`, `organization_name`, `roadmap_name`, `completed`, `total`, `percent`, and flat `topics`; add `roadmap_version_id`, `roadmap_version_number`, and ordered `phases` containing ordered `weeks` and `topics`.
- Each nested topic includes `id`, `title`, `description`, `order_index`, `completed`, and `completed_at`. Each phase and week includes `id`, `title`, and `order_index`.
- Do not add activity events or infer an event history from the current completion snapshot.

- [ ] **Step 1: Add a PostgreSQL-backed failing contract test.** Extend the existing cohort-governance journey with an explicitly ordered multi-phase roadmap and a second student. Assert a coordinator cannot read the student endpoint, the version ID/number matches the cohort's pinned version, nested phase/week/topic order matches stored order, existing flat fields and progress totals remain unchanged, one student's completion does not appear for the other, a withdrawn enrollment returns no assignments, and the archived pinned version remains readable.
- [ ] **Step 2: Run the focused test and confirm it fails on the missing version/tree fields.** From `backend-js`, run `node --env-file-if-exists=.env ./node_modules/vitest/vitest.mjs run tests/db/cohort-governance.test.js --maxWorkers=1`. The setup must reach the new contract assertions; unrelated environment/setup failures do not count as the expected failure.
- [ ] **Step 3: Implement the additive response fields in `backend-js/src/modules/learning/routes.js`.** Build the nested tree from the authorized `scope.version.id`, sort each level by `orderIndex`, attach only the requesting user's progress, and preserve the existing flat topic list and summary calculations.
- [ ] **Step 4: Re-run the focused PostgreSQL-backed test.** Use the same command; expect the new contract assertions and existing cohort governance journey to pass.
- [ ] **Step 5: Run broader verification.** From `backend-js`, run `npm test`, `npm run test:db`, and `git diff --check`; all must pass before committing.
- [ ] **Step 6: Commit the verified implementation.** Stage only `backend-js/src/modules/learning/routes.js` and `backend-js/tests/db/cohort-governance.test.js`, inspect the staged diff, and commit with a concise message describing the student progress contract. Then follow the master prompt's separate Layer 4 checkpoint commit rule.
