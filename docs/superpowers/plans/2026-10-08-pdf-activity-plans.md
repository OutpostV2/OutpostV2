# PDF activity plans and UI implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development for the independent backend and requested Astra frontend tasks.

**Goal:** Deliver selectable-text PDF → reviewed draft → publication → cohort learning, with a professional responsive interface.
**Architecture:** Private MinIO source storage, PostgreSQL durable import records, bounded PDF.js worker-thread parsing and conservative proposals; existing immutable roadmap lifecycle.
**Tech Stack:** Express, Prisma/PostgreSQL, MinIO, PDF.js, React/Vite, Vitest, Edge/Playwright.
**Spec:** docs/superpowers/specs/2026-10-08-pdf-activity-plans-and-ui-design.md

## Global Constraints
Preserve existing data, published snapshots, authentication and tenancy. No resets, OCR, external runtime AI, generated images or Phase 19. Keep root npm run dev working. Changes are isolated on codex/pdf-activity-plans. Only Layer 4 of the master guide changes after verification.

## Review Focus
Malicious/corrupt/encrypted/scanned PDFs; truncated or ambiguously ordered text; guessed tenant IDs and suspended memberships; conversion races and stale revisions; interrupted jobs, object compensation and source privacy; mobile navigation/focus and dirty-edit preservation.

## Shared API contract
Base /api/v1/organizations/:organizationId/activity-plans.
GET base returns {plans,limits:{max_bytes:10485760,max_pages:50,max_characters:200000}}.
POST base multipart fields name and file returns 201 plan.
GET /:id returns plan.
PATCH /:id accepts {revision,name,proposal,review_items,review_confirmed}, returns updated plan; revision conflicts return 409.
POST /:id/retry accepts {revision}, returns queued plan.
GET /:id/source returns authenticated PDF attachment.
POST /:id/convert accepts {revision}, returns {roadmap_id,version_id,version_number:1}; repeat conversion returns existing link.
Plan: {id,organization_id,name,filename,status,page_count,failure,revision,created_at,updated_at,pages,proposal,review_items,warnings,review_confirmed,roadmap_id,version_id}.
Statuses queued/extracting/ready/failed/converted. failure null or {code,message}.
pages [{page_number,text,lines:[{id,text}]}].
proposal {phases:[{id,title,weeks:[{id,title,topics:[{id,title,description,source_refs:[reviewItemId]}]}]}]}.
review_items [{id,page_number,text,disposition:'unresolved'|'included'|'excluded',topic_id:null|topicId,reason:''}].
warnings [{id,message,page_number,review_item_id}]. Source and IDs immutable on edits; excluded items require reason, every included activity references an existing topic, headings may have null topic_id. Review must be explicitly confirmed and unresolved items resolved before conversion. Dates remain descriptions.

### Task 1: Durable backend workflow
Ownership backend-js only. Write failing parser/authorization/conversion/storage tests first; run and observe RED. Add additive Prisma migration and bounded PDF extraction worker, private storage, durable recoverable processor and authenticated routes. Preserve existing hierarchy limits and atomic organization/plan locking. Verify targeted tests GREEN, full backend and PostgreSQL integration gates. Commit backend files only.

### Task 2: Astra frontend refinement
Ownership frontend only. Write meaningful interaction/API tests first and observe RED. Implement authenticated FormData/blob client, list-first roadmaps, upload/resumable review/source/correction/conversion UI integrated with existing editor. Refine marketing, auth, workspace/reporting and accessible drawer; provide complete publish preview and unsaved-edit protection. Verify frontend tests/lint/build. Commit frontend files only.

### Task 3: Integration and fresh review
Deploy additive migration and configure ignored local MinIO values without printing credentials. Run backend/frontend suites, audits, migration validation, lint/build. Start root dev and prove real PDF→review→edit→publish→cohort→student completion→report with refresh/new sign-in. Capture desktop/mobile Edge screenshots, Astra visual review, fresh whole-branch code review and fix material findings. Remove disposable fixtures. Commit fixes and usage documentation.

### Task 4: Verified handoff
Commit product/docs changes, then update only Layer 4 in a separate checkpoint commit per self-update rule. Record actual evidence and limitations; retain Phase 19 as pending. The user's 2026-10-31 instruction supersedes the earlier no-push limit: push the verified feature to origin on codex/pdf-activity-plans. Preserve unrelated account-linking work in the other checkout.
