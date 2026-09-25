import { useState } from 'react'
import { useWorkspace } from '../hooks/useWorkspace'
import {
  PageHeading,
  PreviewNotice,
  ProgressBar,
} from '../components/WorkspaceUI'
export default function StudentProgressPage() {
  const { overview } = useWorkspace()
  const [query, setQuery] = useState('')
  const members = overview.coordinator.members.filter((member) =>
    member.name.toLowerCase().includes(query.toLowerCase()),
  )
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Progress"
        title="Student progress"
        description="See how learners are moving through the same roadmap."
      />
      <PreviewNotice>
        Other learners are example data; your own completion is live and stored
        with your account.
      </PreviewNotice>
      <div className="workspace-card">
        <div className="workspace-table-toolbar">
          <h2>{overview.coordinator.cohort_title}</h2>
          <label className="workspace-search">
            <span className="sr-only">Search learners</span>
            <input
              type="search"
              placeholder="Search learners"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
        </div>
        <div className="workspace-table-wrap">
          <table className="workspace-table">
            <thead>
              <tr>
                <th>Learner</th>
                <th>Topics</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.name}>
                  <td>
                    <strong>{member.is_you ? 'You' : member.name}</strong>
                    {member.is_you && <small>Your live progress</small>}
                  </td>
                  <td>
                    {member.completed} / {member.total}
                  </td>
                  <td>
                    <div className="workspace-table-progress">
                      <ProgressBar
                        value={member.percent}
                        label={`${member.name} progress`}
                      />
                      <span>{member.percent}%</span>
                    </div>
                  </td>
                  <td>
                    <span
                      className={
                        'workspace-status-pill' +
                        (member.percent < overview.coordinator.average_percent
                          ? ' is-watch'
                          : '')
                      }
                    >
                      {member.percent < overview.coordinator.average_percent
                        ? 'Check in'
                        : 'On track'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!members.length && (
            <p className="workspace-table-empty">
              No learners match that search.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
