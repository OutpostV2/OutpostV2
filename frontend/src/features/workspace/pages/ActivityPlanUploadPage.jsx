import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { listOrganizations } from '../learningApi'
import { listPlans, uploadPlan } from '../activityPlanApi'
import { PageHeading } from '../components/WorkspaceUI'
export default function ActivityPlanUploadPage() {
  const [search] = useSearchParams(),
    navigate = useNavigate()
  const [organizations, setOrganizations] = useState([]),
    [selectedOrg, setOrg] = useState(search.get('organizationId') || ''),
    [limits, setLimits] = useState(null),
    [name, setName] = useState(''),
    [file, setFile] = useState(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true)
  const org =
    organizations.find((o) => o.id === selectedOrg)?.id ||
    organizations[0]?.id ||
    ''
  useEffect(() => {
    let active = true
    listOrganizations()
      .then((rows) => {
        if (active) {
          setOrganizations(
            rows.filter((o) =>
              ['owner', 'admin', 'coordinator'].includes(o.role),
            ),
          )
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!org) return
    let active = true
    listPlans(org)
      .then((result) => {
        if (active) setLimits(result.limits)
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
    return () => {
      active = false
    }
  }, [org])
  async function submit(e) {
    e.preventDefault()
    if (!file || !limits || !org || busy) return
    if (name.trim().length < 2) {
      setError('Enter a plan name with at least 2 characters.')
      return
    }
    if (file.size > limits.max_bytes) {
      setError('This PDF exceeds the upload limit. Choose a smaller file.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const p = await uploadPlan(org, name.trim(), file)
      navigate(`/app/coordinator/activity-plans/${p.id}?organizationId=${org}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeading
        eyebrow="Coordinator / Roadmaps"
        title="Import activity plan"
        description="Turn a selectable-text PDF into a reviewed, editable learning outline."
      />
      <Link to="/app/coordinator/roadmaps">← All roadmaps</Link>
      {loading && <p role="status">Loading your organizations…</p>}
      <section className="workspace-card import-form">
        <h2>Choose your plan</h2>
        <p>
          Use a PDF with selectable text. Scanned pages need a text-based export
          before import.
        </p>
        {limits && (
          <p>
            One PDF · up to {limits.max_bytes / 1048576} MiB ·{' '}
            {limits.max_pages} pages · {limits.max_characters.toLocaleString()}{' '}
            extracted characters.
          </p>
        )}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {!loading && !organizations.length && !error && (
          <p>
            You need an active owner, admin or coordinator membership to import
            a plan. <Link to="/app/organizations">Manage organizations</Link>
          </p>
        )}
        {!!organizations.length && (
          <form onSubmit={submit} className="learning-form">
            <label className="form-field">
              Organization
              <select
                required
                disabled={busy}
                value={org}
                onChange={(e) => {
                  setOrg(e.target.value)
                  setLimits(null)
                }}
              >
                {organizations.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Plan name
              <input
                required
                minLength={2}
                maxLength={200}
                disabled={busy}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="form-field">
              PDF file
              <input
                type="file"
                accept=".pdf,application/pdf"
                required
                disabled={busy}
                onChange={(e) => setFile(e.target.files[0] || null)}
              />
            </label>
            <button className="workspace-button" disabled={busy || !limits}>
              {busy ? 'Uploading…' : 'Upload activity plan'}
            </button>
          </form>
        )}
      </section>
    </>
  )
}
export function UploadedPlans({ organizationId }) {
  return (
    <UploadedPlanList key={organizationId} organizationId={organizationId} />
  )
}
function UploadedPlanList({ organizationId }) {
  const [plans, setPlans] = useState([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!organizationId) return
    let active = true
    listPlans(organizationId)
      .then((r) => {
        if (active) {
          setPlans(r.plans)
          setError('')
        }
      })
      .catch((e) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [organizationId, retry])
  if (!organizationId) return null
  return (
    <section className="uploaded-plans" aria-label="Uploaded activity plans">
      <h2>Uploaded activity plans</h2>
      {loading && <p role="status">Loading uploaded plans…</p>}
      {error && (
        <div>
          <p className="form-error" role="alert">
            {error}
          </p>
          <button
            onClick={() => {
              setLoading(true)
              setError('')
              setRetry((n) => n + 1)
            }}
          >
            Try again
          </button>
        </div>
      )}
      {!loading && !plans.length && !error && <p>No uploaded plans yet.</p>}
      {plans.map((p) => (
        <article key={p.id} className="workspace-card roadmap-summary">
          <div>
            <p className="workspace-card-label">{p.status}</p>
            <h3>{p.name}</h3>
            <p>{p.filename}</p>
          </div>
          <Link
            className="workspace-text-link"
            to={`/app/coordinator/activity-plans/${p.id}?organizationId=${organizationId}`}
          >
            {p.status === 'converted' ? 'Open draft' : 'Continue review'} →
          </Link>
        </article>
      ))}
    </section>
  )
}
