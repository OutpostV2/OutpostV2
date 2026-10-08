const names = {
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  completed: 'Completed',
  unscheduled: 'No deadline',
  scheduled: 'Scheduled',
  no_topics: 'No topics',
}
function formatDeadline(deadline) {
  return (
    new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: deadline.time_zone,
    }).format(new Date(deadline.due_at)) +
    ' · ' +
    deadline.time_zone
  )
}
export default function DeadlineDetails({ week }) {
  return (
    <>
      <div className="deadline-heading">
        <div>
          <p className="workspace-eyebrow">{week.phase_title}</p>
          <h3>{week.title}</h3>
        </div>
        <span className={'deadline-status status-' + week.status}>
          {names[week.status]}
        </span>
      </div>
      <p>
        {week.deadline
          ? formatDeadline(week.deadline)
          : 'No due date has been assigned.'}
      </p>
      {week.completed !== null && (
        <p>
          {week.completed} / {week.topic_count} topics completed
        </p>
      )}
    </>
  )
}
