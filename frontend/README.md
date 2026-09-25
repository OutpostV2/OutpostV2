# Outpost frontend

Responsive React, JavaScript/JSX, and Vite frontend for the Outpost college-review build. Coordinator and Student accounts now have a live PostgreSQL-backed learning flow. The pages follow the frontend phases in `docs/OUTPOST-MASTER-BUILD-PROMPT.md` and use a shared green visual system without generated images.

## Run locally

From `frontend/`, run `npm install` and `npm run dev`. Start the Node/Express backend in `backend-js/` separately. Vite proxies `/api` to `http://127.0.0.1:8000` by default (see `vite.config.js`). Open the URL printed by Vite, usually `http://localhost:5173`.

## Page map

| Route                                                                                                                                       | File                                                        | Data                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `/`                                                                                                                                         | `src/pages/marketing/MarketingPage.jsx`                     | Static public content                                               |
| `/register`, `/login`                                                                                                                       | `src/features/auth/PasswordAuthPage.jsx`                    | Real password auth API                                              |
| `/auth/phone`                                                                                                                               | `src/features/auth/PhoneLoginPage.jsx`                      | Real OTP request/verify API; code delivery requires an SMS provider |
| `/auth/google`                                                                                                                              | `src/features/auth/GoogleLoginPage.jsx`                     | Setup guidance; frontend OAuth callback pending                     |
| `/auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email` (also `/reset-password` and `/verify-email` for existing email links) | `src/features/auth/AccountRecoveryPage.jsx`                 | Real recovery/verification APIs; email delivery must be configured  |
| `/review/*`                                                                                                                                 | `src/features/review/ReviewPage.jsx`                        | Existing review scenario                                            |
| `/app/account`                                                                                                                              | `src/features/auth/AccountPage.jsx`                         | Real user and session APIs                                          |
| /app/organizations                                                                                                                          | src/features/workspace/pages/OrganizationsPage.jsx          | Real organization memberships                                       |
| `/app/student`                                                                                                                              | `src/features/workspace/pages/StudentDashboardPage.jsx`     | Real saved review progress                                          |
| `/app/student/roadmap`                                                                                                                      | `src/features/workspace/pages/StudentRoadmapPage.jsx`       | Real review topics and progress updates                             |
| `/app/student/activity`                                                                                                                     | `src/features/workspace/pages/StudentActivityPage.jsx`      | Derived from saved topic completion times                           |
| `/app/student/deadlines`                                                                                                                    | `src/features/workspace/pages/StudentDeadlinesPage.jsx`     | Empty state; deadline API pending                                   |
| `/app/coordinator`                                                                                                                          | `src/features/workspace/pages/CoordinatorDashboardPage.jsx` | Illustrative cohort data                                            |
| `/app/coordinator/cohorts`                                                                                                                  | `src/features/workspace/pages/CohortsPage.jsx`              | Illustrative cohort; management API pending                         |
| `/app/coordinator/roadmaps`                                                                                                                 | `src/features/workspace/pages/RoadmapsPage.jsx`             | Illustrative roadmap; management API pending                        |
| `/app/coordinator/roadmaps/review/versions`                                                                                                 | `src/features/workspace/pages/RoadmapVersionsPage.jsx`      | Version structure preview; publishing API pending                   |
| `/app/coordinator/imports`                                                                                                                  | `src/features/workspace/pages/ImportsPage.jsx`              | Empty state; import API pending                                     |
| `/app/coordinator/students`                                                                                                                 | `src/features/workspace/pages/StudentProgressPage.jsx`      | Example peers plus your own saved progress                          |
| `/app/coordinator/topic-statistics`                                                                                                         | `src/features/workspace/pages/TopicStatisticsPage.jsx`      | Review scenario completion rates                                    |
| `/app/coordinator/at-risk`                                                                                                                  | `src/features/workspace/pages/AtRiskPage.jsx`               | Illustrative below-average check-in list                            |

All /app/* pages require a signed-in account, and Student/Coordinator routes use the account type returned by /me. The live workflow stores organization membership, published roadmap versions, cohorts, enrollment, and topic progress. Other pages labeled Sample or Preview still use the separate review scenario; imports and broader production analytics remain pending.

## Live learning routes

| Route                               | File                                                     | Data                                                    |
| ----------------------------------- | -------------------------------------------------------- | ------------------------------------------------------- |
| /app/coordinator/learning           | src/features/workspace/pages/CoordinatorLearningPage.jsx | Create organizations, roadmaps, cohorts, and join codes |
| /app/coordinator/learning/:cohortId | src/features/workspace/pages/LiveCohortProgressPage.jsx  | Real student and topic completion                       |
| /app/student/learning               | src/features/workspace/pages/StudentLearningPage.jsx     | Join cohort and update assigned topics                  |

The API client is in src/features/workspace/learningApi.js. The full two-account walkthrough is in docs/REVIEW-DEMO.md.

## Where to make changes

- `src/app/App.jsx`: route definitions.
- `src/app/workspace.css`: responsive workspace layout and components.
- `src/styles/public-pages.css`: marketing and authentication styles.
- `src/index.css`: shared fonts, colors, and base styles.
- `src/features/workspace/components/WorkspaceShell.jsx`: protected navigation, data loading, and review-progress actions.
- `src/features/workspace/components/WorkspaceUI.jsx`: reusable cards, headings, progress bars, and empty states.
- `src/features/workspace/hooks/useWorkspace.js`: shared page context.
- `src/features/auth/authApi.js`, `src/features/review/reviewApi.js`: endpoint-specific API functions.
- `src/shared/api/client.js`: API transport and in-memory access token.

Keep new feature pages inside their feature directory and add routes in `src/app/App.jsx`. When a production backend endpoint replaces preview data, update the related API module and the page's preview notice together.

## Checks

Run `npm run format:check`, `npm run lint`, `npm test`, and `npm run build` from `frontend/`.

The guided demo and backend setup are described in [the review guide](../docs/REVIEW-DEMO.md).
