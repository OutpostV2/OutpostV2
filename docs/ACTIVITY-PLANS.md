# PDF activity plans

Coordinators can turn a selectable-text PDF into a roadmap draft. Parsing runs
locally; documents are not sent to an external AI service. Scanned documents
require OCR outside this first version.

## Local setup

Start Docker Desktop. Install dependencies with `npm ci` in `backend-js` and
`frontend`. In `backend-js`, generate the Prisma client and apply pending
additive migrations:

```powershell
npm run db:generate
npx prisma migrate deploy
```

Set these server-only values in the ignored `backend-js/.env`:

```dotenv
OUTPOST_OBJECT_ENDPOINT=http://127.0.0.1:9000
OUTPOST_OBJECT_BUCKET=outpost-activity-plans
OUTPOST_OBJECT_ACCESS_KEY=<MINIO_ROOT_USER from root .env>
OUTPOST_OBJECT_SECRET_KEY=<MINIO_ROOT_PASSWORD from root .env>
```

For local development the API creates the private bucket when missing. Outside
development/test, provision the bucket first and use a dedicated storage identity.
Never place storage credentials in frontend environment variables.

Run `npm run dev` from the repository root, then open
`http://localhost:5173`. The same launcher starts infrastructure, API and UI.

## Coordinator workflow

1. Sign in as a coordinator with an active owner, admin or coordinator membership
   in the organization. Registration alone does not grant organization access.
2. Open **Roadmaps → Import activity plan**, select the organization, enter a
   name, and upload one selectable-text PDF.
3. Wait for queued/extracting to become ready. The plan list lets you resume after
   navigation, refresh or a new sign-in. Failed extraction provides an explicit retry.
4. Compare the source pages with the proposed phases, weeks and activities. Correct
   titles, descriptions and ordering. Resolve unclassified text or exclude it with
   a reason; review warnings rather than assuming table ordering is correct.
5. Save and confirm your review, then choose **Create roadmap draft**. This creates
   one linked draft; repeating conversion returns the same draft.
6. Edit and save the roadmap. Review the complete outline, then deliberately
   publish its version. Publication does not enroll students.
7. Assign the published version to a cohort and share its join code. Students join
   and record their own completion. Coordinator reports use that persisted data.

Dates in a PDF remain text; configure actual cohort deadlines separately.
Published versions and existing cohort progress are never rewritten by an import.

## Limits and storage

The API enforces 10 MiB, 50 pages, 200,000 extracted characters and a 30-second
parser budget. Invalid, encrypted, image-only and empty files fail with actionable
errors. Complex layouts need human correction; this is a conservative extractor.

PostgreSQL stores workflow status, extracted text, review decisions, revisions and
the conversion link. Private MinIO objects retain the original PDF. The API
delivers source downloads only after checking current organization authorization.
Local Docker volumes preserve both stores when services stop. Do not remove
volumes or reset the database to update this feature.

The activity-plan importer is separate from the student roster Imports page.
It does not implement roster import, OCR, external model parsing, production
deployment, or a document-retention/deletion policy.
