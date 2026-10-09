import { listPlans } from '../activityPlanApi'
import useUnsavedChanges from '../hooks/useUnsavedChanges'
import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { PageHeading } from '../components/WorkspaceUI'
import {
  archiveRoadmapVersion,
  copyRoadmapVersion,
  listOrganizations,
  listRoadmapVersions,
  publishRoadmapVersion,
  saveRoadmapDraft,
} from '../learningApi'

const editable = (phases) =>
  phases.map((phase) => ({
    title: phase.title,
    weeks: phase.weeks.map((week) => ({
      title: week.title,
      topics: week.topics.map((topic) => ({
        title: topic.title,
        description: topic.description,
      })),
    })),
  }))
const topicCount = (phases) =>
  phases.reduce(
    (total, phase) =>
      total + phase.weeks.reduce((sum, week) => sum + week.topics.length, 0),
    0,
  )
function shift(items, index, direction) {
  const next = index + direction
  if (next < 0 || next >= items.length) return
  ;[items[index], items[next]] = [items[next], items[index]]
}

export default function RoadmapVersionsPage() {
  const { roadmapId } = useParams()
  const [search] = useSearchParams()
  const preferredOrg = search.get('organizationId')
  const [organizationId, setOrganizationId] = useState('')
  const [sourcePlan, setSourcePlan] = useState(null)
  const [versions, setVersions] = useState([])
  const [activeId, setActiveId] = useState('')
  const [draft, setDraft] = useState([])
  const [dirty, setDirty] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  useUnsavedChanges(dirty)
  const active = versions.find((item) => item.version_id === activeId)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const organizations = await listOrganizations()
        const candidates = preferredOrg
          ? organizations.filter((item) => item.id === preferredOrg)
          : organizations
        for (const organization of candidates) {
          try {
            const rows = await listRoadmapVersions(organization.id, roadmapId)
            if (!mounted) return
            setOrganizationId(organization.id)
            setVersions(rows)
            const chosen = rows.at(-1)
            setActiveId(chosen?.version_id || '')
            setDraft(chosen ? editable(chosen.phases) : [])
            setLoading(false)
            return
          } catch {
            /* Try another authorized organization for direct links. */
          }
        }
        if (mounted) setError('Roadmap not found or access denied.')
      } catch (cause) {
        if (mounted) setError(cause.message)
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [preferredOrg, roadmapId])

  useEffect(() => {
    if (!organizationId) return
    let live = true
    listPlans(organizationId)
      .then((result) => {
        if (live)
          setSourcePlan(result.plans.find((p) => p.roadmap_id === roadmapId))
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [organizationId, roadmapId])
  function selectVersion(version) {
    if (dirty) {
      setError('Save your draft before switching versions.')
      return
    }
    setActiveId(version.version_id)
    setDraft(editable(version.phases))
    setDirty(false)
    setReviewing(false)
    setMessage('')
    setError('')
  }
  function change(mutator) {
    setDraft((current) => {
      const next = structuredClone(current)
      mutator(next)
      return next
    })
    setDirty(true)
    setReviewing(false)
  }
  function replaceVersion(updated) {
    setVersions((current) =>
      current.map((item) =>
        item.version_id === updated.version_id ? updated : item,
      ),
    )
    setActiveId(updated.version_id)
    setDraft(editable(updated.phases))
    setDirty(false)
    setReviewing(false)
  }
  async function save() {
    setBusy(true)
    setError('')
    try {
      replaceVersion(
        await saveRoadmapDraft(organizationId, roadmapId, activeId, draft),
      )
      setMessage('Draft saved. Review it before publishing.')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  async function publish() {
    setBusy(true)
    setError('')
    try {
      replaceVersion(
        await publishRoadmapVersion(organizationId, roadmapId, activeId),
      )
      setMessage('Version published. Cohorts can now be assigned to it.')
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  async function archive() {
    setBusy(true)
    setError('')
    try {
      replaceVersion(
        await archiveRoadmapVersion(organizationId, roadmapId, activeId),
      )
      setMessage(
        'Version archived. Existing cohorts still use this exact version.',
      )
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  async function copy() {
    setBusy(true)
    setError('')
    try {
      const next = await copyRoadmapVersion(organizationId, roadmapId, activeId)
      setVersions((current) => [...current, next])
      selectVersion(next)
      setMessage(
        `Draft v${next.version_number} created with independent topic IDs.`,
      )
    } catch (cause) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Roadmaps / Versions"
        title={active?.name || 'Roadmap versions'}
        description="Edit drafts, review their complete structure, and publish a fixed version for cohort assignment."
      />
      <Link className="workspace-text-link" to="/app/coordinator/roadmaps">
        ← All roadmaps
      </Link>
      {(search.get('activityPlanId') || sourcePlan) && (
        <Link
          className="workspace-text-link"
          to={`/app/coordinator/activity-plans/${search.get('activityPlanId') || sourcePlan.id}?organizationId=${organizationId || preferredOrg}`}
        >
          View source and review decisions
        </Link>
      )}
      {loading && <p role="status">Loading version history…</p>}
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
      {!!versions.length && (
        <div className="roadmap-version-layout">
          <aside
            className="workspace-card roadmap-version-list"
            aria-label="Version history"
          >
            <h2>Version history</h2>
            <label className="mobile-version-select">
              Version
              <select
                value={activeId}
                onChange={(e) =>
                  selectVersion(
                    versions.find((v) => v.version_id === e.target.value),
                  )
                }
              >
                {versions.map((v) => (
                  <option key={v.version_id} value={v.version_id}>
                    Version {v.version_number} · {v.status}
                  </option>
                ))}
              </select>
            </label>
            {versions.map((version) => (
              <button
                type="button"
                key={version.version_id}
                className={`roadmap-version-choice ${version.version_id === activeId ? 'is-active' : ''}`}
                onClick={() => selectVersion(version)}
              >
                <strong>Version {version.version_number}</strong>
                <span>
                  {version.status} · {version.topics.length} topics
                </span>
              </button>
            ))}
          </aside>
          {active && (
            <section className="workspace-card roadmap-editor">
              <div className="roadmap-editor-heading">
                <div>
                  <p className="workspace-card-label">
                    Version {active.version_number} · {active.status}
                  </p>
                  <h2>{active.name}</h2>
                  <p>{active.description || 'No description.'}</p>
                </div>
                <button
                  type="button"
                  className="workspace-button workspace-button-outline"
                  disabled={busy || dirty || active.status === 'draft'}
                  onClick={copy}
                >
                  Copy as new draft
                </button>
              </div>
              {active.status === 'draft' ? (
                <>
                  <p>
                    Edit phase, week, and topic titles below. Save the ordered
                    draft before review.
                  </p>
                  <fieldset className="plan-fieldset" disabled={busy}>
                    {draft.map((phase, phaseIndex) => (
                      <details open className="roadmap-phase" key={phaseIndex}>
                        <summary>
                          {phase.title || 'Untitled phase'} ·{' '}
                          {phase.weeks.length} weeks
                        </summary>
                        <div className="roadmap-edit-row">
                          <label className="form-field">
                            <span>Phase {phaseIndex + 1}</span>
                            <input
                              value={phase.title}
                              maxLength={200}
                              onChange={(event) =>
                                change((next) => {
                                  next[phaseIndex].title = event.target.value
                                })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            aria-label={`Move ${phase.title || 'phase'} up`}
                            disabled={phaseIndex === 0}
                            onClick={() =>
                              change((next) => shift(next, phaseIndex, -1))
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move ${phase.title || 'phase'} down`}
                            disabled={phaseIndex === draft.length - 1}
                            onClick={() =>
                              change((next) => shift(next, phaseIndex, 1))
                            }
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              window.confirm(
                                'Remove this phase and all its topics?',
                              ) && change((next) => next.splice(phaseIndex, 1))
                            }
                          >
                            Remove phase
                          </button>
                        </div>
                        {phase.weeks.map((week, weekIndex) => (
                          <details
                            open
                            className="roadmap-week"
                            key={weekIndex}
                          >
                            <summary>
                              {week.title || 'Untitled week'} ·{' '}
                              {week.topics.length} topics
                            </summary>
                            <div className="roadmap-edit-row">
                              <label className="form-field">
                                <span>Week {weekIndex + 1}</span>
                                <input
                                  value={week.title}
                                  maxLength={200}
                                  onChange={(event) =>
                                    change((next) => {
                                      next[phaseIndex].weeks[weekIndex].title =
                                        event.target.value
                                    })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                aria-label={`Move ${week.title || 'week'} up`}
                                disabled={weekIndex === 0}
                                onClick={() =>
                                  change((next) =>
                                    shift(
                                      next[phaseIndex].weeks,
                                      weekIndex,
                                      -1,
                                    ),
                                  )
                                }
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                aria-label={`Move ${week.title || 'week'} down`}
                                disabled={weekIndex === phase.weeks.length - 1}
                                onClick={() =>
                                  change((next) =>
                                    shift(next[phaseIndex].weeks, weekIndex, 1),
                                  )
                                }
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  window.confirm(
                                    'Remove this week and all its topics?',
                                  ) &&
                                  change((next) =>
                                    next[phaseIndex].weeks.splice(weekIndex, 1),
                                  )
                                }
                              >
                                Remove week
                              </button>
                            </div>
                            {week.topics.map((topic, topicIndex) => (
                              <div
                                className="roadmap-edit-row roadmap-topic"
                                key={topicIndex}
                              >
                                <label className="form-field">
                                  <span>Topic {topicIndex + 1}</span>
                                  <input
                                    value={topic.title}
                                    maxLength={200}
                                    onChange={(event) =>
                                      change((next) => {
                                        next[phaseIndex].weeks[
                                          weekIndex
                                        ].topics[topicIndex].title =
                                          event.target.value
                                      })
                                    }
                                  />
                                </label>
                                <label className="form-field">
                                  <span>Description</span>
                                  <textarea
                                    rows={3}
                                    value={topic.description}
                                    maxLength={1000}
                                    onChange={(event) =>
                                      change((next) => {
                                        next[phaseIndex].weeks[
                                          weekIndex
                                        ].topics[topicIndex].description =
                                          event.target.value
                                      })
                                    }
                                  />
                                </label>
                                <button
                                  type="button"
                                  aria-label={`Move ${topic.title || 'topic'} up`}
                                  disabled={topicIndex === 0}
                                  onClick={() =>
                                    change((next) =>
                                      shift(
                                        next[phaseIndex].weeks[weekIndex]
                                          .topics,
                                        topicIndex,
                                        -1,
                                      ),
                                    )
                                  }
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Move ${topic.title || 'topic'} down`}
                                  disabled={
                                    topicIndex === week.topics.length - 1
                                  }
                                  onClick={() =>
                                    change((next) =>
                                      shift(
                                        next[phaseIndex].weeks[weekIndex]
                                          .topics,
                                        topicIndex,
                                        1,
                                      ),
                                    )
                                  }
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    window.confirm('Remove this topic?') &&
                                    change((next) =>
                                      next[phaseIndex].weeks[
                                        weekIndex
                                      ].topics.splice(topicIndex, 1),
                                    )
                                  }
                                >
                                  Remove topic
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              disabled={week.topics.length >= 24}
                              onClick={() =>
                                change((next) =>
                                  next[phaseIndex].weeks[weekIndex].topics.push(
                                    {
                                      title: '',
                                      description: '',
                                    },
                                  ),
                                )
                              }
                            >
                              + Add topic
                            </button>
                          </details>
                        ))}
                        <button
                          type="button"
                          disabled={phase.weeks.length >= 52}
                          onClick={() =>
                            change((next) =>
                              next[phaseIndex].weeks.push({
                                title: '',
                                topics: [],
                              }),
                            )
                          }
                        >
                          + Add week
                        </button>
                      </details>
                    ))}
                  </fieldset>
                  <div className="roadmap-actions plan-save-bar">
                    <p role="status">
                      {busy
                        ? 'Saving…'
                        : error && dirty
                          ? 'Save failed'
                          : dirty
                            ? 'Unsaved changes — save before review.'
                            : 'Saved'}
                    </p>
                    <button
                      type="button"
                      disabled={draft.length >= 12}
                      onClick={() =>
                        change((next) => next.push({ title: '', weeks: [] }))
                      }
                    >
                      + Add phase
                    </button>
                    <button
                      type="button"
                      className="workspace-button"
                      disabled={busy || !dirty}
                      onClick={save}
                    >
                      Save draft
                    </button>
                    <button
                      type="button"
                      className="workspace-button workspace-button-outline"
                      disabled={busy || dirty}
                      onClick={() => setReviewing(true)}
                    >
                      Review for publication
                    </button>
                  </div>
                  {reviewing && (
                    <div
                      className="roadmap-review"
                      role="region"
                      aria-label="Publication review"
                    >
                      <h3>Publication review</h3>
                      <div className="roadmap-readonly">
                        {draft.map((phase, pi) => (
                          <section key={pi}>
                            <h3>{phase.title}</h3>
                            {phase.weeks.map((week, wi) => (
                              <section key={wi}>
                                <h4>{week.title}</h4>
                                <ol>
                                  {week.topics.map((topic, ti) => (
                                    <li key={ti}>
                                      <strong>{topic.title}</strong>
                                      <p>{topic.description}</p>
                                    </li>
                                  ))}
                                </ol>
                              </section>
                            ))}
                          </section>
                        ))}
                      </div>
                      <p>
                        {draft.length} phases ·{' '}
                        {draft.reduce(
                          (sum, phase) => sum + phase.weeks.length,
                          0,
                        )}{' '}
                        weeks · {topicCount(draft)} topics.
                      </p>
                      <p>
                        Publishing freezes this version. Later changes require a
                        new draft; existing cohorts stay on their assigned
                        version.
                      </p>
                      <button
                        type="button"
                        className="workspace-button"
                        disabled={busy}
                        onClick={publish}
                      >
                        Publish version {active.version_number}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="roadmap-readonly">
                    {active.phases.map((phase) => (
                      <div key={phase.id} className="roadmap-phase">
                        <h3>{phase.title}</h3>
                        {phase.weeks.map((week) => (
                          <div key={week.id} className="roadmap-week">
                            <h4>{week.title}</h4>
                            <ol>
                              {week.topics.map((topic) => (
                                <li key={topic.id}>
                                  <strong>{topic.title}</strong>
                                  {topic.description && (
                                    <p>{topic.description}</p>
                                  )}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                  {active.status === 'published' && (
                    <Link
                      className="workspace-button"
                      to="/app/coordinator/cohorts"
                    >
                      Assign to cohort
                    </Link>
                  )}
                  {active.status === 'published' && (
                    <button
                      type="button"
                      className="workspace-button workspace-button-outline"
                      disabled={busy}
                      onClick={archive}
                    >
                      Archive version
                    </button>
                  )}
                  {active.status === 'archived' && (
                    <p>
                      This version is archived. Assigned cohorts and their
                      progress remain available.
                    </p>
                  )}
                </>
              )}
            </section>
          )}
        </div>
      )}
    </>
  )
}
