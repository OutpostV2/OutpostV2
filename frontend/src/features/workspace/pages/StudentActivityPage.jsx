import { useWorkspace } from '../hooks/useWorkspace'
import { EmptyState, PageHeading } from '../components/WorkspaceUI'
export default function StudentActivityPage() {
  const { overview } = useWorkspace()
  const completed = overview.student.phases
    .flatMap((phase) => phase.topics)
    .filter((topic) => topic.completed_at)
    .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || ''))
  return (
    <>
      <PageHeading
        eyebrow="Activity"
        title="Your learning activity"
        description="Topics you have marked complete in the review scenario."
      />
      {completed.length ? (
        <section className="workspace-card">
          <div className="workspace-activity-list">
            {completed.map((topic) => (
              <div className="workspace-activity-row" key={topic.key}>
                <span className="workspace-activity-check">✓</span>
                <div>
                  <strong>{topic.title}</strong>
                  <p>Marked complete · Week {topic.week}</p>
                </div>
                <time dateTime={topic.completed_at || undefined}>
                  {new Date(topic.completed_at || '').toLocaleDateString()}
                </time>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState
          title="Your activity starts with a topic"
          description="Open your roadmap and mark a topic complete. It will appear here with the date you completed it."
          actionLabel="Open my roadmap"
          actionTo="/app/student/roadmap"
        />
      )}
    </>
  )
}
