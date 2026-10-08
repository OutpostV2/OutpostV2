import { useEffect, useState } from 'react'
import { EmptyState, PageHeading, ProgressBar } from '../components/WorkspaceUI'
import {
  getMyLearning,
  joinCohort,
  setTopicProgress,
  withdrawFromCohort,
} from '../learningApi'
export default function StudentLearningPage() {
  const [learning, setLearning] = useState([])
  const [inviteCode, setInviteCode] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  async function reload() {
    setLearning(await getMyLearning())
  }
  useEffect(() => {
    let active = true
    void getMyLearning()
      .then((items) => {
        if (active) setLearning(items)
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Your learning could not be loaded.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  async function submitJoin(event) {
    event.preventDefault()
    setBusy('join')
    setError('')
    setMessage('')
    try {
      const joined = await joinCohort(inviteCode.trim())
      await reload()
      setInviteCode('')
      setMessage(`You joined ${joined.cohort_name}.`)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The join code could not be used.',
      )
    } finally {
      setBusy('')
    }
  }
  async function changeTopic(topicId, completed) {
    setBusy(topicId)
    setError('')
    setMessage('')
    try {
      await setTopicProgress(topicId, completed)
      await reload()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Progress could not be saved.',
      )
    } finally {
      setBusy('')
    }
  }
  async function leaveCohort(assignment) {
    setBusy(`leave:${assignment.cohort_id}`)
    setError('')
    setMessage('')
    try {
      await withdrawFromCohort(assignment.cohort_id)
      await reload()
      setMessage(
        `You left ${assignment.cohort_name}. Your saved progress is retained.`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'You could not leave this cohort.',
      )
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Student / Live learning"
        title="Your assigned learning"
        description="Join your coordinator's cohort and track real progress on its assigned roadmap."
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
          <button
            className="workspace-button"
            type="button"
            onClick={() => {
              setError('')
              setLoading(true)
              void reload()
                .catch((cause) => setError(cause.message))
                .finally(() => setLoading(false))
            }}
          >
            Try again
          </button>
        </p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      <section className="workspace-card learning-join">
        <h2>Join a cohort</h2>
        <p>
          Ask your coordinator for the join code. It connects your account to
          that cohort's published roadmap.
        </p>
        <form className="learning-inline-form" onSubmit={submitJoin}>
          <label className="form-field">
            <span>Join code</span>
            <input
              required
              minLength={20}
              maxLength={64}
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="workspace-button" disabled={busy !== ''}>
            {busy === 'join' ? 'Joining…' : 'Join cohort'}
          </button>
        </form>
      </section>
      {loading && <p role="status">Loading your learning…</p>}
      {!loading && !error && learning.length === 0 && (
        <EmptyState
          title="No assigned roadmap yet"
          description="Once you enter a cohort join code, its roadmap will appear here."
        />
      )}
      <div className="learning-assignments">
        {learning.map((assignment) => (
          <section
            className="workspace-card learning-assignment"
            key={assignment.cohort_id}
          >
            <div className="learning-assignment-header">
              <div>
                <p className="workspace-eyebrow">
                  {assignment.organization_name} / {assignment.cohort_name}
                </p>
                <h2>{assignment.roadmap_name}</h2>
                <p>Version {assignment.roadmap_version_number}</p>
                <p>
                  {assignment.completed} of {assignment.total} topics completed
                </p>
              </div>
              <strong>{assignment.percent}%</strong>
            </div>
            <ProgressBar
              value={assignment.percent}
              label={`${assignment.roadmap_name} completion`}
            />
            <div className="learning-assignment-actions">
              <button
                type="button"
                className="workspace-button workspace-button-outline"
                disabled={busy !== ''}
                onClick={() => void leaveCohort(assignment)}
              >
                {busy === `leave:${assignment.cohort_id}`
                  ? 'Leaving…'
                  : 'Leave cohort'}
              </button>
              <small>
                Your completed topics remain saved if you join again.
              </small>
            </div>
            {(
              assignment.phases || [
                {
                  id: 'flat',
                  title: '',
                  weeks: [{ id: 'flat', title: '', topics: assignment.topics }],
                },
              ]
            ).map((phase) => (
              <section className="learning-phase" key={phase.id}>
                {phase.title && <h3>{phase.title}</h3>}
                {phase.weeks.map((week) => (
                  <section className="learning-week" key={week.id}>
                    {week.title && <h4>{week.title}</h4>}
                    <div className="learning-topic-list">
                      {week.topics.map((topic) => (
                        <div className="learning-topic" key={topic.id}>
                          <div>
                            <h3>{topic.title}</h3>
                            {topic.description && <p>{topic.description}</p>}
                          </div>
                          <button
                            type="button"
                            className={
                              topic.completed
                                ? 'learning-topic-done'
                                : 'workspace-button'
                            }
                            disabled={busy !== ''}
                            onClick={() =>
                              void changeTopic(topic.id, !topic.completed)
                            }
                            aria-pressed={topic.completed}
                          >
                            {busy === topic.id
                              ? 'Saving…'
                              : topic.completed
                                ? 'Completed ✓'
                                : 'Mark complete'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </section>
            ))}
          </section>
        ))}
      </div>
    </>
  )
}
