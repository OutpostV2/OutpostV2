/** The same hierarchy bounds enforced by roadmap publication and PDF conversion. */
export function outlineProblems(phases, activityLabel = 'Topic') {
  const problems = []
  const titleProblem = (title, label) => {
    if (title.trim().length < 2 || title.length > 200)
      problems.push(`${label}: enter a title with 2–200 characters.`)
  }
  if (!phases.length || phases.length > 12)
    problems.push('Use between 1 and 12 phases.')
  let topics = 0
  phases.forEach((phase, pi) => {
    const phaseLabel = `Phase ${pi + 1}`
    titleProblem(phase.title, phaseLabel)
    if (!phase.weeks.length || phase.weeks.length > 52)
      problems.push(`${phaseLabel}: include between 1 and 52 weeks.`)
    phase.weeks.forEach((week, wi) => {
      const weekLabel = `${phaseLabel} / Week ${wi + 1}`
      titleProblem(week.title, weekLabel)
      if (!week.topics.length || week.topics.length > 24)
        problems.push(`${weekLabel}: include between 1 and 24 activities.`)
      topics += week.topics.length
      week.topics.forEach((topic, ti) => {
        const topicLabel = `${weekLabel} / ${activityLabel} ${ti + 1}`
        titleProblem(topic.title, topicLabel)
        if ((topic.description || '').length > 1000)
          problems.push(
            `${topicLabel}: shorten the description to 1,000 characters.`,
          )
      })
    })
  })
  if (topics > 500)
    problems.push('Use no more than 500 activities in one roadmap.')
  return problems
}
