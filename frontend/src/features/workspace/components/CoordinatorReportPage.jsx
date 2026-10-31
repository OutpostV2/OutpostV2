import { useCallback, useState } from 'react'
import { Link } from 'react-router'
import {
  listOrganizations,
  listCohorts,
  listRoadmaps,
  getCohortProgress,
} from '../learningApi'
import { useLiveResource } from '../hooks/useLiveResource'
import LiveResourceState from './LiveResourceState'
import { EmptyState, MetricCard, PageHeading, ProgressBar } from './WorkspaceUI'

const titles = {
  overview: 'Your cohorts at a glance',
  cohorts: 'Cohorts',
  students: 'Student progress',
  topics: 'Topic statistics',
  support: 'Students to support',
}
export default function CoordinatorReportPage({ view = 'overview' }) {
  const organizations = useLiveResource(listOrganizations)
  const [selectedOrganization, setOrganization] = useState('')
  const [selectedCohort, setCohort] = useState('')
  const [search, setSearch] = useState('')
  const allowed = (organizations.data ?? []).filter((org) =>
    ['owner', 'admin', 'coordinator'].includes(org.role),
  )
  const organizationId = String(
    allowed.find((org) => org.id === selectedOrganization)?.id ??
      allowed[0]?.id ??
      '',
  )
  const loadCohorts = useCallback(
    () => (organizationId ? listCohorts(organizationId) : Promise.resolve([])),
    [organizationId],
  )
  const cohorts = useLiveResource(loadCohorts)
  const loadRoadmaps = useCallback(
    () =>
      organizationId && !cohorts.loading && !cohorts.data?.length
        ? listRoadmaps(organizationId)
        : Promise.resolve([]),
    [organizationId, cohorts.loading, cohorts.data],
  )
  const roadmaps = useLiveResource(loadRoadmaps)
  const hasPublished = roadmaps.data?.some((r) => r.status === 'published')
  const cohortId = String(
    cohorts.data?.find((cohort) => cohort.id === selectedCohort)?.id ??
      cohorts.data?.[0]?.id ??
      '',
  )
  const loadReport = useCallback(
    () => (cohortId ? getCohortProgress(cohortId) : Promise.resolve(null)),
    [cohortId],
  )
  const resource = useLiveResource(loadReport)
  const report = resource.data
  const students = (report?.students ?? []).filter(
    (student) =>
      (view !== 'support' || student.below_average) &&
      student.name.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Live reporting"
        title={titles[view]}
        description="Current saved completion in the selected cohort."
        action={
          !!cohorts.data?.length && (
            <Link className="workspace-button" to="/app/coordinator/learning">
              Manage live learning
            </Link>
          )
        }
      />
      <LiveResourceState {...organizations} />
      {!organizations.loading && !organizations.error && !allowed.length && (
        <EmptyState
          title="No active organization yet"
          description="Create an organization or accept a staff invitation to begin."
          actionLabel="Organization setup"
          actionTo="/app/organizations"
        />
      )}
      {!!allowed.length && (
        <>
          <div className="workspace-card report-selectors">
            <label>
              Organization
              <select
                value={organizationId}
                onChange={(event) => {
                  setOrganization(event.target.value)
                  setCohort('')
                }}
              >
                {allowed.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
            <LiveResourceState {...cohorts} />
            {!!cohorts.data?.length && (
              <label>
                Cohort
                <select
                  value={cohortId}
                  onChange={(event) => setCohort(event.target.value)}
                >
                  {cohorts.data.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>
                      {cohort.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {!cohorts.loading && !cohorts.error && !cohorts.data?.length && (
            <EmptyState
              title="No active cohorts"
              description="Create a cohort with a published roadmap to start reporting."
              actionLabel={
                hasPublished ? 'Create a cohort' : 'Prepare a roadmap'
              }
              actionTo={
                hasPublished
                  ? '/app/coordinator/learning'
                  : '/app/coordinator/roadmaps'
              }
            />
          )}
          {view === 'cohorts' &&
            cohorts.data?.map((cohort) => (
              <article className="workspace-card" key={cohort.id}>
                <h2>{cohort.name}</h2>
                <p>
                  {cohort.roadmap_name} · {cohort.student_count} active
                  enrollments
                </p>
                <Link to={'/app/coordinator/learning/' + cohort.id}>
                  Open cohort report →
                </Link>
              </article>
            ))}
          {!!cohortId && <LiveResourceState {...resource} />}
          {report && (
            <>
              <section className="workspace-card">
                <h2>{report.cohort_name}</h2>
                <p>
                  {report.roadmap_name} · Version{' '}
                  {report.roadmap_version_number}
                </p>
                <p>
                  All-time current completion. Includes active student accounts
                  with active student membership and enrollment, including
                  students with no saved progress.
                </p>
                <div className="workspace-inline-actions">
                  <button className="workspace-button" onClick={resource.retry}>
                    Refresh report
                  </button>
                  <Link
                    className="workspace-text-link"
                    to={'/app/coordinator/learning/' + cohortId}
                  >
                    Open cohort details →
                  </Link>
                </div>
              </section>
              <div className="workspace-metric-grid">
                <MetricCard
                  label="Eligible students"
                  value={report.metrics.eligible_students}
                  detail="Active members and enrollments"
                  tone="green"
                />
                <MetricCard
                  label="Average completion"
                  value={report.average_percent + '%'}
                  detail={`${report.metrics.completed_topic_assignments} / ${report.metrics.possible_topic_assignments} completed topic assignments`}
                />
                <MetricCard
                  label="Below cohort average"
                  value={
                    report.students.filter((student) => student.below_average)
                      .length
                  }
                  detail="A prompt for a personal check-in"
                />
              </div>
              {!report.students.length && (
                <EmptyState
                  title="No eligible students yet"
                  description="Share the join code, and check that student memberships and accounts are active."
                />
              )}
              {view === 'support' && (
                <p>
                  Support signal: completion is below the exact cohort average.
                  This is not an inactivity or risk prediction. Ask the student
                  about their circumstances before taking action.
                </p>
              )}
              {['overview', 'students', 'support'].includes(view) && (
                <section className="workspace-card learning-report">
                  <h2>
                    {view === 'support'
                      ? 'Suggested check-ins'
                      : 'Student progress'}
                  </h2>
                  <label>
                    Find a student
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  {students.map((student) => (
                    <div className="learning-report-row" key={student.id}>
                      <div>
                        <strong>{student.name}</strong>
                        <span>
                          {student.completed} / {student.total} topics
                        </span>
                      </div>
                      <ProgressBar
                        value={student.percent}
                        label={student.name + ' completion'}
                      />
                      <strong>{student.percent}%</strong>
                    </div>
                  ))}
                  {report.students.length > 0 && !students.length && (
                    <p>No students match this view.</p>
                  )}
                </section>
              )}
              {['overview', 'topics'].includes(view) && (
                <section className="workspace-card learning-report">
                  <h2>Topic completion</h2>
                  {report.topics.map((topic) => (
                    <div className="learning-report-row" key={topic.id}>
                      <div>
                        <strong>{topic.title}</strong>
                        <span>
                          {topic.completed} / {topic.total} eligible students
                        </span>
                      </div>
                      <ProgressBar
                        value={topic.percent}
                        label={topic.title + ' completion'}
                      />
                      <strong>{topic.percent}%</strong>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}
