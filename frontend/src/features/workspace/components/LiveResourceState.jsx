export default function LiveResourceState({ loading, error, retry }) {
  if (loading) return <p role="status">Loading your data…</p>
  if (error)
    return (
      <div className="workspace-alert">
        <p role="alert">{error}</p>
        <button className="workspace-button" type="button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  return null
}
