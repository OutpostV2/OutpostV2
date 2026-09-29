# Phase 14 — roadmap drafts and immutable versions

The existing `roadmap_versions` and ordered hierarchy already hold full snapshots. Keep those tables and their existing IDs; add database guards rather than rebuilding or copying published version-1 data.

1. Add a non-destructive Prisma migration for lifecycle constraints and database guards on published/archived hierarchy writes. Verify migration status and existing-row counts before and after deployment.
2. Replace direct publication with draft creation. Add tenant-authorized version history/detail, full ordered draft replacement, copy-to-new-draft, explicit publish, and archive routes. Serialize version allocation and draft edits/publication with row locks. Reject empty or incomplete snapshots at publication.
3. Keep cohorts pinned to their version. Permit existing cohort reads/progress for archived versions while new assignments require published status.
4. Connect coordinator UI to these routes: draft list, editor, review, publish/archive, and selection of published versions for new cohorts. Keep legacy published versions visible.
5. Test lifecycle, concurrency, cross-tenant and role denial, direct database writes, old cohort progress, and frontend workflow. Run schema validation, migration checks, backend/frontend tests, lint/build, and a live smoke. Update ADR-005 with chosen workflow.
6. Commit verified implementation, then update only Layer 4 in a separate checkpoint commit, selecting Phase 15. Do not start Phase 15.
