import { Link } from 'react-router'
export function PageHeading({ eyebrow, title, description, action }) {
  return (
    <div className="workspace-page-heading">
      <div>
        <p className="workspace-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="workspace-heading-action">{action}</div>}
    </div>
  )
}
export function PreviewNotice({ children }) {
  return (
    <div className="workspace-preview-notice">
      <span className="workspace-preview-dot" />
      <p>
        <strong>Illustrative scenario</strong> —{' '}
        {children ||
          'This coordinator view uses example cohort data. Only your own topic progress is stored.'}
      </p>
    </div>
  )
}
export function MetricCard({ label, value, detail, tone = 'plain' }) {
  return (
    <article
      className={
        'workspace-metric-card' + (tone === 'green' ? ' is-green' : '')
      }
    >
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </article>
  )
}
export function ProgressBar({ value, label }) {
  return (
    <div
      className="workspace-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} />
    </div>
  )
}
export function EmptyState({ title, description, actionLabel, actionTo }) {
  return (
    <div className="workspace-empty">
      <span className="workspace-empty-symbol" aria-hidden="true">
        ◇
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {actionLabel && actionTo && (
        <Link className="workspace-text-link" to={actionTo}>
          {actionLabel} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  )
}
export function SectionHeading({ title, description, to, linkLabel }) {
  return (
    <div className="workspace-section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {to && linkLabel && (
        <Link className="workspace-text-link" to={to}>
          {linkLabel} <span aria-hidden="true">→</span>
        </Link>
      )}
    </div>
  )
}
