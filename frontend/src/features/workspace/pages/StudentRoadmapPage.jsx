import { useWorkspace } from '../hooks/useWorkspace'
import { PageHeading, ProgressBar } from '../components/WorkspaceUI'
export default function StudentRoadmapPage() {
  const { overview, busyTopic, changeTopic, resetProgress } = useWorkspace()
  const { student } = overview
  return (
    <>
      <PageHeading
        eyebrow="Sample roadmap"
        title={student.roadmap_title}
        description="This example roadmap saves your practice progress. Use My assigned learning for the roadmap from your coordinator."
      />
      <section className="workspace-card workspace-roadmap-summary">
        <div>
          <strong>
            {student.completed} of {student.total}
          </strong>
          <span> topics complete</span>
        </div>
        <span>{student.percent}% complete</span>
        <ProgressBar value={student.percent} label="Roadmap completion" />
      </section>
      <div className="workspace-roadmap-list">
        {student.phases.map((phase, index) => (
          <section
            className="workspace-card workspace-roadmap-phase"
            key={phase.title}
          >
            <div className="workspace-roadmap-phase-header">
              <span className="workspace-phase-number">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h2>{phase.title}</h2>
                <p>{phase.description}</p>
              </div>
              <span className="workspace-phase-count">
                {
                  phase.topics.filter((topic) => topic.status === 'completed')
                    .length
                }
                /{phase.topics.length} complete
              </span>
            </div>
            <div className="workspace-topic-list">
              {phase.topics.map((topic) => (
                <div className="workspace-topic-row" key={topic.key}>
                  <span
                    className={
                      'workspace-topic-marker' +
                      (topic.status === 'completed' ? ' is-complete' : '')
                    }
                    aria-hidden="true"
                  >
                    {topic.status === 'completed' ? '✓' : ''}
                  </span>
                  <div className="workspace-topic-copy">
                    <h3>{topic.title}</h3>
                    <p>{topic.description}</p>
                    <small>Week {topic.week}</small>
                  </div>
                  <button
                    className={
                      'workspace-topic-action' +
                      (topic.status === 'completed' ? ' is-complete' : '')
                    }
                    type="button"
                    disabled={busyTopic !== null}
                    onClick={() =>
                      void changeTopic(topic.key, topic.status !== 'completed')
                    }
                  >
                    {busyTopic === topic.key
                      ? 'Saving…'
                      : topic.status === 'completed'
                        ? 'Completed ✓'
                        : 'Mark complete'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="workspace-reset">
        <p>Want to replay the review scenario from the beginning?</p>
        <button
          type="button"
          disabled={busyTopic !== null}
          onClick={() => void resetProgress()}
        >
          Reset my scenario progress
        </button>
      </div>
    </>
  )
}
