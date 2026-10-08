import { getMyActivity } from '../learningApi'
import ActivityHistory from '../components/ActivityHistory'
import { PageHeading } from '../components/WorkspaceUI'
export default function StudentActivityPage() {
  return (
    <>
      <PageHeading
        eyebrow="Student / Activity"
        title="Your learning history"
        description="Actual saved changes in your currently assigned learning."
      />
      <ActivityHistory loadPage={getMyActivity} />
    </>
  )
}
