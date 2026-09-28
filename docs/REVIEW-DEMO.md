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
npx prisma migrate deploy
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

## Demonstrate organization administration

1. Sign in as the organization owner and open **Organizations → Manage organization**. Review the member directory.
2. Under **Invite staff**, enter a recipient's email and choose Coordinator, Admin, or Mentor. Copy the one-time code when it appears. It expires after seven days and cannot be retrieved later from the invitation list.
3. Sign in with a separate **Coordinator** account whose verified primary email matches the invitation. Open **Organizations**, enter the code under **Join an organization**, and accept it. The staff membership appears in the owner's directory.
4. Return as the owner to change the staff member's role or active status. An inactive member no longer sees the organization. Reactivate the member before using **Transfer ownership**; this explicit action moves owner access to the selected staff member.

Staff roles in this phase establish membership only. Resource permissions for Coordinator, Admin, and Mentor are assigned in Phase 13. Owner controls enforce permissions in the API, including when a user guesses a URL. The PostgreSQL integration test in `backend-js/tests/db/organization-management.test.js` checks invitation consumption, membership changes, tenant boundaries, and transfer.

With the API and frontend running, verify the same administration flow over HTTP from `backend-js/`:

```powershell
node --env-file-if-exists=.env scripts/smoke-organizations.js
$env:SMOKE_API_BASE='http://localhost:5173'; node --env-file-if-exists=.env scripts/smoke-organizations.js
```

The script creates temporary accounts and organizations, checks single-use invitations, tenant and inactive-member denial, and ownership transfer, then removes its own data. The second command checks the Vite proxy path used by the browser.

## What is still a preview

The original `/review` walkthrough and pages labeled **Sample** or **Illustrative scenario** use an example roadmap and peers. Those records are separate from the live learning workflow. Imports, deadlines, editable roadmap drafts, broader analytics, and Google frontend sign-in remain later work. Public Coordinator self-registration can still create a new organization for this local review; an existing organization's staff access requires an owner-issued invitation.

The Node API integration tests in `backend-js/tests/learning/routes.test.js` exercise create → publish → cohort → join → progress → report and check cross-organization and role boundaries.
