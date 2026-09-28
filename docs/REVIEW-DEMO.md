# Outpost college review: live learning workflow

This walkthrough demonstrates a real coordinator-to-student learning flow backed by PostgreSQL. Use two accounts: one Coordinator and one Student. The public review scenario remains available separately and contains illustrative peers.

## Start locally

From the repository root, start the services:

```powershell
docker compose up --detach postgres valkey
```

In one terminal:

```powershell
cd backend-js
npm ci
npm run db:generate
npx prisma migrate status
npm run dev
```

In another terminal:

```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173`. If your installation uses another Vite port or host, use the URL printed by Vite.

## Demonstrate the full loop

1. Register a **Coordinator** account, then sign in. Registration returns to the login page; login opens the Coordinator dashboard.
2. Open **Live learning** in the sidebar. Create an organization, publish a roadmap with one or more topics, and create a cohort assigned to that roadmap version.
3. Copy the cohort's student join code. Sign out.
4. Register a separate **Student** account, then sign in. Open **My assigned learning** and enter the join code.
5. Mark a topic complete. Refresh the page to show that completion persists.
6. Sign out and sign back in as the Coordinator. Open **Live learning → View live progress** for that cohort. The student's completion appears in the cohort report. Students who have joined but completed nothing appear with 0% progress.

The organization, roadmap version, cohort, enrollment, and topic progress are stored in PostgreSQL. The cohort pins the exact published roadmap version. The join code is the only enrollment path in this slice; it avoids exposing a searchable account directory.

With the API running, repeat the live acceptance check from `backend-js/`:

```powershell
node --env-file-if-exists=.env scripts/smoke-learning.js
```

It creates temporary coordinator/student accounts and organizations, checks registration conflicts, refresh-session restoration, session revocation and fresh sign-in, zero-progress reporting, role and tenant boundaries, and separation from the illustrative review. It removes its own records afterward.

## What is still a preview

The original `/review` walkthrough and pages labeled **Sample** or **Illustrative scenario** use an example roadmap and peers. Those records are separate from the live learning workflow. Imports, deadlines, editable roadmap drafts, broader analytics, and Google frontend sign-in remain later work. Public Coordinator self-registration is suitable for this local review; real college deployment needs staff invitations or approval.

The Node API integration tests in `backend-js/tests/learning/routes.test.js` exercise create → publish → cohort → join → progress → report and check cross-organization and role boundaries.
