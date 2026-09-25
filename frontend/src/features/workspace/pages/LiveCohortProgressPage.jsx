import { useEffect, useState } from 'react'
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
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!cohortId) return
    let active = true
    void getCohortProgress(cohortId)
      .then((data) => {
        if (active) setReport(data)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Cohort progress could not be loaded.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [cohortId])
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
      {loading && <p role="status">Loading cohort progress…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <div className="workspace-metric-grid">
            <MetricCard
              label="Students"
              value={report.students.length}
              detail="Joined by code"
              tone="green"
            />
            <MetricCard
              label="Average completion"
              value={`${report.average_percent}%`}
              detail="Across enrolled students"
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
