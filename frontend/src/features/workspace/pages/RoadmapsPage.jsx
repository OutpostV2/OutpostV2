import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import { PageHeading, PreviewNotice } from '../components/WorkspaceUI'
export default function RoadmapsPage() {
  const { overview } = useWorkspace()
  const { student } = overview
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Roadmaps"
        title="Roadmaps"
        description="A home for structured learning plans and their published versions."
      />
      <PreviewNotice>
        The review roadmap is an example. Roadmap creation and publishing are
        planned backend capabilities.
      </PreviewNotice>
      <article className="workspace-card workspace-entity-card">
        <div className="workspace-entity-icon">R</div>
        <div className="workspace-entity-body">
          <p className="workspace-card-label">Review roadmap</p>
          <h2>{student.roadmap_title}</h2>
          <p>
            {student.phases.length} phases · {student.total} topics
          </p>
          <div className="workspace-tag-row">
            {student.phases.map((phase) => (
              <span className="workspace-tag" key={phase.title}>
                {phase.title}
              </span>
            ))}
          </div>
          <Link
            className="workspace-text-link"
            to="/app/coordinator/roadmaps/review/versions"
          >
            View version structure →
          </Link>
        </div>
      </article>
    </>
  )
}
