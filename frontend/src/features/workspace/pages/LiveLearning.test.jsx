import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as learningApi from '../learningApi'
import CoordinatorLearningPage from './CoordinatorLearningPage'
import StudentLearningPage from './StudentLearningPage'
import LiveCohortProgressPage from './LiveCohortProgressPage'
vi.mock('../learningApi', () => ({
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  listRoadmaps: vi.fn(),
  createRoadmap: vi.fn(),
  listCohorts: vi.fn(),
  createCohort: vi.fn(),
  joinCohort: vi.fn(),
  getMyLearning: vi.fn(),
  setTopicProgress: vi.fn(),
  getCohortProgress: vi.fn(),
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(learningApi.listOrganizations).mockResolvedValue([])
  vi.mocked(learningApi.listRoadmaps).mockResolvedValue([])
  vi.mocked(learningApi.listCohorts).mockResolvedValue([])
})
it('lets a coordinator create an organization, roadmap, and cohort', async () => {
  const org = { id: 'org-1', name: 'Campus', role: 'owner' }
  const roadmap = {
    id: 'roadmap-1',
    organization_id: org.id,
    name: 'Career readiness',
    description: '',
    version_id: 'version-1',
    version_number: 1,
    topics: [{ id: 'topic-1', title: 'Set goals', description: '', week: 1 }],
  }
  const cohort = {
    id: 'cohort-1',
    organization_id: org.id,
    name: '2026 cohort',
    roadmap_version_id: roadmap.version_id,
    roadmap_name: roadmap.name,
    invite_code: 'abcdefghijklmnopqrstuvwx12345678',
    student_count: 0,
  }
  vi.mocked(learningApi.createOrganization).mockResolvedValue(org)
  vi.mocked(learningApi.createRoadmap).mockResolvedValue(roadmap)
  vi.mocked(learningApi.createCohort).mockResolvedValue(cohort)
  render(
    <MemoryRouter>
      <CoordinatorLearningPage />
    </MemoryRouter>,
  )
  fireEvent.change(await screen.findByLabelText('Organization name'), {
    target: { value: 'Campus' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create organization' }))
  await waitFor(() =>
    expect(learningApi.createOrganization).toHaveBeenCalledWith('Campus'),
  )
  fireEvent.change(await screen.findByLabelText('Roadmap name'), {
    target: { value: roadmap.name },
  })
  fireEvent.change(
    screen.getByRole('textbox', { name: /Topics, one per line/i }),
    { target: { value: 'Set goals' } },
  )
  fireEvent.click(screen.getByRole('button', { name: 'Publish roadmap' }))
  await waitFor(() =>
    expect(learningApi.createRoadmap).toHaveBeenCalledWith(org.id, {
      name: roadmap.name,
      description: '',
      topics: [{ title: 'Set goals', description: '' }],
    }),
  )
  fireEvent.change(await screen.findByLabelText('Cohort name'), {
    target: { value: cohort.name },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create cohort' }))
  expect(await screen.findByText(cohort.invite_code)).toBeInTheDocument()
  expect(learningApi.createCohort).toHaveBeenCalledWith(
    org.id,
    cohort.name,
    roadmap.version_id,
  )
  expect(
    screen.getByRole('link', { name: /view live progress/i }),
  ).toHaveAttribute('href', '/app/coordinator/learning/cohort-1')
})
it('lets a student join and persist topic completion', async () => {
  const assignment = {
    cohort_id: 'cohort-1',
    cohort_name: '2026 cohort',
    organization_name: 'Campus',
    roadmap_name: 'Career readiness',
    completed: 0,
    total: 1,
    percent: 0,
    topics: [
      {
        id: 'topic-1',
        title: 'Set goals',
        description: '',
        week: 1,
        completed: false,
        completed_at: null,
      },
    ],
  }
  vi.mocked(learningApi.getMyLearning)
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([assignment])
    .mockResolvedValueOnce([
      {
        ...assignment,
        completed: 1,
        percent: 100,
        topics: [
          {
            ...assignment.topics[0],
            completed: true,
            completed_at: '2026-09-25T00:00:00Z',
          },
        ],
      },
    ])
  vi.mocked(learningApi.joinCohort).mockResolvedValue({
    cohort_id: 'cohort-1',
    cohort_name: '2026 cohort',
    organization_name: 'Campus',
  })
  vi.mocked(learningApi.setTopicProgress).mockResolvedValue()
  render(
    <MemoryRouter>
      <StudentLearningPage />
    </MemoryRouter>,
  )
  fireEvent.change(await screen.findByLabelText('Join code'), {
    target: { value: 'abcdefghijklmnopqrstuvwx12345678' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join cohort' }))
  expect(
    await screen.findByRole('heading', { name: 'Career readiness' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Mark complete' }))
  await waitFor(() =>
    expect(learningApi.setTopicProgress).toHaveBeenCalledWith('topic-1', true),
  )
  expect(await screen.findByText('1 of 1 topics completed')).toBeInTheDocument()
})
it('shows zero-progress students in the coordinator report', async () => {
  vi.mocked(learningApi.getCohortProgress).mockResolvedValue({
    cohort_id: 'cohort-1',
    cohort_name: '2026 cohort',
    roadmap_name: 'Career readiness',
    students: [
      { id: 'student-1', name: 'Mira', completed: 0, total: 1, percent: 0 },
    ],
    topics: [
      { id: 'topic-1', title: 'Set goals', completed: 0, total: 1, percent: 0 },
    ],
    average_percent: 0,
  })
  render(
    <MemoryRouter initialEntries={['/app/coordinator/learning/cohort-1']}>
      <Routes>
        <Route
          path="/app/coordinator/learning/:cohortId"
          element={<LiveCohortProgressPage />}
        />
      </Routes>
    </MemoryRouter>,
  )
  expect(await screen.findByText('Mira')).toBeInTheDocument()
  expect(screen.getByText('0 / 1 topics')).toBeInTheDocument()
  expect(learningApi.getCohortProgress).toHaveBeenCalledWith('cohort-1')
})
it('shows a useful error when a student enters an invalid join code', async () => {
  vi.mocked(learningApi.getMyLearning).mockResolvedValue([])
  vi.mocked(learningApi.joinCohort).mockRejectedValue(
    new Error('Join code was not found.'),
  )
  render(
    <MemoryRouter>
      <StudentLearningPage />
    </MemoryRouter>,
  )
  fireEvent.change(await screen.findByLabelText('Join code'), {
    target: { value: 'abcdefghijklmnopqrstuvwx12345678' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Join cohort' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Join code was not found.',
  )
  expect(screen.getByRole('button', { name: 'Join cohort' })).toBeEnabled()
})
