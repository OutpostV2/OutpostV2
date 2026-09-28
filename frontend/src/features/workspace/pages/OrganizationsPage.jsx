import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useWorkspace } from '../hooks/useWorkspace'
import { acceptOrganizationInvitation, listOrganizations } from '../learningApi'
import { EmptyState, PageHeading } from '../components/WorkspaceUI'
export default function OrganizationsPage() {
  const { user } = useWorkspace()
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [inviteBusy, setInviteBusy] = useState(false)
  const [notice, setNotice] = useState('')
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
  function acceptInvitation(event) {
    event.preventDefault()
    setInviteBusy(true)
    setError('')
    void acceptOrganizationInvitation(inviteCode.trim())
      .then(async (accepted) => {
        setOrganizations(await listOrganizations())
        setInviteCode('')
        setNotice(`Joined ${accepted.organization_name} as ${accepted.role}.`)
      })
      .catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : 'Invitation could not be accepted.',
        )
      })
      .finally(() => setInviteBusy(false))
  }
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
      {notice && (
        <p className="workspace-notice" role="status">
          {notice}
        </p>
      )}
      {user.account_type === 'coordinator' && (
        <section className="workspace-card">
          <h2>Join an organization</h2>
          <p>
            Enter the staff invitation code sent by its owner. Your account
            email must be verified and match the invitation.
          </p>
          <form className="learning-inline-form" onSubmit={acceptInvitation}>
            <label className="form-field">
              Staff invitation code
              <input
                required
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value)}
              />
            </label>
            <button className="workspace-button" disabled={inviteBusy}>
              Accept invitation
            </button>
          </form>
        </section>
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
                {organization.role === 'owner'
                  ? 'Owner'
                  : organization.role === 'student'
                    ? 'Student'
                    : 'Staff'}{' '}
                membership
              </p>
              <h2>{organization.name}</h2>
              {organization.role === 'owner' && (
                <Link
                  className="workspace-text-link"
                  to={`/app/organizations/${organization.id}`}
                >
                  Manage organization →
                </Link>
              )}
              {organization.role === 'owner' ||
              organization.role === 'student' ? (
                <Link className="workspace-text-link" to={destination}>
                  Open learning workspace →
                </Link>
              ) : (
                <p>
                  Staff membership active. Workspace permissions are being
                  prepared.
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
