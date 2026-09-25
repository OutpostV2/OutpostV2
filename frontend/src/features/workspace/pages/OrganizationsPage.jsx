import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import { listOrganizations } from '../learningApi'
import { EmptyState, PageHeading } from '../components/WorkspaceUI'
export default function OrganizationsPage() {
  const { user } = useWorkspace()
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void listOrganizations()
      .then((items) => {
        if (active) setOrganizations(items)
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
  const destination =
    user.account_type === 'coordinator'
      ? '/app/coordinator/learning'
      : '/app/student/learning'
  return (
    <>
      <PageHeading
        eyebrow="Workspace / Organizations"
        title="Your organizations"
        description="Organizations appear here when you create one or join a coordinator's cohort."
        action={
          <Link className="workspace-button" to={destination}>
            {user.account_type === 'coordinator'
              ? 'Create organization'
              : 'Join a cohort'}{' '}
            →
          </Link>
        }
      />
      {loading && <p role="status">Loading organizations…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!loading && organizations.length === 0 && (
        <EmptyState
          title="No organization yet"
          description={
            user.account_type === 'coordinator'
              ? 'Create your first organization, then publish a roadmap.'
              : 'Join a cohort with the code from your coordinator.'
          }
          actionLabel={
            user.account_type === 'coordinator'
              ? 'Create organization'
              : 'Join cohort'
          }
          actionTo={destination}
        />
      )}
      <div className="learning-assignments">
        {organizations.map((organization) => (
          <article
            className="workspace-card workspace-entity-card"
            key={organization.id}
          >
            <div className="workspace-entity-icon">O</div>
            <div className="workspace-entity-body">
              <p className="workspace-card-label">
                {organization.role === 'owner' ? 'Coordinator' : 'Student'}{' '}
                membership
              </p>
              <h2>{organization.name}</h2>
              <Link className="workspace-text-link" to={destination}>
                Open learning workspace →
              </Link>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
