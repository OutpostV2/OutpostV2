import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { PageHeading } from '../components/WorkspaceUI'
import {
  getPlan,
  savePlan,
  retryPlan,
  convertPlan,
  downloadPlan,
} from '../activityPlanApi'
import useUnsavedChanges from '../hooks/useUnsavedChanges'
import { outlineProblems } from '../outlineValidation'
const uid = () => crypto.randomUUID()
const topicsOf = (p) =>
  p.phases.flatMap((ph) => ph.weeks.flatMap((w) => w.topics))
export default function ActivityPlanPage() {
  const { planId } = useParams()
  const [search] = useSearchParams()
  const org = search.get('organizationId')
  return (
    <ActivityPlanReview key={`${org}:${planId}`} org={org} planId={planId} />
  )
}
function ActivityPlanReview({ org, planId }) {
  const navigate = useNavigate()
  const [plan, setPlan] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [tab, setTab] = useState('draft'),
    [reload, setReload] = useState(0)
  useUnsavedChanges(dirty)
  useEffect(() => {
    let active = true,
      timer
    async function load() {
      try {
        const p = await getPlan(org, planId)
        if (!active) return
        setPlan(p)
        if (['queued', 'extracting'].includes(p.status))
          timer = setTimeout(load, 2000)
      } catch (e) {
        if (active) setError(e.message)
      }
    }
    void load()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [org, planId, reload])
  function edit(fn) {
    setPlan((p) => {
      const next = structuredClone(p)
      next.review_confirmed = false
      fn(next)
      return next
    })
    setDirty(true)
    setError('')
  }
  async function action(fn) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  function move(rows, index, delta) {
    const target = index + delta
    if (target >= 0 && target < rows.length)
      [rows[index], rows[target]] = [rows[target], rows[index]]
  }
  function focusSource(id) {
    setTab('source')
    setTimeout(() => document.getElementById(`decision-${id}`)?.focus(), 0)
  }
  function remove(fn) {
    if (
      window.confirm(
        'Remove this item and its contents? Source material will need review again.',
      )
    )
      edit((p) => {
        fn(p)
        const ids = new Set(topicsOf(p.proposal).map((t) => t.id))
        p.review_items.forEach((r) => {
          if (r.topic_id && !ids.has(r.topic_id)) {
            r.topic_id = null
            r.disposition = 'unresolved'
          }
        })
      })
  }
  async function download() {
    const blob = await downloadPlan(org, planId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = plan.filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const topics = plan?.proposal ? topicsOf(plan.proposal) : []
  const unresolved =
    plan?.review_items?.filter(
      (r) =>
        r.disposition === 'unresolved' ||
        (r.disposition === 'excluded' && r.reason.trim().length < 2) ||
        (r.disposition === 'included' &&
          !r.topic_id &&
          !/^(?:module|phase|week|session)\s+\d+[\s.:–-]+/i.test(r.text)),
    ).length || 0
  const problems = plan?.proposal
    ? outlineProblems(plan.proposal.phases, 'Activity')
    : []
  if (plan && (plan.name.trim().length < 2 || plan.name.length > 200))
    problems.unshift('Plan name: enter 2–200 characters.')
  const invalid = problems.length > 0
  const blocked = dirty || unresolved || !plan?.review_confirmed || invalid
  const draftUrl = (p) =>
    `/app/coordinator/roadmaps/${p.roadmap_id}/versions?organizationId=${org}&activityPlanId=${planId}`
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Roadmaps / Activity plan"
        title={plan?.name || 'Activity plan'}
        description="Check the source, correct the outline, then create an editable roadmap draft."
      />
      <Link to="/app/coordinator/roadmaps">← All roadmaps</Link>
      {error && (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            onClick={() => {
              if (
                !dirty ||
                window.confirm(
                  'Discard your local edits and load the latest saved review?',
                )
              ) {
                setDirty(false)
                setError('')
                setReload((n) => n + 1)
              }
            }}
          >
            Reload saved review
          </button>
        </div>
      )}
      {!plan && <p role="status">Loading activity plan…</p>}
      {plan && (
        <>
          <div className="plan-meta">
            <span>
              {plan.filename} · {plan.status}
            </span>
            <button onClick={() => action(download)} disabled={busy}>
              Download source PDF
            </button>
          </div>
          {['queued', 'extracting'].includes(plan.status) && (
            <section className="workspace-card">
              <h2>
                {plan.status === 'queued'
                  ? 'Waiting to extract'
                  : 'Extracting page text'}
              </h2>
              <p role="status">
                You can return to Roadmaps and continue here later.
              </p>
            </section>
          )}
          {plan.status === 'failed' && (
            <section className="workspace-card">
              <h2>Extraction needs attention</h2>
              <p>{plan.failure?.message}</p>
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    setPlan(await retryPlan(org, planId, plan.revision))
                    setReload((n) => n + 1)
                  })
                }
              >
                Retry extraction
              </button>
            </section>
          )}
          {plan.status === 'converted' && (
            <section className="workspace-card">
              <h2>Draft created</h2>
              <details>
                <summary>Source text and review decisions</summary>
                {plan.warnings.map((w) => (
                  <p key={w.id}>
                    {w.message} · Page {w.page_number}
                  </p>
                ))}
                {plan.review_items.map((r) => (
                  <article key={r.id}>
                    <small>
                      Page {r.page_number} · {r.disposition}
                    </small>
                    <p>{r.text}</p>
                    {r.reason && <p>Reason: {r.reason}</p>}
                  </article>
                ))}
                {plan.pages.map((p) => (
                  <article key={p.page_number}>
                    <h3>Page {p.page_number}</h3>
                    <pre className="source-text">{p.text}</pre>
                  </article>
                ))}
              </details>
              <p>
                The source remains available here. Edit and publish the linked
                roadmap when ready.
              </p>
              <Link className="workspace-button" to={draftUrl(plan)}>
                Open draft
              </Link>
            </section>
          )}
          {plan.status === 'ready' && (
            <>
              <div
                className="plan-tabs"
                role="tablist"
                aria-label="Review view"
              >
                {['draft', 'source'].map((t) => (
                  <button
                    key={t}
                    role="tab"
                    id={`plan-${t}-tab`}
                    aria-controls={`plan-${t}-panel`}
                    aria-selected={tab === t}
                    tabIndex={tab === t ? 0 : -1}
                    onClick={() => setTab(t)}
                    onKeyDown={(e) => {
                      if (
                        !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                          e.key,
                        )
                      )
                        return
                      e.preventDefault()
                      const next =
                        e.key === 'Home'
                          ? 'draft'
                          : e.key === 'End'
                            ? 'source'
                            : t === 'draft'
                              ? 'source'
                              : 'draft'
                      setTab(next)
                      document.getElementById(`plan-${next}-tab`)?.focus()
                    }}
                  >
                    {t === 'draft' ? 'Draft' : 'Source'}
                  </button>
                ))}
              </div>
              <div className={`plan-review-grid show-${tab}`}>
                <section
                  className="workspace-card plan-draft"
                  id="plan-draft-panel"
                  role="tabpanel"
                  aria-labelledby="plan-draft-tab"
                >
                  <h2>Suggested outline</h2>
                  <p>
                    Dates remain source text. Set deadlines after assigning a
                    cohort.
                  </p>
                  <label className="form-field">
                    Plan name
                    <input
                      disabled={busy}
                      value={plan.name}
                      maxLength={200}
                      onChange={(e) =>
                        edit((p) => {
                          p.name = e.target.value
                        })
                      }
                    />
                  </label>
                  <fieldset disabled={busy} className="plan-fieldset">
                    {plan.proposal.phases.map((ph, pi) => (
                      <details
                        open={pi === 0 || !ph.title}
                        key={ph.id}
                        className="roadmap-phase"
                      >
                        <summary>
                          {ph.title || 'Untitled phase'} · {ph.weeks.length}{' '}
                          weeks
                        </summary>
                        <label className="form-field">
                          Phase title
                          <input
                            value={ph.title}
                            maxLength={200}
                            onChange={(e) =>
                              edit((p) => {
                                p.proposal.phases[pi].title = e.target.value
                              })
                            }
                          />
                        </label>
                        <div className="outline-controls">
                          <button
                            onClick={() =>
                              edit((p) => move(p.proposal.phases, pi, -1))
                            }
                            disabled={!pi}
                            aria-label={`Move ${ph.title} up`}
                          >
                            ↑
                          </button>
                          <button
                            onClick={() =>
                              edit((p) => move(p.proposal.phases, pi, 1))
                            }
                            disabled={pi === plan.proposal.phases.length - 1}
                            aria-label={`Move ${ph.title} down`}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() =>
                              remove((p) => p.proposal.phases.splice(pi, 1))
                            }
                          >
                            Remove phase
                          </button>
                        </div>
                        {ph.weeks.map((w, wi) => (
                          <details
                            open={(pi === 0 && wi === 0) || !w.title}
                            key={w.id}
                            className="roadmap-week"
                          >
                            <summary>
                              {w.title || 'Untitled week'} · {w.topics.length}{' '}
                              activities
                            </summary>
                            <label className="form-field">
                              Week title
                              <input
                                value={w.title}
                                maxLength={200}
                                onChange={(e) =>
                                  edit((p) => {
                                    p.proposal.phases[pi].weeks[wi].title =
                                      e.target.value
                                  })
                                }
                              />
                            </label>
                            <div className="outline-controls">
                              <button
                                disabled={!wi}
                                aria-label={`Move ${w.title} up`}
                                onClick={() =>
                                  edit((p) =>
                                    move(p.proposal.phases[pi].weeks, wi, -1),
                                  )
                                }
                              >
                                ↑
                              </button>
                              <button
                                disabled={wi === ph.weeks.length - 1}
                                aria-label={`Move ${w.title} down`}
                                onClick={() =>
                                  edit((p) =>
                                    move(p.proposal.phases[pi].weeks, wi, 1),
                                  )
                                }
                              >
                                ↓
                              </button>
                              <button
                                onClick={() =>
                                  remove((p) =>
                                    p.proposal.phases[pi].weeks.splice(wi, 1),
                                  )
                                }
                              >
                                Remove week
                              </button>
                            </div>
                            {w.topics.map((t, ti) => (
                              <div
                                key={t.id}
                                className="plan-topic"
                                id={`topic-${t.id}`}
                              >
                                <label className="form-field">
                                  Activity title
                                  <input
                                    value={t.title}
                                    maxLength={200}
                                    onChange={(e) =>
                                      edit((p) => {
                                        p.proposal.phases[pi].weeks[wi].topics[
                                          ti
                                        ].title = e.target.value
                                      })
                                    }
                                  />
                                </label>
                                <label className="form-field">
                                  Activity description
                                  <textarea
                                    rows={3}
                                    maxLength={1000}
                                    value={t.description}
                                    onChange={(e) =>
                                      edit((p) => {
                                        p.proposal.phases[pi].weeks[wi].topics[
                                          ti
                                        ].description = e.target.value
                                      })
                                    }
                                  />
                                </label>
                                <div className="source-references">
                                  {t.source_refs
                                    .map((ref) =>
                                      plan.review_items.find(
                                        (item) => item.id === ref,
                                      ),
                                    )
                                    .filter(Boolean)
                                    .map((item) => (
                                      <button
                                        type="button"
                                        key={item.id}
                                        onClick={() => focusSource(item.id)}
                                      >
                                        View source on page {item.page_number}
                                      </button>
                                    ))}
                                </div>
                                <label className="form-field">
                                  Move activity to week
                                  <select
                                    value={w.id}
                                    onChange={(e) =>
                                      edit((p) => {
                                        const target = p.proposal.phases
                                          .flatMap((ph) => ph.weeks)
                                          .find((w) => w.id === e.target.value)
                                        if (target.topics.length >= 24) return
                                        const [topic] = p.proposal.phases[
                                          pi
                                        ].weeks[wi].topics.splice(ti, 1)
                                        target.topics.push(topic)
                                      })
                                    }
                                  >
                                    {plan.proposal.phases.flatMap((ph) =>
                                      ph.weeks.map((w) => (
                                        <option key={w.id} value={w.id}>
                                          {ph.title} / {w.title}
                                        </option>
                                      )),
                                    )}
                                  </select>
                                </label>
                                <div className="outline-controls">
                                  <button
                                    disabled={!ti}
                                    aria-label={`Move ${t.title} up`}
                                    onClick={() =>
                                      edit((p) =>
                                        move(
                                          p.proposal.phases[pi].weeks[wi]
                                            .topics,
                                          ti,
                                          -1,
                                        ),
                                      )
                                    }
                                  >
                                    ↑
                                  </button>
                                  <button
                                    disabled={ti === w.topics.length - 1}
                                    aria-label={`Move ${t.title} down`}
                                    onClick={() =>
                                      edit((p) =>
                                        move(
                                          p.proposal.phases[pi].weeks[wi]
                                            .topics,
                                          ti,
                                          1,
                                        ),
                                      )
                                    }
                                  >
                                    ↓
                                  </button>
                                  <button
                                    onClick={() =>
                                      remove((p) =>
                                        p.proposal.phases[pi].weeks[
                                          wi
                                        ].topics.splice(ti, 1),
                                      )
                                    }
                                  >
                                    Remove activity
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button
                              disabled={
                                w.topics.length >= 24 || topics.length >= 500
                              }
                              onClick={() =>
                                edit((p) =>
                                  p.proposal.phases[pi].weeks[wi].topics.push({
                                    id: uid(),
                                    title: '',
                                    description: '',
                                    source_refs: [],
                                  }),
                                )
                              }
                            >
                              Add activity
                            </button>
                          </details>
                        ))}
                        <button
                          disabled={ph.weeks.length >= 52}
                          onClick={() =>
                            edit((p) =>
                              p.proposal.phases[pi].weeks.push({
                                id: uid(),
                                title: '',
                                topics: [],
                              }),
                            )
                          }
                        >
                          Add week
                        </button>
                      </details>
                    ))}
                    <button
                      disabled={plan.proposal.phases.length >= 12}
                      onClick={() =>
                        edit((p) =>
                          p.proposal.phases.push({
                            id: uid(),
                            title: '',
                            weeks: [],
                          }),
                        )
                      }
                    >
                      Add phase
                    </button>
                  </fieldset>
                </section>
                <section
                  className="workspace-card plan-source"
                  id="plan-source-panel"
                  role="tabpanel"
                  aria-labelledby="plan-source-tab"
                >
                  <h2>Source review</h2>
                  {plan.warnings.map((w) => (
                    <p key={w.id} className="source-warning">
                      <a
                        href={`#source-${w.review_item_id}`}
                        onClick={() =>
                          setTimeout(
                            () =>
                              document
                                .getElementById(`decision-${w.review_item_id}`)
                                ?.focus(),
                            0,
                          )
                        }
                      >
                        {w.message} · Page {w.page_number}
                      </a>
                    </p>
                  ))}
                  {plan.review_items.map((r, i) => (
                    <div
                      className="source-item"
                      id={`source-${r.id}`}
                      key={r.id}
                    >
                      <small>
                        Source {i + 1} · Page {r.page_number}
                      </small>
                      <p>{r.text}</p>
                      <label className="form-field">
                        Decision for source {i + 1}
                        <select
                          id={`decision-${r.id}`}
                          disabled={busy}
                          value={r.disposition}
                          onChange={(e) =>
                            edit((p) => {
                              p.review_items[i].disposition = e.target.value
                              if (e.target.value !== 'included') {
                                p.review_items[i].topic_id = null
                                topicsOf(p.proposal).forEach((t) => {
                                  t.source_refs = t.source_refs.filter(
                                    (id) => id !== r.id,
                                  )
                                })
                              }
                              if (e.target.value === 'unresolved')
                                p.review_confirmed = false
                            })
                          }
                        >
                          <option value="unresolved">Needs review</option>
                          <option value="included">Include in roadmap</option>
                          <option value="excluded">Exclude with reason</option>
                        </select>
                      </label>
                      {r.disposition === 'excluded' && (
                        <label className="form-field">
                          Exclusion reason for source {i + 1}
                          <input
                            disabled={busy}
                            maxLength={1000}
                            value={r.reason}
                            onChange={(e) =>
                              edit((p) => {
                                p.review_items[i].reason = e.target.value
                              })
                            }
                          />
                        </label>
                      )}
                      {r.disposition === 'included' && (
                        <label className="form-field">
                          Activity for source {i + 1}
                          <select
                            disabled={busy}
                            value={r.topic_id || ''}
                            onChange={(e) =>
                              edit((p) => {
                                p.review_items[i].topic_id =
                                  e.target.value || null
                                p.proposal.phases.forEach((ph) =>
                                  ph.weeks.forEach((w) =>
                                    w.topics.forEach((t) => {
                                      t.source_refs = t.source_refs.filter(
                                        (id) => id !== r.id,
                                      )
                                      if (t.id === e.target.value)
                                        t.source_refs.push(r.id)
                                    }),
                                  ),
                                )
                              })
                            }
                          >
                            <option value="">
                              {/^(?:module|phase|week|session)\s+\d+[\s.:–-]+/i.test(
                                r.text,
                              )
                                ? 'Heading / context only'
                                : 'Choose an activity'}
                            </option>
                            {topics.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.title || 'Untitled activity'}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>
                  ))}
                  <details>
                    <summary>Full extracted page text</summary>
                    {plan.pages.map((p) => (
                      <article key={p.page_number}>
                        <h3>Page {p.page_number}</h3>
                        <pre className="source-text">{p.text}</pre>
                      </article>
                    ))}
                  </details>
                </section>
              </div>
              <div className="plan-save-bar">
                {invalid && (
                  <details className="outline-validation" open>
                    <summary>
                      Outline needs attention ({problems.length})
                    </summary>
                    <ul>
                      {problems.map((problem) => (
                        <li key={problem}>{problem}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={plan.review_confirmed}
                    onChange={(e) =>
                      edit((p) => {
                        p.review_confirmed = e.target.checked
                      })
                    }
                  />{' '}
                  I have checked the outline against the source.
                </label>
                <p role="status">
                  {busy
                    ? 'Saving…'
                    : error && dirty
                      ? 'Save failed'
                      : dirty
                        ? 'Unsaved changes'
                        : 'Saved'}
                </p>
                {Boolean(blocked) && (
                  <p>
                    {unresolved ? `Resolve ${unresolved} source items. ` : ''}
                    {invalid
                      ? 'Each phase needs a week and each week an activity; titles need 2–200 characters. '
                      : ''}
                    {!plan.review_confirmed
                      ? 'Confirm your source review. '
                      : ''}
                    {dirty ? 'Save changes before creating the draft.' : ''}
                  </p>
                )}
                <div className="outline-controls">
                  <button
                    className="workspace-button workspace-button-outline"
                    disabled={busy || !dirty}
                    onClick={() =>
                      action(async () => {
                        setPlan(await savePlan(org, planId, plan))
                        setDirty(false)
                      })
                    }
                  >
                    Save review
                  </button>
                  <button
                    className="workspace-button"
                    disabled={busy || Boolean(blocked)}
                    onClick={() =>
                      action(async () => {
                        const result = await convertPlan(
                          org,
                          planId,
                          plan.revision,
                        )
                        navigate(draftUrl(result))
                      })
                    }
                  >
                    Create roadmap draft
                  </button>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
