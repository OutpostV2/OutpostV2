import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import {
  PageHeading,
  PreviewNotice,
  ProgressBar,
} from '../components/WorkspaceUI'
export default function CohortsPage() {
  const { overview } = useWorkspace()
  const coordinator = overview.coordinator
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Cohorts"
        title="Cohorts"
        description="Organize a shared learning path for each group of students."
      />
      <PreviewNotice>
        One example cohort is shown below. Creating, editing, and assigning real
        cohorts requires the organization APIs.
      </PreviewNotice>
      <article className="workspace-card workspace-entity-card">
        <div className="workspace-entity-icon">C</div>
        <div className="workspace-entity-body">
          <p className="workspace-card-label">Example cohort</p>
          <h2>{coordinator.cohort_title}</h2>
          <p>{coordinator.roadmap_title}</p>
          <div className="workspace-entity-metrics">
            <span>{coordinator.members.length} learners</span>
            <span>{coordinator.average_percent}% average progress</span>
          </div>
          <ProgressBar
            value={coordinator.average_percent}
            label="Average cohort progress"
          />
          <Link className="workspace-text-link" to="/app/coordinator/students">
            View learner progress →
          </Link>
        </div>
      </article>
    </>
  )
}
