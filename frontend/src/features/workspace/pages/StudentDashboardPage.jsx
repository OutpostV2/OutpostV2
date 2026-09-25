import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import {
  MetricCard,
  PageHeading,
  ProgressBar,
  SectionHeading,
} from '../components/WorkspaceUI'
export default function StudentDashboardPage() {
  const { user, overview } = useWorkspace()
  const { student } = overview
  const remaining = student.total - student.completed
  return (
    <>
      <PageHeading
        eyebrow="Student / Review scenario"
        title={`Good to see you, ${user.display_name.split(' ')[0]}.`}
        description="Sample roadmap progress for the college review. Open assigned learning for your real cohort roadmap."
        action={
          <Link className="workspace-button" to="/app/student/learning">
            Open assigned learning →
          </Link>
        }
      />
      <div className="workspace-metric-grid">
        <MetricCard
          label="Your progress"
          value={`${student.percent}%`}
          detail="Across this learning path"
          tone="green"
        />
        <MetricCard
          label="Topics completed"
          value={student.completed}
          detail={`Of ${student.total} topics`}
        />
        <MetricCard
          label="Still to explore"
          value={remaining}
          detail="One step at a time"
        />
      </div>
      <div className="workspace-two-column">
        <section className="workspace-card workspace-feature-card">
          <p className="workspace-card-label">What’s next</p>
          <h2>{student.next_topic?.title || 'You completed the roadmap'}</h2>
          <p>
            {student.next_topic?.description ||
              'Excellent work. You have finished every topic in this review scenario.'}
          </p>
          <div className="workspace-card-footer">
            <span>
              {student.next_topic
                ? `Week ${student.next_topic.week}`
                : 'All topics done'}
            </span>
            <Link className="workspace-text-link" to="/app/student/roadmap">
              View topic →
            </Link>
          </div>
        </section>
        <section className="workspace-card">
          <SectionHeading
            title="Learning path"
            description={student.roadmap_title}
            to="/app/student/roadmap"
            linkLabel="View full roadmap"
          />
          <div className="workspace-progress-total">
            <strong>{student.percent}%</strong>
            <span>complete</span>
          </div>
          <ProgressBar value={student.percent} label="Roadmap completion" />
          <p className="workspace-muted">
            {student.completed} of {student.total} topics completed
          </p>
        </section>
      </div>
      <section className="workspace-section">
        <SectionHeading
          title="Your phases"
          description="Follow the plan at a pace that works for you."
          to="/app/student/roadmap"
          linkLabel="Explore roadmap"
        />
        <div className="workspace-phase-grid">
          {student.phases.map((phase, index) => {
            const completed = phase.topics.filter(
              (topic) => topic.status === 'completed',
            ).length
            return (
              <article
                className="workspace-card workspace-phase-card"
                key={phase.title}
              >
                <span className="workspace-phase-number">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <h3>{phase.title}</h3>
                <p>{phase.description}</p>
                <span className="workspace-muted">
                  {completed} / {phase.topics.length} complete
                </span>
                <ProgressBar
                  value={
                    phase.topics.length
                      ? Math.round((completed * 100) / phase.topics.length)
                      : 0
                  }
                  label={`${phase.title} completion`}
                />
              </article>
            )
          })}
        </div>
      </section>
      <div className="workspace-two-column workspace-bottom-links">
        <Link
          className="workspace-card workspace-link-card"
          to="/app/student/activity"
        >
          <span>Recent activity</span>
          <strong>See the steps you’ve completed →</strong>
        </Link>
        <Link
          className="workspace-card workspace-link-card"
          to="/app/student/deadlines"
        >
          <span>Deadlines</span>
          <strong>Plan what comes next →</strong>
        </Link>
      </div>
    </>
  )
}
