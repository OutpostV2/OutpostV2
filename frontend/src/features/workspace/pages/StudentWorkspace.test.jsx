import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../learningApi'
import { WorkspaceContext } from '../hooks/useWorkspace'
import StudentDashboardPage from './StudentDashboardPage'
import StudentLearningPage from './StudentLearningPage'

vi.mock('../learningApi', () => ({
  getMyLearning: vi.fn(),
  setTopicProgress: vi.fn(),
  joinCohort: vi.fn(),
  withdrawFromCohort: vi.fn(),
}))
const topic = {
  id: 't1',
  title: 'First live topic',
  description: 'Practice',
  order_index: 0,
  week: 0,
  completed: false,
  completed_at: null,
}
const assignment = {
  cohort_id: 'c1',
  cohort_name: 'Lab group',
  organization_name: 'Campus',
  roadmap_name: 'Programming',
  roadmap_version_id: 'v1',
  roadmap_version_number: 3,
  completed: 0,
  total: 1,
  percent: 0,
  topics: [topic],
  phases: [
    {
      id: 'p1',
      title: 'Foundations',
      weeks: [{ id: 'w1', title: 'Getting started', topics: [topic] }],
    },
  ],
}
function show(Page) {
  return render(
    <MemoryRouter>
      <WorkspaceContext.Provider value={{ user: { display_name: 'Mira' } }}>
        <Page />
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}
afterEach(cleanup)
beforeEach(() => vi.resetAllMocks())
it('keeps a slow learning retry in a loading state rather than showing empty learning', async () => {
  let resolveRead
  api.getMyLearning
    .mockRejectedValueOnce(new Error('Disconnected'))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve
        }),
    )
  show(StudentLearningPage)
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(screen.getByRole('status')).toHaveTextContent(/Loading/)
  expect(screen.queryByText('No assigned roadmap yet')).not.toBeInTheDocument()
  resolveRead([assignment])
  await screen.findByText('Getting started')
})
it('makes live cohort progress and the pinned version the student dashboard', async () => {
  api.getMyLearning.mockResolvedValue([assignment])
  show(StudentDashboardPage)
  expect(
    await screen.findByRole('heading', { name: 'Programming' }),
  ).toBeInTheDocument()
  expect(screen.getByText(/Version 3/)).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'First live topic' }),
  ).toBeInTheDocument()
  expect(screen.queryByText(/Review scenario/)).not.toBeInTheDocument()
})
it('shows a retryable error rather than calling failed reads an empty assignment list', async () => {
  api.getMyLearning
    .mockRejectedValueOnce(new Error('Network unavailable'))
    .mockResolvedValueOnce([])
  show(StudentDashboardPage)
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Network unavailable',
  )
  expect(screen.queryByText('No assigned roadmap yet')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('No assigned roadmap yet')).toBeInTheDocument()
})
it('shows the ordered phase/week tree and reloads persisted progress after a write', async () => {
  api.getMyLearning.mockResolvedValueOnce([assignment]).mockResolvedValueOnce([
    {
      ...assignment,
      completed: 1,
      percent: 100,
      topics: [{ ...topic, completed: true }],
      phases: [
        {
          ...assignment.phases[0],
          weeks: [
            {
              ...assignment.phases[0].weeks[0],
              topics: [{ ...topic, completed: true }],
            },
          ],
        },
      ],
    },
  ])
  api.setTopicProgress.mockResolvedValue(undefined)
  show(StudentLearningPage)
  expect(
    await screen.findByRole('heading', { name: 'Getting started' }),
  ).toBeInTheDocument()
  expect(
    screen.getByRole('heading', { name: 'Foundations' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
  expect(
    await screen.findByRole('button', { name: 'Completed ✓' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(api.setTopicProgress).toHaveBeenCalledWith('t1', true)
})
it('keeps cohorts distinct while counting shared assigned topics only once', async () => {
  api.getMyLearning.mockResolvedValue([
    assignment,
    { ...assignment, cohort_id: 'c2', cohort_name: 'Second group' },
  ])
  show(StudentDashboardPage)
  expect(
    await screen.findByText('Of 1 distinct assigned topics'),
  ).toBeInTheDocument()
  expect(screen.getByText(/Campus \/ Second group/)).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { name: 'Programming' })).toHaveLength(
    2,
  )
})
it('shows loading while assigned learning is pending', () => {
  api.getMyLearning.mockReturnValue(new Promise(() => {}))
  show(StudentDashboardPage)
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByText('No assigned roadmap yet')).not.toBeInTheDocument()
})
