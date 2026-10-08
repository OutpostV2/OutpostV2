import { EmptyState, PageHeading } from '../components/WorkspaceUI'
export default function StudentActivityPage() {
  return (
    <>
      <PageHeading
        eyebrow="Activity"
        title="Your learning activity"
        description="History of changes to your assigned learning."
      />
      <EmptyState
        title="Activity history is not available yet"
        description="Your current completion is saved. Auditable history will appear when activity recording is enabled; sample progress is kept in the illustrative review."
        actionTo="/app/student/learning"
        actionLabel="Open assigned learning"
      />
    </>
  )
}
