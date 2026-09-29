# ADR-007: Cohort join-code and enrollment governance

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

Cohort join codes previously remained reusable plaintext values with no expiry or
revocation lifecycle. Enrollments had no recorded end state, and students could
not leave a cohort. These gaps made code leakage difficult to contain and made
enrollment changes ambiguous while progress remained tied to the assigned
roadmap version.

## Decisions

1. Join codes contain 256 bits from a cryptographically secure random source and
   are encoded as base64url. Only the create or rotate response reveals the raw
   code. PostgreSQL stores its SHA-256 digest. Existing codes are converted to
   digests in place and receive a seven-day transition period.
2. New codes expire seven days after creation. Rotation replaces the digest and
   invalidates the previous code. Revocation clears the digest and expiry and
   records a revocation timestamp. Invalid, expired, and revoked codes return
   the same not-found response.
3. Join attempts are limited in Valkey to 30 per IP address and 10 per account
   in a 15-minute window. Rate-limit keys contain hashed identifiers. Joining
   fails closed if Valkey is unavailable.
4. Enrollment is unique per cohort and user. Students can withdraw themselves;
   authorized learning staff can remove or reinstate students. These actions
   retain topic progress. Rejoining after student withdrawal reactivates the
   existing enrollment and restores its progress. Staff removal prevents
   self-rejoin until staff reinstates the enrollment.
5. Cohorts remain pinned to their assigned roadmap version. Join and enrollment
   changes never adopt a newer version or rewrite progress identity.

## Consequences

The API reveals join codes only in the create and rotate responses. Coordinator
views expose status and expiration metadata, not the code. Enrollment history
records the actor and reason for termination where available, while legacy
inactive enrollments are retained and labeled `legacy_inactive`.

## Verification

Phase 15 migration and route tests verify code hashing and transition expiry,
revocation and rotation behavior, rate-limit failure handling, tenant scope,
withdrawal/reinstatement history, and preservation of cohort version and topic
progress.
