# PDF activity plans and frontend refinement

Status: Approved for implementation by the user's “implement it” instruction.
Date: 2026-10-08.

## Intended outcome and scope

The coordinator uploads a selectable-text activity-plan PDF, checks its extracted
content, converts it into an editable roadmap draft, modifies the draft, reviews
it and deliberately publishes a version. Students then use the existing cohort,
progress, activity and deadline workflows. The original PDF remains available
to authorized staff for checking the draft against its source.

The user also requests Astra to refine the frontend and review it professionally.
Astra supplies the design and UI implementation/review work. Preserve the
forest/sage/lime identity and system font; add no generated images. Improve the
marketing site, authentication, shared workspace and existing learning/reporting
pages rather than building a disconnected prototype.

This is a user-requested feature amendment after Phase 18. Phase 19 account linking
remains pending. Existing guide Layers 1–3, users, progress and published versions
remain governing context. Roster imports are a separate feature: the existing
Imports page must not be relabeled as a working student-roster importer.

## Chosen approach and alternatives

Use local PDF text extraction with conservative rule-based structure suggestions,
source references and mandatory human review. This requires no external model
API key and keeps uploaded content inside the local application infrastructure.
PDF.js has an official Node text-extraction example:
[Mozilla PDF.js getinfo](https://github.com/mozilla/pdf.js/blob/master/examples/node/getinfo.mjs).

An external model could improve interpretation of irregular documents, but would
introduce provider configuration, cost and document transmission. A completely
manual paste/editor workflow would be simpler but would not satisfy PDF conversion.
Neither is the initial implementation. Astra is the development/design model,
not an external service receiving uploaded PDFs at runtime.

## Coordinator journey

1. Roadmaps is a list-first page with **Import activity plan** and **Create manually**.
2. Import page asks for the authorized organization, plan name and PDF. Show the
   selectable-text requirement and actual limits before submission.
3. Processing states are real: queued, extracting, ready, failed. Show no fabricated
   percentage. Failed work retains useful context and offers an explicit retry.
   A visible uploaded-plan list offers Continue review/Open draft, so navigation,
   refresh or another sign-in does not strand unfinished imports.
4. Review extracted page text and proposed modules/weeks/activities. Show page
   references and unclassified-content warnings. Add, remove, regroup or reorder
   items; mark irrelevant source material as excluded with an explicit reason.
5. **Create roadmap draft** persists a version-1 draft and opens the existing
   roadmap editor. Conversion is idempotent: retry returns the same linked draft.
6. Edit titles/descriptions and phase/week/topic order. Collapsible hierarchy and
   persistent save status/actions keep the editor manageable on mobile.
7. **Review draft** shows the complete read-only structure and source warnings,
   with links back to affected items. Save changes before reviewing/publishing.
8. **Publish version 1** uses the existing publication policy. Success offers
   **Assign to cohort**. Publication alone does not create or enroll a cohort.

The import source and converted snapshot are separate. Editing or uploading a new
plan does not mutate a published version. Dates in the PDF remain source text;
they do not silently create deadlines. Staff can use existing cohort scheduling
after assignment.

## Extraction and review contract

- Initial limits: one PDF, 10 MiB, 50 pages, 200,000 extracted characters. Limits
  are enforced server-side and returned to the UI; oversize inputs are rejected,
  never silently truncated. Parsing has a 30-second budget and bounded concurrency.
- Accept valid PDF bytes with extractable text. Reject corrupt, encrypted,
  image-only and effectively empty PDFs with distinct actionable messages. Mixed
  PDFs flag pages lacking text so incomplete extraction is visible.
- Extract page-indexed text items and reconstruct lines using their positions.
  Recognize explicit module/phase headings, week/session headings and numbered
  lab/activity/exercise entries. Preserve continuation text as descriptions.
- Repeated headers/footers and uncertain table ordering are review warnings.
  Preserve unclassified text in the source panel. Do not invent activity titles,
  grading criteria, dates, completion or academic meaning.
- Unrecognized structure receives a clearly marked suggested grouping. The user
  must resolve or explicitly exclude unclassified material before conversion.
- Reuse roadmap validation: at most 12 phases, 52 weeks per phase, 24 topics per
  week and 500 total topics; title 2–200 characters, description at most 1,000.
  Content exceeding these limits requires visible manual adjustment.
- Review edits are persisted with revision checks. A stale edit or conversion
  returns a conflict instead of silently overwriting another coordinator's work.
  Stable review-item identifiers retain page/warning references through reordering;
  following a warning focuses its affected field. Explain disabled conversion and
  publication with actionable validation rather than an unexplained disabled button.
  Display Saving/Saved/Unsaved changes/Save failed; preserve content on recoverable
  errors and guard navigation or version changes while edits remain unsaved.

## Persistence, authorization and processing

Add an organization-owned ActivityPlan record containing uploader, original
filename, private object key, SHA-256, byte count, page count, status, timestamps,
extracted pages, proposed hierarchy, review decisions, revision and linked draft.
Use an additive Prisma migration. PostgreSQL owns workflow state; MinIO-compatible
object storage holds the source PDF, following ADR-001. No durable container-local
files and no public bucket. Object storage settings stay server-side in ignored
environment files, with documented examples.

Upload and read operations require an active organization membership with owner,
admin or coordinator role. Account type alone grants nothing. Recheck authorization
for polling, retry, source download, review save and conversion. Students, mentors,
other organizations and inactive memberships cannot access plan content.

Bound upload size before allocating a full buffer; check PDF signature and parse
validity. Treat filenames and extracted content as data, escape rendered text and
do not fetch links embedded in PDFs. Source download is authenticated attachment
delivery with nosniff; initial source preview is extracted page text, not an
unrestricted embedded PDF execution surface.

Use a bounded background processor with durable jobs and isolated parser workers.
The existing root launcher remains the entry point; startup recovers interrupted
jobs into a visible retryable state. Do not introduce AWS or a paid provider.
Compensate an object upload if its database creation fails. Recheck authorization
and plan state under transaction locks before creating the roadmap/version/tree
and conversion link together. Do not modify published curriculum triggers.

Proposed API family under `/api/v1/organizations/:organizationId/activity-plans`:
upload, list, read/status, save reviewed proposal, retry failed extraction,
authenticated source download and convert to draft. Return safe structured errors;
never expose storage credentials or raw exception traces. Converted plans retain
their source and immutable conversion link; a new upload creates a new plan.

## Astra frontend design

Direction: a quiet campus workspace with a clear learning outline and restrained
lime accents. Use the same tokens and shared controls across all routes.

| Element        | Specification                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typography     | Hero 40–44px desktop / 32px mobile; page title 28–30px / 24–26px; section 18–20px; body 15–16px; controls 14px; metadata at least 12px                              |
| Spacing        | 4, 8, 12, 16, 24, 32, 48px scale; 32px desktop and 16px mobile content padding                                                                                      |
| Layout         | Marketing max 1160px; workspace max 1200px; sidebar 232px; topbar 64px; 8px controls and 12px cards; minimal shadows                                                |
| Controls       | Visible labels, readable errors, consistent buttons, 44px primary touch targets, focus styles including select and textarea                                         |
| Marketing      | Short product explanation, Get started and View demo; labeled example roadmap instead of a second slogan panel; registration closing CTA                            |
| Authentication | Task-specific h1; 440–480px form; form-first mobile layout; smaller supporting story; preserve recovery/provider links                                              |
| Navigation     | Plain role badge, useful organization context, route-specific breadcrumb, grouped navigation; mobile drawer with inert closed content, Escape and focus restoration |
| Roadmaps       | List-first overview, focused create/import flow, shared filtering and clear draft/published/version status                                                          |
| Draft editor   | Collapsible phase/week outline, multiline descriptions, named move controls, nested deletion undo/confirmation, sticky save/review bar                              |
| Source review  | Source text beside the draft on desktop; Draft/Source tabs on mobile; page references and explicit warnings                                                         |
| Reports        | Compact shared filter toolbar, readable rows and labeled mobile layouts; avoid repeated explanatory panels                                                          |

Existing server role checks and API connections remain intact. No fake cohort
metrics, fabricated progress or decorative controls without behavior. Illustrative
review content stays explicitly labeled and separate from live data.
Desktop auth panels are top-aligned. Mobile version history is a compact selector.
The open mobile drawer traps focus and makes background content inert; closing it
restores focus to the trigger. Empty dashboards present one contextual primary
action, choosing roadmap preparation when there is not yet a published roadmap.

## Current UI evidence and review limits

Fresh Edge screenshots were captured at 1440px desktop and 390px mobile with a
disposable coordinator and three-topic draft; test-owned records were removed.
Screenshots are review evidence, not generated product images. No design-qa.md was
found in the repository inventory.

Observed: the mobile editor is about 2,560px long for three topics; version/context
panels precede the editing task; reorder/remove controls wrap apart. Desktop
descriptions are clipped inside single-line inputs. The homepage repeats broad
marketing slogans where concrete product information would be more useful.

Code-derived accessibility risks: offscreen mobile links remain keyboard reachable,
drawer focus/Escape handling is incomplete, move arrows lack descriptive names
and focus styling omits some field types. These require keyboard testing; screenshots
alone do not establish accessibility compliance.

The settled coordinator empty state is clear but its full-width selector and large
card consume unnecessary space. Manage live learning and Create a cohort compete
as primary actions; use one contextual next step. Astra inspected and accepted
all six captures after the initial loading-state coordinator capture was rejected
and replaced.

Local audit evidence, captured before redesign:

1. Home — repeated messaging and three-card sections.
   ![Current homepage](C:/Users/priya/.codex/visualizations/2026/09/16/01a0ac4c-e83f-72e0-a682-c2c5cc97db94/pdf-ui-before-home.png)
2. Register — readable form with uneven panel alignment.
   ![Current registration page](C:/Users/priya/.codex/visualizations/2026/09/16/01a0ac4c-e83f-72e0-a682-c2c5cc97db94/pdf-ui-before-register.png)
3. Coordinator — settled empty state and competing next actions.
   ![Current coordinator page](C:/Users/priya/.codex/visualizations/2026/09/16/01a0ac4c-e83f-72e0-a682-c2c5cc97db94/pdf-ui-before-coordinator.png)
4. Roadmaps — creation form takes priority over existing work.
   ![Current roadmap list](C:/Users/priya/.codex/visualizations/2026/09/16/01a0ac4c-e83f-72e0-a682-c2c5cc97db94/pdf-ui-before-roadmaps.png)
5. Desktop editor — clipped descriptions and repetitive controls.
   ![Current desktop editor](C:/Users/priya/.codex/visualizations/2026/09/16/01a0ac4c-e83f-72e0-a682-c2c5cc97db94/pdf-ui-before-editor.png)
6. Mobile editor — excessive scrolling and controls losing their grouping.
   ![Current mobile editor](C:/Users/priya/.codex/visualizations/2026/09/16/01a0ac4c-e83f-72e0-a682-c2c5cc97db94/pdf-ui-before-editor-mobile.png)

## Verification and completion criteria

- PDF fixtures: explicit phase/week structure, numbered activities, table-like
  text, repeated headers, Unicode, mixed pages, scanned/empty/encrypted/corrupt
  inputs, size/page/text/time limits and parser failure recovery.
- PostgreSQL integration: tenant/role denials, inactive memberships, source privacy,
  stale revision conflicts, double/concurrent conversion, atomic rollback, source
  retention and immutable published versions.
- Real browser: upload → extraction → edit → convert → save → review → publish →
  cohort assignment → student learning → completion → coordinator report; verify
  refresh/new-sign-in persistence and every recoverable failure path.
- Astra professional visual review at 360/390px, 768px and 1280/1440px; inspect
  settled screenshots, field clipping, hierarchy, spacing and actual interactions.
  Keyboard navigation, 200% zoom, focus visibility and contained overflow are checked
  separately. Fix material findings before completion.
- Full backend, PostgreSQL and frontend suites, lint/build, dependency checks and
  additive migration validation. Commit coherent milestones and update only Layer 4
  of the master guide with actual evidence. Existing Phases 1–18 remain functional.

Implementation starts after this written specification is reviewed, followed by
the implementation plan and execution handoff required by the brainstorming workflow.
