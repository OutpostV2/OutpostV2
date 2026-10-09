import { UploadedPlans } from './ActivityPlanUploadPage'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, PageHeading } from '../components/WorkspaceUI'
import { createRoadmap, listOrganizations, listRoadmaps } from '../learningApi'

export default function RoadmapsPage() {
  const [creating, setCreating] = useState(false)
  const [filter, setFilter] = useState('')
  const [organizations, setOrganizations] = useState([])
  const [organizationId, setOrganizationId] = useState('')
  const [versions, setVersions] = useState([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [topics, setTopics] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    listOrganizations()
      .then((items) => {
        if (!active) return
        setOrganizations(items)
        setOrganizationId(items[0]?.id || '')
      })
      .catch((cause) => {
        if (active) setError(cause.message)
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
    listRoadmaps(organizationId)
      .then((items) => {
        if (active) setVersions(items)
      })
      .catch((cause) => {
        if (active) setError(cause.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [organizationId])
  async function createDraft(event) {
    event.preventDefault()
    const titles = topics
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
    if (titles.length < 1 || titles.length > 24) {
      setError('Enter 1–24 starter topics, one per line.')
      return
    }
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const created = await createRoadmap(organizationId, {
        name: name.trim(),
        description: description.trim(),
        topics: titles.map((title) => ({ title, description: '' })),
      })
      setVersions((current) => [...current, created])
      setName('')
      setDescription('')
      setTopics('')
      setMessage('Draft created. Open its versions to review and publish it.')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  const latest = [...versions]
    .sort((a, b) => b.version_number - a.version_number)
    .filter(
      (version, index, rows) =>
        rows.findIndex((row) => row.id === version.id) === index,
    )
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Roadmaps"
        title="Roadmaps"
        description="Create drafts, review the full learning path, and publish stable versions for cohorts."
      />
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
      {loading && <p role="status">Loading roadmaps…</p>}
      <div className="roadmap-toolbar">
        {' '}
        <label className="form-field">
          <span>Organization</span>
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
        <label className="form-field">
          Find roadmap
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            type="search"
          />
        </label>
        <Link
          className="workspace-button"
          to={`/app/coordinator/activity-plans/new?organizationId=${organizationId}`}
        >
          Import activity plan
        </Link>
        <button
          className="workspace-button workspace-button-outline"
          onClick={() => setCreating(!creating)}
        >
          Create manually
        </button>
      </div>
      {creating && (
        <section className="workspace-card roadmap-panel">
          <h2>Create a roadmap draft</h2>
          {organizations.length ? (
            <>
              <form className="learning-form" onSubmit={createDraft}>
                <label className="form-field">
                  <span>Roadmap name</span>
                  <input
                    required
                    minLength={2}
                    maxLength={200}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Career readiness"
                  />
                </label>
                <label className="form-field">
                  <span>Description</span>
                  <input
                    maxLength={2000}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="What this roadmap covers"
                  />
                </label>
                <label className="form-field">
                  <span>Starter topics, one per line</span>
                  <textarea
                    required
                    rows={4}
                    value={topics}
                    onChange={(event) => setTopics(event.target.value)}
                    placeholder={'Set goals\nBuild a portfolio'}
                  />
                </label>
                <button className="workspace-button" disabled={busy}>
                  {busy ? 'Creating…' : 'Create draft'}
                </button>
              </form>
            </>
          ) : (
            <p>Create an organization first to manage roadmaps.</p>
          )}
        </section>
      )}
      <section className="roadmap-list" aria-label="Roadmap versions">
        {latest
          .filter((r) => r.name.toLowerCase().includes(filter.toLowerCase()))
          .map((roadmap) => (
            <article
              className="workspace-card roadmap-summary"
              key={roadmap.id}
            >
              <div>
                <p className="workspace-card-label">
                  {roadmap.status} · latest v{roadmap.version_number}
                </p>
                <h2>{roadmap.name}</h2>
                <p>{roadmap.description || 'No description yet.'}</p>
                <p>
                  {
                    versions.filter((version) => version.id === roadmap.id)
                      .length
                  }{' '}
                  versions · {roadmap.topics.length} topics in latest version
                </p>
              </div>
              <Link
                className="workspace-text-link"
                to={`/app/coordinator/roadmaps/${roadmap.id}/versions?organizationId=${organizationId}`}
              >
                Manage versions →
              </Link>
            </article>
          ))}
        {!loading && !latest.length && (
          <EmptyState
            title="No roadmaps yet"
            description="Create a draft to start your first learning path."
          />
        )}
      </section>
      <UploadedPlans organizationId={organizationId} />
    </>
  )
}
