import { useCallback, useState } from 'react'
import { useLiveResource } from '../hooks/useLiveResource'
import LiveResourceState from './LiveResourceState'
import { EmptyState } from './WorkspaceUI'
export default function ActivityHistory({ loadPage, showStudent = false }) {
  const [cursor, setCursor] = useState(null)
  const loader = useCallback(() => loadPage(cursor), [loadPage, cursor])
  const resource = useLiveResource(loader)
  return (
    <section className="workspace-card">
      <h2>Recorded activity</h2>
      <p>
        Completion and reopening events recorded since history was introduced.
        Older saved progress has no invented history. Events shared by cohorts
        on the same roadmap version appear once per page.
      </p>
      <button
        className="workspace-button"
        onClick={() => {
          setCursor(null)
          resource.retry()
        }}
      >
        Refresh activity
      </button>
      <LiveResourceState {...resource} />
      {resource.data && (
        <>
          {!resource.data.events.length && (
            <EmptyState
              title="No recorded activity yet"
              description="Your saved learning changes will appear here when you complete or reopen a topic."
            />
          )}
          <ol className="activity-list">
            {resource.data.events.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{event.topic_title}</strong>
                  <p>
                    {showStudent ? event.user_name + ' · ' : ''}
                    {event.event_type === 'topic_completed'
                      ? 'Completed'
                      : 'Reopened'}
                  </p>
                </div>
                <time dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString()} (your timezone)
                </time>
              </li>
            ))}
          </ol>
          <div className="deadline-actions">
            {cursor && (
              <button
                className="workspace-button"
                onClick={() => setCursor(null)}
              >
                Latest activity
              </button>
            )}
            {resource.data.next_cursor && (
              <button
                className="workspace-button"
                onClick={() => setCursor(resource.data.next_cursor)}
              >
                Older activity
              </button>
            )}
          </div>
        </>
      )}
    </section>
  )
}
