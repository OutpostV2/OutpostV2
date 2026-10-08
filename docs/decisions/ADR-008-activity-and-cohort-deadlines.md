# ADR-008: Activity history and cohort deadlines

- **Status:** Accepted
- **Date:** 2026-10-08

Progress belongs to a user and topic in a pinned roadmap version. A completion or
reopening creates an activity event in the same PostgreSQL transaction as the
progress change, under the existing organization lock. Repeated writes do not
create events or change completion timestamps. Existing progress is not
backfilled as fictional activity. Events retain their organization, actor, topic,
old/new status and UTC creation instant. History has no update API and database
updates are rejected; tenant/account deletion may cascade for data lifecycle.

History reads use current authorization: students see their own topics in active
enrollments and memberships; staff see eligible active students and topics in the
selected cohort's exact version. Withdrawal hides history without deleting it.
Overlapping cohorts on the same version share topic progress and events. Lists
use bounded cursor pagination ordered by creation time and ID.

Deadlines belong to a cohort and week, independently of published curriculum.
Only owners, admins and coordinators can schedule, revise or remove them. The
week must belong to the cohort's pinned version; both API checks and a database
trigger enforce this. Each change records author, time, previous and new due
instant/timezone in append-only audit rows. Identical saves and repeated removals
are no-ops. No migration modifies existing roadmaps, enrollments or progress.

The API accepts an ISO timestamp with explicit offset and a valid IANA timezone
(or UTC). The timestamp defines the absolute instant; the timezone defines its
display. Store timestamptz, return UTC ISO timestamps, display the named timezone.
An offset and display zone need not match: they are separate inputs. This avoids
ambiguous daylight-saving local times. The UI requests the explicit-offset ISO
timestamp and names the display zone; it does not silently interpret local time.

Student week status is unscheduled without a deadline; no_topics for an empty
scheduled week; completed if every topic is currently complete; overdue only if
the server's current instant is strictly after the due instant and some topics
remain; otherwise upcoming. Reopening may restore overdue status. This is a
current state indicator, not a historical late-submission or inactivity claim.
No automatic sanctions, grades or predicted risk are generated. Published
curriculum remains immutable, and archived versions assigned to active cohorts
remain readable and schedulable.
