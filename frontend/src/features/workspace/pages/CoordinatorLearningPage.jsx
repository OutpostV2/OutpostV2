import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  EmptyState,
  PageHeading,
  SectionHeading,
} from '../components/WorkspaceUI'
import {
  createCohort,
  createOrganization,
  createRoadmap,
  getCohortEnrollments,
  listCohorts,
  listOrganizations,
  listRoadmaps,
  publishRoadmapVersion,
  reactivateCohortEnrollment,
  removeCohortEnrollment,
  revokeCohortJoinCode,
  rotateCohortJoinCode,
} from '../learningApi'
export default function CoordinatorLearningPage() {
  const [search] = useSearchParams()
  const preferredOrganization = search.get('organizationId')
  const preferredVersion = search.get('roadmapVersionId')
  const [organizations, setOrganizations] = useState([])
  const [organizationId, setOrganizationId] = useState('')
  const [roadmaps, setRoadmaps] = useState([])
  const [cohorts, setCohorts] = useState([])
  const [oneTimeCodes, setOneTimeCodes] = useState({})
  const [rosters, setRosters] = useState({})
  const [rosterOpen, setRosterOpen] = useState({})
  const [rosterLoading, setRosterLoading] = useState('')
  const [organizationName, setOrganizationName] = useState('')
  const [roadmapName, setRoadmapName] = useState('')
  const [roadmapDescription, setRoadmapDescription] = useState('')
  const [topicLines, setTopicLines] = useState('')
  const [cohortName, setCohortName] = useState('')
  const [versionId, setVersionId] = useState('')
  const [busy, setBusy] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [reviewVersionId, setReviewVersionId] = useState('')
  const publishedRoadmaps = roadmaps.filter(
    (roadmap) => roadmap.status === 'published',
  )
  useEffect(() => {
    let active = true
    void listOrganizations()
      .then((items) => {
        if (!active) return
        setOrganizations(items)
        setOrganizationId((current) =>
          items.some((item) => item.id === preferredOrganization)
            ? preferredOrganization
            : items.some((item) => item.id === current)
              ? current
              : items[0]?.id || '',
        )
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Organizations could not be loaded.',
          )
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [preferredOrganization])
  useEffect(() => {
    if (!organizationId) return
    let active = true
    void Promise.all([
      listRoadmaps(organizationId),
      listCohorts(organizationId),
    ])
      .then(([loadedRoadmaps, loadedCohorts]) => {
        if (!active) return
        setRoadmaps(loadedRoadmaps)
        setCohorts(loadedCohorts)
        setVersionId((current) =>
          loadedRoadmaps.some(
            (roadmap) =>
              roadmap.version_id === preferredVersion &&
              roadmap.status === 'published',
          )
            ? preferredVersion
            : loadedRoadmaps.some(
                  (roadmap) =>
                    roadmap.version_id === current &&
                    roadmap.status === 'published',
                )
              ? current
              : loadedRoadmaps.find((roadmap) => roadmap.status === 'published')
                  ?.version_id || '',
        )
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Learning data could not be loaded.',
          )
      })
    return () => {
      active = false
    }
  }, [organizationId, preferredVersion])
  useEffect(() => {
    if (search.get('roadmapVersionId') && publishedRoadmaps.length) {
      document
        .getElementById('cohort-setup')
        ?.scrollIntoView?.({ block: 'start' })
    }
  }, [search, publishedRoadmaps.length])
  async function addOrganization(event) {
    event.preventDefault()
    setBusy('organization')
    setError('')
    setMessage('')
    try {
      const created = await createOrganization(organizationName.trim())
      setOrganizations((items) => [...items, created])
      setOrganizationId(created.id)
      setOrganizationName('')
      setMessage('Organization created. Add its first roadmap next.')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Organization could not be created.',
      )
    } finally {
      setBusy('')
    }
  }
  async function addRoadmap(event) {
    event.preventDefault()
    const topics = topicLines
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    if (topics.length < 1 || topics.length > 24) {
      setError('Enter between 1 and 24 topics, one per line.')
      return
    }
    setBusy('roadmap')
    setError('')
    setMessage('')
    try {
      const created = await createRoadmap(organizationId, {
        name: roadmapName.trim(),
        description: roadmapDescription.trim(),
        topics: topics.map((title) => ({ title, description: '' })),
      })
      setRoadmaps((items) => [...items, created])
      setRoadmapName('')
      setRoadmapDescription('')
      setTopicLines('')
      setMessage(
        'Roadmap draft created. Review and publish it before assigning a cohort.',
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Roadmap could not be created.',
      )
    } finally {
      setBusy('')
    }
  }
  async function publishDraft(roadmap) {
    setBusy(roadmap.version_id)
    setError('')
    try {
      const published = await publishRoadmapVersion(
        organizationId,
        roadmap.id,
        roadmap.version_id,
      )
      setRoadmaps((items) =>
        items.map((item) =>
          item.version_id === published.version_id ? published : item,
        ),
      )
      setVersionId(published.version_id)
      setMessage('Version published. It is ready for cohort assignment.')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy('')
    }
  }
  async function addCohort(event) {
    event.preventDefault()
    setBusy('cohort')
    setError('')
    setMessage('')
    try {
      const created = await createCohort(
        organizationId,
        cohortName.trim(),
        versionId,
      )
      const { invite_code: inviteCode, ...cohortMetadata } = created
      setCohorts((items) => [...items, cohortMetadata])
      if (inviteCode) {
        setOneTimeCodes((codes) => ({
          ...codes,
          [created.id]: inviteCode,
        }))
      }
      setCohortName('')
      setMessage('Cohort created. Share its join code with a student.')
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Cohort could not be created.',
      )
    } finally {
      setBusy('')
    }
  }
  async function rotateCode(cohort) {
    setBusy(`rotate:${cohort.id}`)
    setError('')
    setMessage('')
    try {
      const rotated = await rotateCohortJoinCode(cohort.id)
      const { invite_code: inviteCode, ...cohortMetadata } = rotated
      setCohorts((items) =>
        items.map((item) =>
          item.id === cohort.id ? { ...item, ...cohortMetadata } : item,
        ),
      )
      setOneTimeCodes((codes) => ({
        ...codes,
        [cohort.id]: inviteCode,
      }))
      setMessage(
        `A new join code for ${cohort.name} is shown once. The previous code no longer works.`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The join code could not be rotated.',
      )
    } finally {
      setBusy('')
    }
  }
  async function revokeCode(cohort) {
    setBusy(`revoke:${cohort.id}`)
    setError('')
    setMessage('')
    try {
      await revokeCohortJoinCode(cohort.id)
      setCohorts((items) =>
        items.map((item) =>
          item.id === cohort.id
            ? {
                ...item,
                join_code_status: 'revoked',
                invite_code_expires_at: null,
              }
            : item,
        ),
      )
      setOneTimeCodes((codes) => {
        const next = { ...codes }
        delete next[cohort.id]
        return next
      })
      setMessage(`The join code for ${cohort.name} has been revoked.`)
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'The join code could not be revoked.',
      )
    } finally {
      setBusy('')
    }
  }
  async function toggleRoster(cohort) {
    if (rosterOpen[cohort.id]) {
      setRosterOpen((open) => ({ ...open, [cohort.id]: false }))
      return
    }
    if (!Object.hasOwn(rosters, cohort.id)) {
      setRosterLoading(cohort.id)
      setError('')
      try {
        const enrollments = await getCohortEnrollments(cohort.id)
        setRosters((current) => ({ ...current, [cohort.id]: enrollments }))
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The cohort roster could not be loaded.',
        )
        setRosterLoading('')
        return
      } finally {
        setRosterLoading('')
      }
    }
    setRosterOpen((open) => ({ ...open, [cohort.id]: true }))
  }
  async function changeEnrollment(cohort, enrollment, reactivate) {
    setBusy(`${reactivate ? 'reinstate' : 'remove'}:${enrollment.id}`)
    setError('')
    setMessage('')
    try {
      if (reactivate) await reactivateCohortEnrollment(cohort.id, enrollment.id)
      else await removeCohortEnrollment(cohort.id, enrollment.id)
      const updated = await getCohortEnrollments(cohort.id)
      setRosters((current) => ({ ...current, [cohort.id]: updated }))
      setCohorts((current) =>
        current.map((item) =>
          item.id === cohort.id
            ? {
                ...item,
                student_count: updated.filter((row) => row.status === 'active')
                  .length,
              }
            : item,
        ),
      )
      setMessage(
        reactivate
          ? `${enrollment.display_name} was reinstated.`
          : `${enrollment.display_name} was removed from the cohort.`,
      )
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Enrollment could not be updated.',
      )
    } finally {
      setBusy('')
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Live learning"
        title="Build a learning journey"
        description="Create an organization, review a roadmap draft, publish it, and invite students to a cohort. Changes here are saved in PostgreSQL."
      />
      {loading && <p role="status">Loading your organizations…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      <div className="learning-steps">
        <section className="workspace-card learning-step">
          <SectionHeading
            title="1. Organization"
            description="Your college or training group"
          />
          <form className="learning-form" onSubmit={addOrganization}>
            <label className="form-field">
              <span>Organization name</span>
              <input
                required
                minLength={2}
                maxLength={200}
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                placeholder="Example College"
              />
            </label>
            <button className="workspace-button" disabled={busy !== ''}>
              {' '}
              {busy === 'organization'
                ? 'Creating…'
                : 'Create organization'}{' '}
            </button>
          </form>
          {organizations.length > 0 && (
            <label className="form-field">
              <span>Working in</span>
              <select
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
              >
                {organizations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section className="workspace-card learning-step">
          <SectionHeading
            title="2. Roadmap"
            description="Create a draft, then review and publish an immutable version"
          />
          {organizationId ? (
            <form className="learning-form" onSubmit={addRoadmap}>
              <label className="form-field">
                <span>Roadmap name</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={roadmapName}
                  onChange={(event) => setRoadmapName(event.target.value)}
                  placeholder="Career readiness"
                />
              </label>
              <label className="form-field">
                <span>Description</span>
                <input
                  maxLength={2000}
                  value={roadmapDescription}
                  onChange={(event) =>
                    setRoadmapDescription(event.target.value)
                  }
                  placeholder="What students will learn"
                />
              </label>
              <label className="form-field">
                <span>Topics, one per line</span>
                <textarea
                  required
                  rows={5}
                  value={topicLines}
                  onChange={(event) => setTopicLines(event.target.value)}
                  placeholder={
                    'Set career goals\nBuild a portfolio\nPractice interviews'
                  }
                />
                <small>
                  1–24 topics. Each topic becomes one week in this first
                  version.
                </small>
              </label>
              <button className="workspace-button" disabled={busy !== ''}>
                {busy === 'roadmap' ? 'Creating…' : 'Create roadmap draft'}
              </button>
            </form>
          ) : (
            <p>Create an organization to add a roadmap.</p>
          )}
          {roadmaps.length > 0 && (
            <div className="learning-list">
              {roadmaps.map((roadmap) => (
                <div className="learning-list-item" key={roadmap.id}>
                  <strong>{roadmap.name}</strong>
                  <span>
                    Version {roadmap.version_number} · {roadmap.topics.length}{' '}
                    topics · {roadmap.status}
                  </span>
                  <Link
                    className="workspace-text-link"
                    to={`/app/coordinator/roadmaps/${roadmap.id}/versions?organizationId=${organizationId}`}
                  >
                    Review version structure →
                  </Link>
                  {roadmap.status === 'draft' && (
                    <>
                      <button
                        type="button"
                        className="workspace-button workspace-button-outline"
                        disabled={busy !== ''}
                        onClick={() => setReviewVersionId(roadmap.version_id)}
                      >
                        Review draft for publication
                      </button>
                      {reviewVersionId === roadmap.version_id && (
                        <div
                          className="roadmap-review"
                          role="region"
                          aria-label="Publication review"
                        >
                          <p>
                            {roadmap.topics.length} topics in version{' '}
                            {roadmap.version_number}. Publishing freezes this
                            version; future edits require a new draft.
                          </p>
                          <button
                            type="button"
                            className="workspace-button"
                            disabled={busy !== ''}
                            onClick={() => publishDraft(roadmap)}
                          >
                            {busy === roadmap.version_id
                              ? 'Publishing…'
                              : 'Publish reviewed draft'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="workspace-card learning-step" id="cohort-setup">
          <SectionHeading
            title="3. Cohort"
            description="Assign an exact roadmap version and share its join code"
          />
          {publishedRoadmaps.length ? (
            <form className="learning-form" onSubmit={addCohort}>
              <label className="form-field">
                <span>Cohort name</span>
                <input
                  required
                  minLength={2}
                  maxLength={200}
                  value={cohortName}
                  onChange={(event) => setCohortName(event.target.value)}
                  placeholder="2026 placement group"
                />
              </label>
              <label className="form-field">
                <span>Roadmap</span>
                <select
                  required
                  value={versionId}
                  onChange={(event) => setVersionId(event.target.value)}
                >
                  {publishedRoadmaps.map((roadmap) => (
                    <option key={roadmap.version_id} value={roadmap.version_id}>
                      {roadmap.name} · v{roadmap.version_number}
                    </option>
                  ))}
                </select>
              </label>
              <button className="workspace-button" disabled={busy !== ''}>
                {busy === 'cohort' ? 'Creating…' : 'Create cohort'}
              </button>
            </form>
          ) : (
            <p>Publish a roadmap before creating a cohort.</p>
          )}
          {cohorts.length ? (
            <div className="learning-list">
              {cohorts.map((cohort) => (
                <div className="learning-list-item" key={cohort.id}>
                  <div>
                    <strong>{cohort.name}</strong>
                    <span>
                      {cohort.roadmap_name} · {cohort.student_count} students
                    </span>
                  </div>
                  <div className="learning-invite">
                    <span>
                      Student join code · {cohort.join_code_status || 'unknown'}
                    </span>
                    {cohort.invite_code_expires_at && (
                      <small>
                        Expires{' '}
                        {new Date(
                          cohort.invite_code_expires_at,
                        ).toLocaleDateString()}
                      </small>
                    )}
                    {oneTimeCodes[cohort.id] ? (
                      <>
                        <code>{oneTimeCodes[cohort.id]}</code>
                        <small>
                          Copy this code now. It will not be shown again.
                        </small>
                      </>
                    ) : (
                      <small>
                        {cohort.join_code_status === 'active'
                          ? 'The code was shown when it was created or rotated.'
                          : 'No usable join code is available.'}
                      </small>
                    )}
                    <div className="learning-actions">
                      <button
                        type="button"
                        className="workspace-button workspace-button-outline"
                        disabled={busy !== ''}
                        onClick={() => void rotateCode(cohort)}
                      >
                        {busy === `rotate:${cohort.id}`
                          ? 'Rotating…'
                          : 'Rotate join code'}
                      </button>
                      <button
                        type="button"
                        className="workspace-button workspace-button-outline"
                        disabled={
                          busy !== '' || cohort.join_code_status === 'revoked'
                        }
                        onClick={() => void revokeCode(cohort)}
                      >
                        {busy === `revoke:${cohort.id}`
                          ? 'Revoking…'
                          : 'Revoke join code'}
                      </button>
                    </div>
                  </div>
                  <div className="learning-roster-controls">
                    <button
                      type="button"
                      className="workspace-button workspace-button-outline"
                      disabled={rosterLoading === cohort.id || busy !== ''}
                      onClick={() => void toggleRoster(cohort)}
                    >
                      {rosterLoading === cohort.id
                        ? 'Loading roster…'
                        : rosterOpen[cohort.id]
                          ? 'Hide roster'
                          : 'Show roster'}
                    </button>
                    {rosterOpen[cohort.id] && (
                      <div
                        className="learning-roster"
                        aria-label={`${cohort.name} roster`}
                      >
                        {rosters[cohort.id]?.length ? (
                          rosters[cohort.id].map((enrollment) => (
                            <div
                              className="learning-roster-item"
                              key={enrollment.id}
                            >
                              <div>
                                <strong>{enrollment.display_name}</strong>
                                <span>
                                  {enrollment.status === 'active'
                                    ? 'Active'
                                    : `Inactive · ${enrollment.end_reason || 'ended'}`}
                                </span>
                              </div>
                              {enrollment.status === 'active' ? (
                                <button
                                  type="button"
                                  className="workspace-button workspace-button-outline"
                                  disabled={busy !== ''}
                                  onClick={() =>
                                    void changeEnrollment(
                                      cohort,
                                      enrollment,
                                      false,
                                    )
                                  }
                                  aria-label={`Remove ${enrollment.display_name}`}
                                >
                                  Remove
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="workspace-button workspace-button-outline"
                                  disabled={busy !== ''}
                                  onClick={() =>
                                    void changeEnrollment(
                                      cohort,
                                      enrollment,
                                      true,
                                    )
                                  }
                                  aria-label={`Reinstate ${enrollment.display_name}`}
                                >
                                  Reinstate
                                </button>
                              )}
                            </div>
                          ))
                        ) : (
                          <p>No student enrollments yet.</p>
                        )}
                      </div>
                    )}
                  </div>
                  <Link
                    className="workspace-text-link"
                    to={`/app/coordinator/learning/${cohort.id}`}
                  >
                    View live progress →
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No cohorts yet"
              description="Create a cohort to invite a student and see their progress here."
            />
          )}
        </section>
      </div>
    </>
  )
}
