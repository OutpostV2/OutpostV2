# ADR-006: Organization membership management and staff invitations

Status: Accepted for Phase 12–13 implementation (owner-issued invitation policy; revisit if the institution chooses an approval queue).
Date: 2026-09-28.

## Context

Outpost currently lets a coordinator account create an organization and become its owner, while a student joins through a cohort code. Self-selecting the coordinator account type is useful for a local review but cannot grant staff access to an existing tenant. ADR-002 makes the organization the tenant boundary and ADR-004 requires current membership and role checks on the API.

## Decision

An active owner can read organization details and a safe member directory, manage non-owner membership status and staff roles, transfer ownership, and issue or revoke staff invitations. Directory responses contain only display name, email, account type, role, status, and join time; they never expose credentials, sessions, or security metadata. Every route resolves the target organization and checks current owner membership on the server.

Staff invitations are owner-issued, high-entropy, single-use codes that expire after seven days. Store only a SHA-256 digest. An owner may rotate a pending invitation, invalidating its previous code; list responses never repeat the code. The code is returned only at creation so the owner can share it directly. The recipient must sign in with an active coordinator account whose **verified** primary email matches the invitation. Acceptance atomically creates one membership and consumes the invitation. Existing memberships, including inactive ones, are not silently upgraded by an invitation. Staff roles offered are `coordinator`, `admin`, and `mentor`; their initial resource permissions are defined below. Only `owner` has membership, invitation, and ownership-management authority.

Owners can change a non-owner coordinator account among staff roles and can activate or deactivate non-owner memberships. A student membership cannot be promoted into a staff role merely by editing it. Deactivation hides the tenant from the user's organization list and blocks live learning reads and writes that depend on that membership. Memberships are retained for history rather than hard-deleted. The owner membership cannot be deactivated, deleted, or demoted through general member controls.

Ownership transfer is an explicit atomic action to an active staff membership in the same organization. It promotes the target to owner and demotes the previous owner to coordinator in one PostgreSQL transaction, preserving at least one owner. The new owner receives authority from the next request's database check; stale frontend state grants nothing.

### Phase 13 resource permissions

The API resolves the active organization membership for every tenant request; account type by itself never grants access. A `student` account may hold only the `student` membership role. A `coordinator` account may hold `owner`, `admin`, `coordinator`, or `mentor`. A mismatch denies access.

- `owner` retains organization detail, member, invitation, and ownership-transfer controls, and can manage learning resources and view cohort reports.
- `admin` and `coordinator` can create/list published roadmaps and cohorts and view cohort reports in their active organization. They cannot use owner-only member, invitation, or ownership controls.
- `mentor` cannot read or change learning resources or cohort reports yet. The schema has no persisted mentor-to-cohort assignment, so the API denies these operations until that relationship is modeled and authorized.
- `student` can join an active cohort through its code, read personal progress, and update topics only in an active published cohort version for which the student has both an active student membership and active enrollment. Students cannot use staff reports or administration routes.

The illustrative review scenario is explicitly separate from tenant records: active student and coordinator accounts may read it, while only a student may change that account's own illustrative progress. Suspended users are rejected by the live authentication middleware before these policies run.

## Consequences and verification

The invitation table and unique organization/email key require a non-destructive Prisma migration. The current local review may still allow public coordinator registration to create a new organization; it does not grant access to an existing one. A production institution may later require owner provisioning or an approval queue, which needs a separate product decision and migration of onboarding UX.

Test valid and duplicate invitation use, expiry/revocation, verified-email matching, membership uniqueness, inactive membership denial, owner self-protection, atomic transfer, cross-tenant IDs, and safe responses. Phase 13 adds PostgreSQL-backed authorization coverage for each role family, suspended sessions, cohort/version/topic parent integrity, and frontend-facing API denials. Frontend controls are never a substitute for backend policy.
