import { useWorkspace } from '../hooks/useWorkspace'
import {
  PageHeading,
  PreviewNotice,
  ProgressBar,
} from '../components/WorkspaceUI'
export default function TopicStatisticsPage() {
  const { overview } = useWorkspace()
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Analytics"
        title="Topic statistics"
        description="Spot where a group may need more explanation or practice."
      />
      <PreviewNotice>
        Completion rates combine example peers with your saved progress.
      </PreviewNotice>
      <div className="workspace-card">
        <div className="workspace-table-toolbar">
          <h2>Completion by topic</h2>
          <span className="workspace-muted">
            {overview.coordinator.topics.length} topics
          </span>
        </div>
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Topic</th>
                <th>Completed</th>
                <th>Completion rate</th>
              </tr>
            </thead>
            <tbody>
              {overview.coordinator.topics.map((topic) => (
                <tr key={topic.title}>
                  <td>
                    <strong>{topic.title}</strong>
                  </td>
                  <td>
                    {topic.completed} / {topic.total} learners
                  </td>
                  <td>
                    <div className="workspace-table-progress">
                      <ProgressBar
                        value={topic.percent}
                        label={`${topic.title} completion rate`}
                      />
                      <span>{topic.percent}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
