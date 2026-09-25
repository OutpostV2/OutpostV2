import { Link, useParams } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import { PageHeading, PreviewNotice } from '../components/WorkspaceUI'
export default function RoadmapVersionsPage() {
  const { roadmapId } = useParams()
  const { overview } = useWorkspace()
  if (roadmapId !== 'review')
    return (
      <>
        <PageHeading
          eyebrow="Coordinator / Roadmaps"
          title="Roadmap not found"
          description="The requested roadmap is not available in this preview."
        />
        <Link className="workspace-text-link" to="/app/coordinator/roadmaps">
          Back to roadmaps →
        </Link>
      </>
    )
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Roadmaps / Versions"
        title="Roadmap versions"
        description={overview.student.roadmap_title}
      />
      <PreviewNotice>
        Version history and publishing controls will connect to the roadmap
        version APIs in a later build phase.
      </PreviewNotice>
      <article className="workspace-card workspace-version-card">
        <span className="workspace-version-indicator">01</span>
        <div>
          <p className="workspace-card-label">Current review scenario</p>
          <h2>Example learning path</h2>
          <p>
            {overview.student.phases.length} phases and {overview.student.total}{' '}
            topics are available for students to explore.
          </p>
        </div>
        <span className="workspace-data-pill">Preview</span>
      </article>
      <Link className="workspace-text-link" to="/app/coordinator/roadmaps">
        ← All roadmaps
      </Link>
    </>
  )
}
