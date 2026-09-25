import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import {
  MetricCard,
  PageHeading,
  PreviewNotice,
  ProgressBar,
  SectionHeading,
} from '../components/WorkspaceUI'
export default function CoordinatorDashboardPage() {
  const { overview } = useWorkspace()
  const coordinator = overview.coordinator
  const watch = coordinator.members.filter(
    (member) => member.percent < coordinator.average_percent,
  )
  return (
    <>
      <PageHeading
        eyebrow="Coordinator preview"
        title="The cohort at a glance"
        description="This sample cohort illustrates reporting. Open Live learning to create real roadmaps and see enrolled students."
        action={
          <Link className="workspace-button" to="/app/coordinator/learning">
            Build live learning →
          </Link>
        }
      />
      <PreviewNotice />
      <div className="workspace-metric-grid">
        <MetricCard
          label="Cohort members"
          value={coordinator.members.length}
          detail={coordinator.cohort_title}
          tone="green"
        />
        <MetricCard
          label="Average progress"
          value={`${coordinator.average_percent}%`}
          detail="Across example learners"
        />
        <MetricCard
          label="Below average"
          value={watch.length}
          detail="May benefit from support"
        />
      </div>
      <div className="workspace-two-column">
        <section className="workspace-card">
          <SectionHeading
            title="Cohort progress"
            description={coordinator.cohort_title}
            to="/app/coordinator/students"
            linkLabel="All learners"
          />
          <div className="workspace-compact-list">
            {coordinator.members.slice(0, 4).map((member) => (
              <div key={member.name} className="workspace-compact-row">
                <div>
                  <strong>{member.is_you ? 'You' : member.name}</strong>
                  <span>
                    {member.completed}/{member.total} topics
                  </span>
                </div>
                <div className="workspace-compact-progress">
                  <ProgressBar
                    value={member.percent}
                    label={`${member.name} progress`}
                  />
                  <span>{member.percent}%</span>
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="workspace-card">
          <SectionHeading
            title="Topics to watch"
            description="Example completion rates"
            to="/app/coordinator/topic-statistics"
            linkLabel="All topics"
          />
          <div className="workspace-compact-list">
            {[...coordinator.topics]
              .sort((a, b) => a.percent - b.percent)
              .slice(0, 4)
              .map((topic) => (
                <div key={topic.title} className="workspace-compact-row">
                  <div>
                    <strong>{topic.title}</strong>
                    <span>
                      {topic.completed}/{topic.total} learners
                    </span>
                  </div>
                  <span className="workspace-data-pill">{topic.percent}%</span>
                </div>
              ))}
          </div>
        </section>
      </div>
      <section className="workspace-section">
        <SectionHeading
          title="Manage the learning journey"
          description="Explore the planned coordinator workflow."
        />
        <div className="workspace-quick-grid">
          <Link
            className="workspace-card workspace-link-card"
            to="/app/coordinator/learning"
          >
            <span>01 / Cohorts</span>
            <strong>Organize learners →</strong>
          </Link>
          <Link
            className="workspace-card workspace-link-card"
            to="/app/coordinator/learning"
          >
            <span>02 / Roadmaps</span>
            <strong>Plan and version paths →</strong>
          </Link>
          <Link
            className="workspace-card workspace-link-card"
            to="/app/coordinator/imports"
          >
            <span>03 / Imports</span>
            <strong>Prepare cohort data →</strong>
          </Link>
        </div>
      </section>
    </>
  )
}
