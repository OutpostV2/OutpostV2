import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import { useLiveResource } from '../hooks/useLiveResource'
import { getMyLearning } from '../learningApi'
import LiveResourceState from '../components/LiveResourceState'
import {
  EmptyState,
  MetricCard,
  PageHeading,
  ProgressBar,
} from '../components/WorkspaceUI'
export default function StudentDashboardPage() {
  const { user } = useWorkspace()
  const resource = useLiveResource(getMyLearning)
  const learning = resource.data || []
  const topics = new Map(
    learning.flatMap((item) => item.topics).map((topic) => [topic.id, topic]),
  )
  const completed = [...topics.values()].filter(
    (topic) => topic.completed,
  ).length
  const next = [...topics.values()].find((topic) => !topic.completed)
  return (
    <>
      <PageHeading
        eyebrow="Student / Assigned learning"
        title={'Good to see you, ' + user.display_name.split(' ')[0] + '.'}
        description="Your enrolled cohorts and personal progress on their exact assigned roadmap versions."
        action={
          <Link className="workspace-button" to="/app/student/learning">
            Open assigned learning →
          </Link>
        }
      />
      <LiveResourceState {...resource} />
      {resource.data && (
        <>
          <div className="workspace-metric-grid">
            <MetricCard
              label="Enrolled cohorts"
              value={learning.length}
              detail="Active assignments"
              tone="green"
            />
            <MetricCard
              label="Topics completed"
              value={completed}
              detail={'Of ' + topics.size + ' distinct assigned topics'}
            />
            <MetricCard
              label="Still to explore"
              value={topics.size - completed}
              detail="Your unfinished topics"
            />
          </div>
          {!learning.length && (
            <EmptyState
              title="No assigned roadmap yet"
              description="Enter your coordinator's cohort code to begin."
              actionTo="/app/student/learning"
              actionLabel="Join a cohort"
            />
          )}
          {!!learning.length && (
            <section className="workspace-card workspace-feature-card">
              <p className="workspace-card-label">Next step</p>
              <h2>{next?.title || 'All assigned topics completed'}</h2>
              <p>
                {next?.description ||
                  'Open your roadmap to review your saved progress.'}
              </p>
              <Link className="workspace-text-link" to="/app/student/roadmap">
                View assigned roadmap →
              </Link>
            </section>
          )}
          <div className="learning-assignments">
            {learning.map((item) => (
              <section className="workspace-card" key={item.cohort_id}>
                <p className="workspace-eyebrow">
                  {item.organization_name} / {item.cohort_name}
                </p>
                <h2>{item.roadmap_name}</h2>
                <p>
                  Version {item.roadmap_version_number} · {item.completed} of{' '}
                  {item.total} topics complete
                </p>
                <ProgressBar
                  value={item.percent}
                  label={item.cohort_name + ' completion'}
                />
                <Link className="workspace-text-link" to="/app/student/roadmap">
                  Continue learning →
                </Link>
              </section>
            ))}
          </div>
          <Link className="workspace-text-link" to="/review">
            Open the separately labeled illustrative review →
          </Link>
        </>
      )}
    </>
  )
}
