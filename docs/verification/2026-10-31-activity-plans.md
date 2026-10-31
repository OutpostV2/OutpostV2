# Activity-plan feature verification — 2026-10-31

## Delivered workflow

Selectable-text PDF upload → durable extraction → source review and correction →
one editable roadmap draft → save → complete publication preview → explicit
publication → organization/version-prefilled cohort setup → student enrollment
and completion → coordinator reporting.

The source stays private in MinIO; PostgreSQL owns workflow, review revision and
conversion state. The parser runs locally in a bounded worker thread. Existing
published versions, cohort assignments and progress are preserved. No OCR,
external model provider, generated imagery or account-linking feature was added.

## Verification performed

- Backend final run with PostgreSQL/MinIO settings: **74 passed, none skipped**.
  The environment-free unit run separately passed 61 and skipped 13 integration
  cases, then the fully configured run exercised all of them.
- PostgreSQL/MinIO integration: **12 passed**, including tenant/role denials,
  Unicode attachment delivery, immutable source references, stale revisions,
  concurrent/idempotent conversion, mid-conversion rollback and worker recovery.
- Frontend: **71 passed**. Formatting, ESLint and production build passed.
- Backend dependency audit: **zero advisories**. Frontend production dependency
  audit: **zero advisories**.
- All six migrations deployed to a fresh disposable PostgreSQL database, which
  was removed afterward. Existing database schema comparison reported no drift.
  The existing database was not reset.
- Root `npm run dev` started Docker, API and Vite. A real Edge browser completed
  the delivered workflow using disposable coordinator/student accounts, a real
  generated text PDF, PostgreSQL and MinIO.
- Original source bytes matched the upload; authenticated attachment/nosniff
  headers and the frontend download worked. Student source access returned 403.
- Refresh and a fresh sign-in preserved publication and completion. Repeated
  conversion returned the same linked draft. Coordinator reporting showed the
  saved 1/2 completion, not fixture metrics.
- Settled screenshots were inspected at 360/390, 768 and 1280/1440 pixels, plus
  720px layout reflow equivalent to a 200% desktop view. No page overflow.
  Draft/Source arrow-key navigation, drawer focus containment, Escape focus
  restoration and inert closed navigation passed. Sample primary-action text
  contrast measured 8.19:1. This is targeted verification, not accessibility
  certification.
- Disposable browser users, organizations and source objects were removed.
  Existing local credentials and service volumes were preserved.

Commands used in the relevant application folders:

```powershell
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --pool=forks --testTimeout=20000
# All backend cases with PostgreSQL and MinIO enabled:
node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run --maxWorkers=1 --pool=forks --testTimeout=30000
# Backend integration (requires ignored local .env):
node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run tests/db --maxWorkers=1 --pool=forks --testTimeout=30000
# Frontend:
npm run format:check
npm run lint
npm run build
# Backend:
npm audit --audit-level=moderate
node node_modules/prisma/build/index.js migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code
# Frontend runtime dependencies:
npm audit --omit=dev --audit-level=moderate
```

## Material issues fixed during verification

- Node watch-mode dependency notifications were mistaken for parser results.
  The worker now ignores non-result messages; regression test observed failing
  then passing, followed by a successful real upload under the root launcher.
- Large Unicode reviews exceeded the ordinary JSON-body limit. Review PATCH
  requests now have a bounded 4 MiB allowance and structured 413 errors; other
  JSON endpoints retain their 1 MiB limit. Regression observed RED → GREEN.
- The publish action led to reporting instead of cohort setup. It now opens
  setup with the authorized organization and exact published version selected.
  Both link and selection regressions observed RED → GREEN.
- Dirty organization navigation, review confirmation invalidation, source
  reference consistency, stale processing recovery and cross-instance extraction
  concurrency received regression coverage and fixes.
- Tablet source review now uses tabs; inputs/selects stay inside their cards.
  Sidebar context identifies the selected organization, role display is plain,
  and roadmap source links have distinct spacing.

## Review and remaining limits

Astra contributed the frontend refinement and regression work. Final independent
agent review attempts failed because workspace credits were exhausted. The final
code and screenshot pass was a self-review by the completing agent; no independent
Astra final approval is claimed.

The full frontend development-tool audit still reports six moderate dependency
entries from one minimatch advisory in the ESLint chain. No compatible upstream
fix was offered by npm; a forced downgrade/major override was not applied.
Production dependency audits are clean. Track this development-tool issue when
ESLint publishes compatible dependency updates.

Complex PDF tables still need human correction. Document retention/deletion,
OCR, roster imports, account linking and production operations remain separate
future work. Unrelated unfinished identity changes in the other managed checkout
were preserved and excluded from this feature.
