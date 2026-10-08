import { getMyDeadlines } from '../learningApi'
import { useLiveResource } from '../hooks/useLiveResource'
import LiveResourceState from '../components/LiveResourceState'
import DeadlineDetails from '../components/DeadlineDetails'
import { EmptyState, PageHeading } from '../components/WorkspaceUI'
export default function StudentDeadlinesPage() {
  const resource = useLiveResource(getMyDeadlines)
  return (
    <>
      <PageHeading
        eyebrow="Student / Deadlines"
        title="Keep upcoming work in view"
        description="Current week completion and due dates for your assigned cohorts."
      />
      <p>
        Overdue means the due instant has passed and topics remain incomplete.
        Weeks without a deadline are never marked overdue. Status uses the
        server time at refresh.
      </p>
      <button className="workspace-button" onClick={resource.retry}>
        Refresh deadlines
      </button>
      <LiveResourceState {...resource} />
      {resource.data && (
        <>
          {!resource.data.length && (
            <EmptyState
              title="No assigned cohorts"
              description="Join a cohort to see its schedule."
              actionLabel="Join a cohort"
              actionTo="/app/student/learning"
            />
          )}
          {resource.data.map((cohort) => (
            <section className="workspace-card" key={cohort.cohort_id}>
              <h2>{cohort.cohort_name}</h2>
              <p>Version {cohort.roadmap_version_number}</p>
              {cohort.weeks.map((week) => (
                <article className="deadline-week" key={week.week_id}>
                  <DeadlineDetails week={week} />
                </article>
              ))}
            </section>
          ))}
        </>
      )}
    </>
  )
}
