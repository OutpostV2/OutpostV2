# ADR-006: Organization membership management and staff invitations

Status: Accepted for Phase 12 implementation (owner-issued invitation policy; revisit if the institution chooses an approval queue).
Date: 2026-09-28.

## Context

Outpost currently lets a coordinator account create an organization and become its owner, while a student joins through a cohort code. Self-selecting the coordinator account type is useful for a local review but cannot grant staff access to an existing tenant. ADR-002 makes the organization the tenant boundary and ADR-004 requires current membership and role checks on the API.

## Decision

An active owner can read organization details and a safe member directory, manage non-owner membership status and staff roles, transfer ownership, and issue or revoke staff invitations. Directory responses contain only display name, email, account type, role, status, and join time; they never expose credentials, sessions, or security metadata. Every route resolves the target organization and checks current owner membership on the server.

Staff invitations are owner-issued, high-entropy, single-use codes that expire after seven days. Store only a SHA-256 digest. An owner may rotate a pending invitation, invalidating its previous code; list responses never repeat the code. The code is returned only at creation so the owner can share it directly. The recipient must sign in with an active coordinator account whose **verified** primary email matches the invitation. Acceptance atomically creates one membership and consumes the invitation. Existing memberships, including inactive ones, are not silently upgraded by an invitation. Staff roles offered in this phase are `coordinator`, `admin`, and `mentor`; Phase 13 defines their resource permissions. Only `owner` has management authority now.

Owners can change a non-owner coordinator account among staff roles and can activate or deactivate non-owner memberships. A student membership cannot be promoted into a staff role merely by editing it. Deactivation hides the tenant from the user's organization list and blocks live learning reads and writes that depend on that membership. Memberships are retained for history rather than hard-deleted. The owner membership cannot be deactivated, deleted, or demoted through general member controls.

Ownership transfer is an explicit atomic action to an active staff membership in the same organization. It promotes the target to owner and demotes the previous owner to coordinator in one PostgreSQL transaction, preserving at least one owner. The new owner receives authority from the next request's database check; stale frontend state grants nothing.

## Consequences and verification

The invitation table and unique organization/email key require a non-destructive Prisma migration. The current local review may still allow public coordinator registration to create a new organization; it does not grant access to an existing one. A production institution may later require owner provisioning or an approval queue, which needs a separate product decision and migration of onboarding UX.

Test valid and duplicate invitation use, expiry/revocation, verified-email matching, membership uniqueness, inactive membership denial, owner self-protection, atomic transfer, cross-tenant IDs, and safe responses. Exercise these against PostgreSQL and through the browser-facing API; frontend controls are never a substitute for backend policy.
