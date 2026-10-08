import { useEffect, useState } from 'react'
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router'
import { restoreSession, signOut, dashboardPath } from '../../auth/authApi'
import {
  getReviewOverview,
  resetReviewProgress,
  updateReviewProgress,
} from '../../review/reviewApi'
import { WorkspaceContext } from '../hooks/useWorkspace'
const studentLinks = [
  { to: '/app/student', label: 'Overview', end: true },
  { to: '/app/student/learning', label: 'My assigned learning' },
  { to: '/app/student/roadmap', label: 'Assigned roadmap' },
  { to: '/app/student/activity', label: 'Activity' },
  { to: '/app/student/deadlines', label: 'Deadlines' },
]
const coordinatorLinks = [
  { to: '/app/coordinator', label: 'Overview', end: true },
  { to: '/app/coordinator/learning', label: 'Live learning' },
  { to: '/app/coordinator/cohorts', label: 'Sample cohorts' },
  { to: '/app/coordinator/roadmaps', label: 'Sample roadmaps' },
  { to: '/app/coordinator/imports', label: 'Imports' },
  { to: '/app/coordinator/students', label: 'Sample progress' },
  { to: '/app/coordinator/topic-statistics', label: 'Topic statistics' },
  { to: '/app/coordinator/at-risk', label: 'At-risk' },
]
function optimisticOverview(current, key, completed) {
  const phases = current.student.phases.map((phase) => ({
    ...phase,
    topics: phase.topics.map((topic) =>
      topic.key === key
        ? {
            ...topic,
            status: completed ? 'completed' : 'not_started',
            completed_at: completed ? new Date().toISOString() : null,
          }
        : topic,
    ),
  }))
  const topics = phases.flatMap((phase) => phase.topics)
  const count = topics.filter((topic) => topic.status === 'completed').length
  return {
    ...current,
    student: {
      ...current.student,
      phases,
      completed: count,
      percent: topics.length ? Math.round((100 * count) / topics.length) : 0,
      next_topic: topics.find((topic) => topic.status !== 'completed') ?? null,
    },
  }
}
export default function WorkspaceShell() {
  const [user, setUser] = useState(null)
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyTopic, setBusyTopic] = useState(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const coordinatorView = user?.account_type === 'coordinator'
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const restored = await restoreSession()
        if (!active) return
        if (restored) {
          const data =
            restored.account_type === 'coordinator'
              ? await getReviewOverview()
              : null
          if (active) {
            setUser(restored)
            setOverview(data)
          }
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load your workspace.',
          )
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [])
  async function reload() {
    setError('')
    try {
      setOverview(await getReviewOverview())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Unable to refresh the workspace.',
      )
    }
  }
  async function changeTopic(key, completed) {
    if (!overview || busyTopic) return
    const previous = overview
    setError('')
    setBusyTopic(key)
    setOverview(optimisticOverview(previous, key, completed))
    try {
      setOverview(await updateReviewProgress(key, completed))
    } catch (cause) {
      setOverview(previous)
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your change could not be saved.',
      )
    } finally {
      setBusyTopic(null)
    }
  }
  async function resetProgress() {
    if (busyTopic) return
    setBusyTopic('reset')
    setError('')
    try {
      await resetReviewProgress()
      setOverview(await getReviewOverview())
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Your progress could not be reset.',
      )
    } finally {
      setBusyTopic(null)
    }
  }
  async function leaveWorkspace() {
    try {
      await signOut()
    } finally {
      navigate('/login', { replace: true })
    }
  }
  if (loading)
    return (
      <main className="workspace-gate">
        <div className="workspace-gate-card">
          <span className="workspace-logo">
            Outpost<span>.</span>
          </span>
          <p>Loading your workspace…</p>
        </div>
      </main>
    )
  if (!user)
    return (
      <main className="workspace-gate">
        <div className="workspace-gate-card">
          <span className="workspace-logo">
            Outpost<span>.</span>
          </span>
          <h1>Sign in to continue</h1>
          <p>Your workspace is available after you sign in.</p>
          <Link className="button button-primary" to="/login">
            Sign in
          </Link>
        </div>
      </main>
    )
  const home = dashboardPath(user.account_type)
  if (
    location.pathname === '/app' ||
    (location.pathname.startsWith('/app/student') && coordinatorView) ||
    (location.pathname.startsWith('/app/coordinator') && !coordinatorView)
  ) {
    return <Navigate to={home} replace />
  }
  if (coordinatorView && overview && !overview.coordinator) {
    return (
      <main className="workspace-gate">
        <div className="workspace-gate-card">
          <h1>Workspace unavailable</h1>
          <p role="alert">Coordinator data is unavailable.</p>
        </div>
      </main>
    )
  }
  if (coordinatorView && !overview)
    return (
      <main className="workspace-gate">
        <div className="workspace-gate-card">
          <span className="workspace-logo">
            Outpost<span>.</span>
          </span>
          <h1>Workspace unavailable</h1>
          <p role="alert">
            {error || 'We could not load the review scenario.'}
          </p>
          <button
            className="button button-primary"
            onClick={() => void reload()}
          >
            Try again
          </button>
        </div>
      </main>
    )
  return (
    <WorkspaceContext.Provider
      value={{
        user,
        overview,
        error,
        busyTopic,
        changeTopic,
        resetProgress,
        signOut: leaveWorkspace,
        reload,
      }}
    >
      <div className="workspace-layout">
        <aside
          className={'workspace-sidebar' + (menuOpen ? ' is-open' : '')}
          aria-label="Workspace navigation"
          onClick={(event) => {
            if (event.target.closest('a')) setMenuOpen(false)
          }}
        >
          <Link className="workspace-brand" to={home}>
            Outpost<span>.</span>
            <small>Workspace</small>
          </Link>
          <div className="workspace-org">
            <span className="workspace-org-mark">O</span>
            <span>
              <strong>Outpost workspace</strong>
              <small>Live learning and review</small>
            </span>
            <Link to="/app/organizations" aria-label="Organization context">
              ⌄
            </Link>
          </div>
          <div className="workspace-view-switch" aria-label="Account type">
            <span className="is-selected">
              {coordinatorView ? 'Coordinator' : 'Student'}
            </span>
          </div>
          <nav className="workspace-nav" aria-label="Primary">
            <p className="workspace-nav-heading">
              {coordinatorView ? 'Coordinator' : 'Student'}
            </p>
            {(coordinatorView ? coordinatorLinks : studentLinks).map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  'workspace-nav-link' + (isActive ? ' is-active' : '')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>{' '}
          <div className="workspace-sidebar-bottom">
            <Link to="/review/status">Build status</Link>
            <Link to="/">Public website</Link>
          </div>
        </aside>
        {menuOpen && (
          <button
            className="workspace-scrim"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
        )}
        <div className="workspace-main-area">
          <header className="workspace-topbar">
            <div className="workspace-topbar-left">
              <button
                className="workspace-menu-button"
                type="button"
                aria-label="Open menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                ☰
              </button>
              <span className="workspace-breadcrumb">
                Workspace <span>/</span>{' '}
                {coordinatorView
                  ? 'Coordinator workspace'
                  : 'Student workspace'}
              </span>
            </div>
            <div className="workspace-topbar-actions">
              <Link to="/app/account" className="workspace-account-link">
                <span className="workspace-avatar">
                  {user.display_name.slice(0, 1).toUpperCase()}
                </span>
                <span>{user.display_name}</span>
              </Link>
            </div>
          </header>
          <main className="workspace-content" id="main-content">
            {error && (
              <div className="workspace-alert" role="alert">
                {error}
                <button
                  type="button"
                  onClick={() => setError('')}
                  aria-label="Dismiss error"
                >
                  ×
                </button>
              </div>
            )}
            <Outlet />
          </main>
        </div>
      </div>
    </WorkspaceContext.Provider>
  )
}
