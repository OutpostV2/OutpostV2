# Outpost college review: live learning workflow

This walkthrough demonstrates a real coordinator-to-student learning flow backed by PostgreSQL. Use two accounts: one Coordinator and one Student. The public review scenario remains available separately and contains illustrative peers.

## Start locally

From the repository root, start the services:

```powershell
docker compose up --detach postgres valkey
```

In one terminal:

```powershell
cd backend
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd frontend
npm run dev
```

Open `http://127.0.0.1:5173`. If your installation uses another Vite port, use the URL printed by Vite.

## Demonstrate the full loop

1. Register a **Coordinator** account, then sign in. Registration returns to the login page; login opens the Coordinator dashboard.
2. Open **Live learning** in the sidebar. Create an organization, publish a roadmap with one or more topics, and create a cohort assigned to that roadmap version.
3. Copy the cohort's student join code. Sign out.
4. Register a separate **Student** account, then sign in. Open **My assigned learning** and enter the join code.
5. Mark a topic complete. Refresh the page to show that completion persists.
6. Sign out and sign back in as the Coordinator. Open **Live learning → View live progress** for that cohort. The student's completion appears in the cohort report. Students who have joined but completed nothing appear with 0% progress.

The organization, roadmap version, cohort, enrollment, and topic progress are stored in PostgreSQL. The cohort pins the exact published roadmap version. The join code is the only enrollment path in this slice; it avoids exposing a searchable account directory.

## What is still a preview

The original `/review` walkthrough and pages labeled **Sample** or **Illustrative scenario** use an example roadmap and peers. Those records are separate from the live learning workflow. Imports, deadlines, editable roadmap drafts, broader analytics, and Google frontend sign-in remain later work. Public Coordinator self-registration is suitable for this local review; real college deployment needs staff invitations or approval.

The backend integration test `tests/integration/test_live_learning_workflow.py` exercises create → publish → cohort → join → progress → report and checks cross-organization and role boundaries.
