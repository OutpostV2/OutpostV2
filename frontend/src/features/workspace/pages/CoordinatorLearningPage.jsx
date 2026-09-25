import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  EmptyState,
  PageHeading,
  SectionHeading,
} from '../components/WorkspaceUI'
import {
  createCohort,
  createOrganization,
  createRoadmap,
  listCohorts,
  listOrganizations,
  listRoadmaps,
} from '../learningApi'
export default function CoordinatorLearningPage() {
  const [organizations, setOrganizations] = useState([])
  const [organizationId, setOrganizationId] = useState('')
  const [roadmaps, setRoadmaps] = useState([])
  const [cohorts, setCohorts] = useState([])
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
  useEffect(() => {
    let active = true
    void listOrganizations()
      .then((items) => {
        if (!active) return
        setOrganizations(items)
        setOrganizationId((current) => current || items[0]?.id || '')
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
  }, [])
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
          loadedRoadmaps.some((roadmap) => roadmap.version_id === current)
            ? current
            : loadedRoadmaps[0]?.version_id || '',
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
  }, [organizationId])
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
      setVersionId(created.version_id)
      setRoadmapName('')
      setRoadmapDescription('')
      setTopicLines('')
      setMessage(
        'Roadmap published. Create a cohort and assign this version next.',
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
      setCohorts((items) => [...items, created])
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
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Live learning"
        title="Build a learning journey"
        description="Create an organization, publish a roadmap, and invite students to a cohort. Changes here are saved in PostgreSQL."
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
            description="Publish a simple, immutable first version"
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
                {busy === 'roadmap' ? 'Publishing…' : 'Publish roadmap'}
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
                    topics · Published
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="workspace-card learning-step">
          <SectionHeading
            title="3. Cohort"
            description="Assign an exact roadmap version and share its join code"
          />
          {roadmaps.length ? (
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
                  {roadmaps.map((roadmap) => (
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
                    <span>Student join code</span>
                    <code>{cohort.invite_code}</code>
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
