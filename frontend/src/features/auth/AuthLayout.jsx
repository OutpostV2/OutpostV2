export default function AuthLayout({ eyebrow, title, intro, children }) {
  return (
    <main className="auth-page">
      <header className="auth-header page-container">
        <a className="wordmark" href="/" aria-label="Outpost home">
          Outpost<span aria-hidden="true">.</span>
        </a>
        <a className="auth-home-link" href="/login">
          Back to sign in ↗
        </a>
      </header>
      <div className="auth-layout page-container">
        <aside className="auth-story">
          <p className="eyebrow eyebrow-light">Your journey, your account</p>
          <h1>Keep your next step within reach.</h1>
          <p>
            One account connects your learning journey and progress across
            Outpost.
          </p>
          <div className="auth-story-footer">
            <span className="auth-story-marker">01</span>
            <span>Learn with purpose. Grow with confidence.</span>
          </div>
        </aside>
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">{eyebrow}</p>
          <h2 id="auth-title">{title}</h2>
          <p className="auth-intro">{intro}</p>
          {children}
        </section>
      </div>
    </main>
  )
}
