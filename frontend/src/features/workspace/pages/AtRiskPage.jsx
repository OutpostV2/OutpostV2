import { useWorkspace } from '../hooks/useWorkspace'
import {
  EmptyState,
  PageHeading,
  PreviewNotice,
  ProgressBar,
} from '../components/WorkspaceUI'
export default function AtRiskPage() {
  const { overview } = useWorkspace()
  const belowAverage = overview.coordinator.members.filter(
    (member) => member.percent < overview.coordinator.average_percent,
  )
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Support"
        title="Students to check in with"
        description="A starting point for supportive conversations when progress falls below the cohort average."
      />
      <PreviewNotice>
        This preview uses a simple below-average rule on example data. It is not
        a real risk score.
      </PreviewNotice>
      {belowAverage.length ? (
        <div className="workspace-card">
          <div className="workspace-table-toolbar">
            <h2>Below cohort average</h2>
            <span className="workspace-muted">
              Average: {overview.coordinator.average_percent}%
            </span>
          </div>
          <div className="workspace-compact-list">
            {belowAverage.map((member) => (
              <div className="workspace-compact-row" key={member.name}>
                <div>
                  <strong>{member.is_you ? 'You' : member.name}</strong>
                  <span>
                    {member.completed} of {member.total} topics complete
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
        </div>
      ) : (
        <EmptyState
          title="No learners are below the average"
          description="Everyone in this example cohort is currently at or above the group average."
        />
      )}
    </>
  )
}
