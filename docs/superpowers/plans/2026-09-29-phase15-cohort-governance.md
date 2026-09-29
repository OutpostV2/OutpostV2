# Phase 15 — cohort and join-code governance

Policy for the local review: join codes contain 256 random bits, are stored as SHA-256 digests, expire after seven days, and are returned only when created or rotated. Rotation invalidates the old code; revocation disables joining. Joining is limited to 30 attempts per IP and 10 per account in a 15-minute Valkey window, with the API failing closed if rate limiting is unavailable. Invalid, expired, and revoked codes share one response.

Enrollment stays tenant-scoped and idempotent. Students can withdraw; staff can remove or reinstate them. Withdrawal/removal changes enrollment state without deleting topic progress. A student can rejoin after their own withdrawal with a current code, restoring their prior progress; staff removal blocks self-rejoin until staff reinstates them. Cohorts remain pinned to their exact roadmap version.

1. Add ADR-007 and a non-destructive Prisma migration that hashes existing join codes, gives them a seven-day transition window, adds rotation/revocation metadata, and records enrollment end state.
2. Add authorized code rotation/revocation, safe cohort code status reads, distributed rate limits, roster reads, student withdrawal, and staff removal/reinstatement. Preserve role, tenant, parent, and exact-version checks.
3. Connect coordinator code controls and roster management, plus student withdrawal, to the frontend.
4. Verify migration preservation, invalid/expired/revoked codes, limits and fail-closed behavior, idempotent/rejoin rules, staff scope, archived pinned versions, and progress retention with PostgreSQL. Run required backend/frontend checks.
5. Commit implementation, then update only Layer 4 and select Phase 16. Do not start Phase 16.
