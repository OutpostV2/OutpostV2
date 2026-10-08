import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../learningApi'
import StudentActivityPage from './StudentActivityPage'
import StudentDeadlinesPage from './StudentDeadlinesPage'
import CohortSchedule from '../components/CohortSchedule'
vi.mock('../learningApi', () => ({
  getMyActivity: vi.fn(),
  getMyDeadlines: vi.fn(),
  getCohortActivity: vi.fn(),
  getCohortDeadlines: vi.fn(),
  setWeekDeadline: vi.fn(),
  removeWeekDeadline: vi.fn(),
}))
const scheduled = {
  cohort_id: 'c1',
  cohort_name: 'College lab',
  roadmap_version_number: 2,
  weeks: [
    {
      week_id: 'w1',
      title: 'Daily lab',
      phase_title: 'Basics',
      topic_count: 2,
      completed: 0,
      status: 'overdue',
      deadline: {
        due_at: '2026-03-08T06:30:00Z',
        time_zone: 'America/New_York',
        updated_at: '2026-03-01T00:00:00Z',
      },
    },
  ],
}
afterEach(cleanup)
it('retains another week draft when one deadline is saved', async () => {
  api.getCohortDeadlines.mockResolvedValue({
    ...scheduled,
    weeks: [
      scheduled.weeks[0],
      { ...scheduled.weeks[0], week_id: 'w2', title: 'Internal practice' },
    ],
  })
  api.setWeekDeadline.mockResolvedValue({})
  render(
    <MemoryRouter>
      <CohortSchedule cohortId="c1" />
    </MemoryRouter>,
  )
  await screen.findByText('Internal practice')
  fireEvent.change(screen.getByLabelText('Due instant for Internal practice'), {
    target: { value: '2026-12-05T12:00:00Z' },
  })
  fireEvent.click(screen.getAllByRole('button', { name: 'Save deadline' })[0])
  await screen.findByText('Deadline saved.')
  expect(
    await screen.findByLabelText('Due instant for Internal practice'),
  ).toHaveValue('2026-12-05T12:00:00Z')
})
beforeEach(() => {
  vi.resetAllMocks()
  api.getMyActivity.mockResolvedValue({ events: [], next_cursor: null })
  api.getMyDeadlines.mockResolvedValue([scheduled])
  api.getCohortDeadlines.mockResolvedValue(scheduled)
  api.getCohortActivity.mockResolvedValue({ events: [], next_cursor: null })
})
it('shows persisted events, pagination and no fabricated earlier activity', async () => {
  api.getMyActivity
    .mockResolvedValueOnce({
      events: [
        {
          id: 'e1',
          topic_title: 'Functions',
          event_type: 'topic_reopened',
          created_at: '2026-10-08T00:00:00Z',
        },
      ],
      next_cursor: 'e1',
    })
    .mockResolvedValueOnce({
      events: [
        {
          id: 'e2',
          topic_title: 'Arrays',
          event_type: 'topic_completed',
          created_at: '2026-10-07T00:00:00Z',
        },
      ],
      next_cursor: null,
    })
  render(
    <MemoryRouter>
      <StudentActivityPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Functions')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Older activity' }))
  expect(await screen.findByText('Arrays')).toBeInTheDocument()
  expect(api.getMyActivity).toHaveBeenLastCalledWith('e1')
})
it('displays a named timezone and server-computed overdue state', async () => {
  render(
    <MemoryRouter>
      <StudentDeadlinesPage />
    </MemoryRouter>,
  )
  expect(await screen.findByText('Daily lab')).toBeInTheDocument()
  expect(screen.getByText(/America\/New_York/)).toBeInTheDocument()
  expect(screen.getByText('Overdue')).toBeInTheDocument()
  expect(screen.queryByText(/review roadmap/i)).not.toBeInTheDocument()
})
it('handles empty and retryable activity reads', async () => {
  api.getMyActivity.mockRejectedValueOnce(new Error('Connection unavailable'))
  render(
    <MemoryRouter>
      <StudentActivityPage />
    </MemoryRouter>,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Connection unavailable',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(
    await screen.findByText('No recorded activity yet'),
  ).toBeInTheDocument()
})
it('saves and removes a staff deadline and refetches the schedule', async () => {
  api.setWeekDeadline.mockResolvedValue({})
  api.removeWeekDeadline.mockResolvedValue(null)
  render(
    <MemoryRouter>
      <CohortSchedule cohortId="c1" />
    </MemoryRouter>,
  )
  await screen.findByText('Daily lab')
  fireEvent.change(screen.getByLabelText('Due instant for Daily lab'), {
    target: { value: '2026-12-01T12:00:00+05:30' },
  })
  fireEvent.change(screen.getByLabelText('Display timezone for Daily lab'), {
    target: { value: 'Asia/Kolkata' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save deadline' }))
  await screen.findByText('Deadline saved.')
  expect(api.setWeekDeadline).toHaveBeenCalledWith('c1', 'w1', {
    due_at: '2026-12-01T12:00:00+05:30',
    time_zone: 'Asia/Kolkata',
  })
  fireEvent.click(
    await screen.findByRole('button', { name: 'Remove deadline' }),
  )
  await screen.findByText('Deadline removed.')
  expect(api.removeWeekDeadline).toHaveBeenCalledWith('c1', 'w1')
  expect(api.getCohortDeadlines.mock.calls.length).toBeGreaterThan(1)
})
