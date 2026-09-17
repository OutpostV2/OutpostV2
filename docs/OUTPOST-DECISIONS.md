# Outpost Engineering Decisions

This document indexes significant architectural and engineering decisions
made while building Outpost.

Routine task history belongs in Git and Layer 4, not here.

## Decision Index

- [ADR-001: Modular monolith and cloud independence](decisions/ADR-001-modular-monolith-cloud-independence.md) — Accepted. Defines module boundaries, provider interfaces, state placement, and deployment portability.
- [ADR-002: Organization-based tenant model](decisions/ADR-002-organization-tenant-model.md) — Accepted. Defines organization ownership, membership scope, and tenant-isolation invariants.
- [ADR-003: Outpost-owned authentication model](decisions/ADR-003-authentication-model.md) — Accepted. Defines canonical identity, authentication methods, explicit linking, and rotating sessions.
- [ADR-004: Centralized tenant-aware authorization](decisions/ADR-004-tenant-aware-authorization.md) — Accepted. Defines reusable policies, resource-scope checks, and backend enforcement.
