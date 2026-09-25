import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ReviewPage from './ReviewPage'
import * as authApi from '../auth/authApi'
import * as reviewApi from './reviewApi'
vi.mock('../auth/authApi', () => ({ restoreSession: vi.fn() }))
vi.mock('./reviewApi', () => ({
  getReviewOverview: vi.fn(),
  updateReviewProgress: vi.fn(),
  resetReviewProgress: vi.fn(),
}))
afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())
const topic = {
  key: 'goals',
  title: 'Set your career goals',
  description: 'Define two roles to explore.',
  week: 1,
  status: 'not_started',
  completed_at: null,
}
const overview = {
  scenario: 'illustrative',
  student: {
    roadmap_title: 'Career Readiness Foundations',
    completed: 0,
    total: 1,
    percent: 0,
    next_topic: topic,
    phases: [
      {
        title: 'Find your direction',
        description: 'Start here.',
        topics: [topic],
      },
    ],
  },
  coordinator: {
    cohort_title: 'Example Cohort',
    roadmap_title: 'Career Readiness Foundations',
    members: [
      {
        name: 'Mira Student',
        completed: 0,
        total: 1,
        percent: 0,
        is_you: true,
      },
    ],
    average_percent: 0,
    topics: [{ title: topic.title, completed: 0, total: 1, percent: 0 }],
  },
}
it('saves student progress and shows the updated backend response', async () => {
  vi.mocked(authApi.restoreSession).mockResolvedValue({
    id: 'user-1',
    display_name: 'Mira Student',
    username: 'mira',
    primary_email: 'mira@example.edu',
    email_verified_at: null,
    account_type: 'student',
  })
  vi.mocked(reviewApi.getReviewOverview).mockResolvedValue(overview)
  vi.mocked(reviewApi.updateReviewProgress).mockResolvedValue({
    ...overview,
    student: {
      ...overview.student,
      completed: 1,
      percent: 100,
      next_topic: null,
      phases: [
        {
          ...overview.student.phases[0],
          topics: [{ ...topic, status: 'completed' }],
        },
      ],
    },
  })
  render(<ReviewPage view="student" />)
  expect(await screen.findByText('0 of 1 topics complete')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
  await waitFor(() =>
    expect(reviewApi.updateReviewProgress).toHaveBeenCalledWith('goals', true),
  )
  expect(await screen.findByText('1 of 1 topics complete')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Completed' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})
it('requires sign-in before loading account progress', async () => {
  vi.mocked(authApi.restoreSession).mockResolvedValue(null)
  render(<ReviewPage view="coordinator" />)
  expect(
    await screen.findByRole('heading', { name: /sign in to try/i }),
  ).toBeInTheDocument()
  expect(reviewApi.getReviewOverview).not.toHaveBeenCalled()
})
