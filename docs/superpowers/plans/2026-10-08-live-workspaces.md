# Phases 16–18 — Live workspaces

The user authorizes continuous implementation through Phase 18, with a verified project commit and separate Layer 4 checkpoint for each phase. Layers 1–3 remain unchanged.

### Task 1: Phase 16

Reuse and freshly verify the existing progress-tree API commit. Replace student fixture dashboard/roadmap pages with enrolled pinned-version data and persisted completion. Preserve join/withdrawal. Show honest activity/empty states until Phase 18. Decouple student navigation from the review scenario. Component tests cover live metrics, hierarchy, write/read persistence, loading, errors and retry; database tests cover independent users and archived pinned versions; browser verification covers reload/sign-in and mobile.

### Task 2: Phase 17

Replace coordinator dashboard, cohorts, student progress, topic statistics and support pages with authorized organization/cohort reports. Add exact pinned-version metadata and explicitly defined all-time denominators. Use two fixed bulk database aggregations for a cohort report; include eligible active zero-progress students. Reuse organization and cohort selectors. Exclude fixtures, suspended users, inactive memberships/enrollments and inactive tenants/cohorts. Verify tenant/role/version/empty cases with PostgreSQL and UI tests. Inspect EXPLAIN for the aggregation. Remove review-scenario dependency from the workspace shell.

### Task 3: Phase 18

Add transactional, immutable progress-transition events (completion/reopening only; idempotent writes create no duplicate event). Add cohort-specific, pinned-version week deadlines independently of immutable curriculum. Accept explicit-offset absolute due instants and an IANA display timezone. Store UTC instants; browser displays the declared zone. Missing due dates produce no overdue signal. Completion is evaluated across the week's current saved topics; overdue incomplete work is a transparent signal, not an outcome prediction. Deadline changes record their author/time and deletions are explicit. Preserve enrollments and progress. Add authorized student/coordinator history and deadline reads plus staff scheduling UI and student due list. Verify no review contamination, duplicate/concurrent writes, atomicity, filtering after withdrawal, guessed/cross-tenant IDs, offset validation, DST/instant handling and empty/error/mobile states.

## Verification and handoff

For each phase: targeted RED→GREEN tests, backend suite and PostgreSQL suite as applicable, frontend suite, lint/build, targeted formatting and whitespace check. For Phase 18 inspect/deploy the additive migration without resetting existing data, validate/generate Prisma and check migration status. Run a real browser flow against the Node API/PostgreSQL at the end. Commit only relevant files, then replace only Layer 4 with actual evidence and the next phase. After Phase 18 select Phase 19 but do not execute it. Do not implement course/assignment/submission/grading additions beyond the current Phase 18 specification in this run.

## Completed verification

- Phase 16: live student workspace, ordered pinned-version tree, persisted completion and distinct-topic dashboard metrics. Backend 42 passed; database 7 passed; frontend 35 passed; lint/build and real student browser flow passed.
- Phase 17: live coordinator reports with exact versions, eligible zero-progress students, explicit denominator and two fixed bulk aggregates. Backend 42 passed; database 8 passed; frontend 41 passed; query-plan inspection, lint/build and coordinator browser flow passed.
- Phase 18: additive migration deployed and schema validated/generated/up to date; backend 43 passed; database 9 passed; frontend 47 passed; lint/build, targeted formatting and whitespace checks passed. Real browser scheduling → overdue → completion → activity → reopening → coordinator history → deadline removal passed, with both mobile layouts inspected.
- A fresh read-only review found no blocking defect. Both minor UI observations were fixed: slow learning retries keep a loading state, and saving one week preserves other week drafts. Regression tests reproduce the original behavior and pass with the fixes. No deferred findings or architectural rulings remain.
- Activity tests cover concurrent idempotence, atomic rollback, current scope after withdrawal, suspended students, archived pinned versions, immutable rows, pagination bounds and timezone/instant rules. Scheduling rejects guessed or mismatched version weeks at API and database boundaries; repeated saves/removals are no-ops.
- Phase 19 is selected only. This run does not add courses, assignments, submissions or grading beyond the existing Phase 18 guide scope.
