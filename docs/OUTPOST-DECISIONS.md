# Outpost Engineering Decisions

This document indexes significant architectural and engineering decisions
made while building Outpost.

Routine task history belongs in Git and Layer 4, not here.

## Decision Index

- [ADR-001: Modular monolith and cloud independence](decisions/ADR-001-modular-monolith-cloud-independence.md) — Accepted. Defines module boundaries, provider interfaces, state placement, and deployment portability.
- [ADR-002: Organization-based tenant model](decisions/ADR-002-organization-tenant-model.md) — Accepted. Defines organization ownership, membership scope, and tenant-isolation invariants.
- [ADR-003: Outpost-owned authentication model](decisions/ADR-003-authentication-model.md) — Accepted. Defines canonical identity, authentication methods, explicit linking, rotating sessions, and Phase 6 signed access credentials with live revocation/account-state checks.
- [ADR-004: Centralized tenant-aware authorization](decisions/ADR-004-tenant-aware-authorization.md) — Accepted. Defines reusable policies, resource-scope checks, and backend enforcement.
- [ADR-005: Roadmap versioning and publication](decisions/ADR-005-roadmap-versioning.md) — Accepted. Defines immutable curriculum snapshots, cohort pinning, archival, and progress identity.
- [ADR-006: Organization membership management and staff invitations](decisions/ADR-006-organization-membership-management.md) — Accepted. Defines owner controls, verified-email invitations, deactivation, and atomic ownership transfer.
- [ADR-007: Cohort join-code and enrollment governance](decisions/ADR-007-cohort-join-and-enrollment-governance.md) — Accepted. Defines join-code lifecycle and rate limits, enrollment withdrawal/removal, and progress-preserving rejoin rules.
