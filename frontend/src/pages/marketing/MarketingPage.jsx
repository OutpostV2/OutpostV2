import { useState } from 'react'
const pathwaySteps = [
  {
    number: '01',
    title: 'Build skills',
    description: 'Follow structured learning shaped around real-world demands.',
  },
  {
    number: '02',
    title: 'Gain experience',
    description:
      'Put learning into practice through projects and industry exposure.',
  },
  {
    number: '03',
    title: 'Be career ready',
    description:
      'Move forward with the confidence to take the next opportunity.',
  },
]
const learningCycle = [
  {
    number: '01',
    title: 'Plan with a roadmap',
    description:
      'Organize learning into clear phases, weeks, and topics that make sense for each cohort.',
  },
  {
    number: '02',
    title: 'Guide each cohort',
    description:
      'Give students a consistent path while coordinators keep the learning journey in view.',
  },
  {
    number: '03',
    title: 'Understand progress',
    description:
      'See how learners are moving forward and use those insights to improve what comes next.',
  },
]
function MarketingPage() {
  const [menuOpen, setMenuOpen] = useState(false)
  function closeMenu() {
    setMenuOpen(false)
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header" id="home">
        <div className="page-container header-inner">
          <a
            className="wordmark"
            href="#home"
            onClick={closeMenu}
            aria-label="Outpost home"
          >
            Outpost<span aria-hidden="true">.</span>
          </a>
          <button
            className="menu-toggle"
            type="button"
            aria-label="Toggle navigation"
            aria-expanded={menuOpen}
            aria-controls="site-navigation"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
          </button>
          <nav
            className={`site-nav${menuOpen ? ' is-open' : ''}`}
            id="site-navigation"
            aria-label="Main navigation"
          >
            <a href="#for-colleges" onClick={closeMenu}>
              For colleges
            </a>
            <a href="#pathway" onClick={closeMenu}>
              The pathway
            </a>
            <a href="#approach" onClick={closeMenu}>
              How it works
            </a>
            <a href="/review" onClick={closeMenu}>
              Review demo
            </a>
            <a href="/login" onClick={closeMenu}>
              Sign in
            </a>
            <a className="nav-cta" href="/register" onClick={closeMenu}>
              Get started <span aria-hidden="true">↗</span>
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content">
        <section className="hero-section" aria-labelledby="hero-title">
          <div className="page-container hero-layout">
            <div className="hero-copy">
              <p className="eyebrow">Learning today, brighter tomorrows</p>
              <h1 id="hero-title">
                A guided path from learning to career readiness for every{' '}
                <span>student.</span>
              </h1>
              <p className="hero-description">
                Outpost helps college Training &amp; Placement teams bring
                learning, practice, and progress into one clear journey for
                every student.
              </p>
              <div className="hero-actions">
                <a className="button button-primary" href="/register">
                  Get started <span aria-hidden="true">→</span>
                </a>
                <a className="text-link" href="/review">
                  View demo <span aria-hidden="true">↗</span>
                </a>
              </div>
              <p className="hero-caption">
                A clearer view of what students learn, practice, and work
                toward.
              </p>
            </div>

            <aside
              className="manifesto-panel example-roadmap"
              aria-label="Example roadmap"
            >
              <p className="eyebrow">Illustrative roadmap</p>
              <h2>Career readiness</h2>
              <p className="manifesto-description">
                A clear outline for the next three weeks.
              </p>
              <ol>
                <li>
                  <small>Week 01</small>
                  <strong>Find your direction</strong>
                  <span>Set goals and explore roles</span>
                </li>
                <li>
                  <small>Week 02</small>
                  <strong>Build your portfolio</strong>
                  <span>Turn practice into a project</span>
                </li>
                <li>
                  <small>Week 03</small>
                  <strong>Prepare to connect</strong>
                  <span>Practice interviews and share your work</span>
                </li>
              </ol>
              <p className="manifesto-footer">
                Example content · your team creates the learning path.
              </p>
            </aside>
          </div>
        </section>

        <section
          className="pathway-section"
          id="pathway"
          aria-labelledby="pathway-title"
        >
          <div className="page-container">
            <div className="section-heading section-heading-centered">
              <p className="eyebrow eyebrow-light">The Outpost pathway</p>
              <h2 id="pathway-title">
                Build skills. Gain experience. Be career ready.
              </h2>
              <p>
                A connected learning journey gives students a clearer way
                forward and helps colleges support progress at every stage.
              </p>
            </div>
            <ol className="pathway-steps">
              {pathwaySteps.map((step) => (
                <li className="pathway-step" key={step.number}>
                  <article className="pathway-card">
                    <span className="step-number">{step.number}</span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="cycle-section"
          id="approach"
          aria-labelledby="cycle-title"
        >
          <div className="page-container cycle-layout">
            <div className="section-heading cycle-intro">
              <p className="eyebrow">A more connected approach</p>
              <h2 id="cycle-title">Built around the whole learning cycle.</h2>
              <p>
                Outpost is designed to help Training &amp; Placement teams plan
                a learning journey, guide cohorts through it, and understand
                what students need next.
              </p>
            </div>
            <ol className="cycle-list">
              {learningCycle.map((step) => (
                <li className="cycle-item" key={step.number}>
                  <article className="cycle-card">
                    <span className="cycle-number">{step.number}</span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </article>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          className="audience-section"
          id="for-colleges"
          aria-labelledby="audience-title"
        >
          <div className="page-container audience-layout">
            <div className="audience-heading">
              <p className="eyebrow">For the people behind student progress</p>
              <h2 id="audience-title">
                One shared purpose. A clearer journey for everyone.
              </h2>
            </div>
            <div className="audience-copy">
              <article className="audience-card">
                <h3>For Training &amp; Placement teams</h3>
                <p>
                  Bring curriculum planning and cohort support together around a
                  shared view of student readiness.
                </p>
              </article>
              <article className="audience-card">
                <h3>For students</h3>
                <p>
                  Understand what to learn, how it connects to real
                  opportunities, and where to focus next.
                </p>
              </article>
            </div>
          </div>
        </section>

        <section className="closing-section" aria-labelledby="closing-title">
          <div className="page-container closing-inner">
            <div>
              <p className="eyebrow eyebrow-light">
                Learning today, brighter tomorrows
              </p>
              <h2 id="closing-title">Make the next step easier to see.</h2>
            </div>
            <a className="button button-light" href="/register">
              Create your account <span aria-hidden="true">→</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="site-footer" id="about">
        <div className="page-container footer-inner">
          <a className="wordmark footer-wordmark" href="#home">
            Outpost<span aria-hidden="true">.</span>
          </a>
          <p>A clearer path from learning to career readiness.</p>
          <a className="footer-top-link" href="#home">
            Back to top <span aria-hidden="true">↑</span>
          </a>
        </div>
      </footer>
    </>
  )
}
export default MarketingPage
