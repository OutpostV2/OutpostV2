import { useCallback, useState } from 'react'
import {
  getCohortActivity,
  getCohortDeadlines,
  setWeekDeadline,
  removeWeekDeadline,
} from '../learningApi'
import { useLiveResource } from '../hooks/useLiveResource'
import LiveResourceState from './LiveResourceState'
import ActivityHistory from './ActivityHistory'
import DeadlineDetails from './DeadlineDetails'

function DeadlineEditor({
  cohortId,
  week,
  saved,
  busy,
  setBusy,
  draft,
  onDraft,
}) {
  const dueAt = draft?.dueAt ?? week.deadline?.due_at ?? ''
  const timeZone = draft?.timeZone ?? week.deadline?.time_zone ?? 'Asia/Kolkata'
  const [error, setError] = useState('')
  async function change(remove) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (remove) await removeWeekDeadline(cohortId, week.week_id)
      else
        await setWeekDeadline(cohortId, week.week_id, {
          due_at: dueAt,
          time_zone: timeZone,
        })
      saved(remove ? 'Deadline removed.' : 'Deadline saved.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to save deadline.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="deadline-week">
      <DeadlineDetails week={week} />
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void change(false)
        }}
        className="deadline-editor"
      >
        <label>
          Due instant for {week.title}
          <input
            required
            type="text"
            value={dueAt}
            onChange={(event) =>
              onDraft({ dueAt: event.target.value, timeZone })
            }
            placeholder="2026-12-01T17:00:00+05:30"
            aria-describedby={'due-help-' + week.week_id}
          />
        </label>
        <p id={'due-help-' + week.week_id}>
          ISO date and time with explicit offset or Z. Example:
          2026-12-01T17:00:00+05:30.
        </p>
        <label>
          Display timezone for {week.title}
          <input
            required
            value={timeZone}
            onChange={(event) =>
              onDraft({ dueAt, timeZone: event.target.value })
            }
            placeholder="Asia/Kolkata"
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="deadline-actions">
          <button className="workspace-button" disabled={busy} type="submit">
            Save deadline
          </button>
          {week.deadline && (
            <button
              className="workspace-button workspace-button-secondary"
              disabled={busy}
              type="button"
              onClick={() => void change(true)}
            >
              Remove deadline
            </button>
          )}
        </div>
      </form>
    </article>
  )
}
export default function CohortSchedule({ cohortId }) {
  const loader = useCallback(() => getCohortDeadlines(cohortId), [cohortId])
  const loadActivity = useCallback(
    (cursor) => getCohortActivity(cohortId, cursor),
    [cohortId],
  )
  const resource = useLiveResource(loader)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [drafts, setDrafts] = useState({})
  return (
    <>
      <section className="workspace-card">
        <h2>Week deadlines</h2>
        <p>
          Schedule the weeks in this cohort's pinned version. A deadline is an
          absolute instant; its named timezone controls display. Saving changes
          this cohort's schedule and records the author and time.
        </p>
        <p role="status">{message}</p>
        <LiveResourceState {...resource} />
        {resource.data && (
          <>
            {!resource.data.weeks.length && <p>This version has no weeks.</p>}
            {resource.data.weeks.map((week) => (
              <DeadlineEditor
                key={week.week_id}
                week={week}
                cohortId={cohortId}
                busy={busy}
                setBusy={setBusy}
                draft={drafts[week.week_id]}
                onDraft={(draft) =>
                  setDrafts((current) => ({
                    ...current,
                    [week.week_id]: draft,
                  }))
                }
                saved={(text) => {
                  setMessage(text)
                  setDrafts((current) => {
                    const next = { ...current }
                    delete next[week.week_id]
                    return next
                  })
                  resource.retry()
                }}
              />
            ))}
          </>
        )}
      </section>
      <ActivityHistory key={cohortId} loadPage={loadActivity} showStudent />
    </>
  )
}
