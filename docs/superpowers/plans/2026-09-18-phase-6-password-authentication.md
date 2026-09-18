# Phase 6 password authentication implementation plan

**Goal:** Implement the approved password authentication flow in Layers 1–2 and ADR-003.
**Execution:** Inline, one verified project commit and one Layer 4 checkpoint per bounded task.

## Registration
- Write PostgreSQL API regression tests for normalized identifiers, Argon2id hashes, collisions, atomic writes, password policy, and secret-free validation errors; run them red.
- Add auth schemas, password hashing, transactional registration service, request database dependency, and register route.
- Add case-insensitive unique indexes for email and username via Alembic; no account merging or destructive normalization.
- Verify targeted and full backend tests, lint, types, migrations; commit and checkpoint login next.

## Login
- Write regression tests for email/username resolution, wrong/unknown credentials, and inactive users; run red.
- Add shared normalized lookup and Argon2id verification with a dummy hash for unknown identities.
- Verify and checkpoint session issuance next.

## Initial sessions and access credential
- Test persisted refresh hashes, secure cookie attributes, signed access validation, expiry, tampering, account state, and configuration failures.
- Issue a random 256-bit refresh value only through a Secure HttpOnly SameSite=Strict cookie scoped to /api/v1/auth.
- Sign 15-minute HS256 access JWTs with required issuer, audience, subject, session id, timestamps, token type, and unique id; require an external minimum-32-byte signing secret.
- Validate access against the live session and active user; expose /auth/me.
- Verify and checkpoint logout next.

## Logout
- Test current-session revocation and denial of its access credential, while other sessions remain usable.
- Add bearer-authenticated POST logout that revokes the session and deletes the refresh cookie.
- Verify the full backend suite, migration chain, wheel and Docker build; checkpoint Phase 7 without implementing rotation.

Password policy: 12–1024 characters; preserve every character including spaces.
Username policy: 3–64 ASCII letters/digits/underscore, normalized lowercase; email is validated and casefolded. No automatic identity linking.
Email delivery/verification workflows and refresh rotation stay in their chronological phases.
