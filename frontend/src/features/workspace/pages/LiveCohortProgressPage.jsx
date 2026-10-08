import { useCallback } from 'react'
import { useLiveResource } from '../hooks/useLiveResource'
import LiveResourceState from '../components/LiveResourceState'
import { Link, useParams } from 'react-router'
import {
  EmptyState,
  MetricCard,
  PageHeading,
  ProgressBar,
} from '../components/WorkspaceUI'
import { getCohortProgress } from '../learningApi'
export default function LiveCohortProgressPage() {
  const { cohortId } = useParams()
  const loader = useCallback(() => getCohortProgress(cohortId), [cohortId])
  const resource = useLiveResource(loader)
  const report = resource.data
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Live progress"
        title={report?.cohort_name || 'Cohort progress'}
        description={
          report
            ? `Real progress for ${report.roadmap_name}. Refresh to see students' latest updates.`
            : 'Review real student topic completion.'
        }
        action={
          <Link className="workspace-button" to="/app/coordinator/learning">
            Back to setup
          </Link>
        }
      />
      <LiveResourceState {...resource} />
      {report && (
        <>
          <section className="workspace-card">
            <p>
              Version {report.roadmap_version_number} · All-time current
              completion
            </p>
            <p>
              Eligible students have an active account, student membership and
              enrollment. Students with zero progress are included.
            </p>
            <button className="workspace-button" onClick={resource.retry}>
              Refresh report
            </button>
          </section>
          <div className="workspace-metric-grid">
            <MetricCard
              label="Students"
              value={report.students.length}
              detail="Active student accounts and memberships"
              tone="green"
            />
            <MetricCard
              label="Average completion"
              value={`${report.average_percent}%`}
              detail={
                report.metrics
                  ? `${report.metrics.completed_topic_assignments} / ${report.metrics.possible_topic_assignments} completed topic assignments`
                  : 'Across eligible students'
              }
            />
            <MetricCard
              label="Topics"
              value={report.topics.length}
              detail="Published roadmap version"
            />
          </div>
          {report.students.length === 0 ? (
            <EmptyState
              title="No students have joined"
              description="Share the cohort join code shown on the setup page."
            />
          ) : (
            <section className="workspace-card learning-report">
              <h2>Student progress</h2>
              {report.students.map((student) => (
                <div className="learning-report-row" key={student.id}>
                  <div>
                    <strong>{student.name}</strong>
                    <span>
                      {student.completed} / {student.total} topics
                    </span>
                  </div>
                  <ProgressBar
                    value={student.percent}
                    label={`${student.name} completion`}
                  />
                  <strong>{student.percent}%</strong>
                </div>
              ))}
            </section>
          )}
          <section className="workspace-card learning-report">
            <h2>Topic completion</h2>
            {report.topics.map((topic) => (
              <div className="learning-report-row" key={topic.id}>
                <div>
                  <strong>{topic.title}</strong>
                  <span>
                    {topic.completed} / {topic.total} students
                  </span>
                </div>
                <ProgressBar
                  value={topic.percent}
                  label={`${topic.title} completion`}
                />
                <strong>{topic.percent}%</strong>
              </div>
            ))}
          </section>
        </>
      )}
    </>
  )
}
