import { EmptyState, PageHeading } from '../components/WorkspaceUI'
export default function StudentDeadlinesPage() {
  return (
    <>
      <PageHeading
        eyebrow="Deadlines"
        title="Keep upcoming work in view"
        description="A dedicated place for due dates and milestones as your learning plan grows."
      />
      <EmptyState
        title="No deadlines are available yet"
        description="The review roadmap has topics and weeks, but it does not have assigned due dates. When the organization and roadmap APIs are built, deadlines will appear here."
        actionLabel="View current roadmap"
        actionTo="/app/student/roadmap"
      />
    </>
  )
}
