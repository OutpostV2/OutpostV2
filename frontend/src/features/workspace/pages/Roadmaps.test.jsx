import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../learningApi'
import RoadmapsPage from './RoadmapsPage'

vi.mock('../activityPlanApi', () => ({
  listPlans: vi.fn().mockResolvedValue({ plans: [] }),
}))
vi.mock('../learningApi', () => ({
  listOrganizations: vi.fn(),
  listRoadmaps: vi.fn(),
  createRoadmap: vi.fn(),
}))
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.listOrganizations).mockResolvedValue([
    { id: 'org-1', name: 'Campus' },
  ])
  vi.mocked(api.listRoadmaps).mockResolvedValue([])
})
it('creates a draft and links to its version editor', async () => {
  vi.mocked(api.createRoadmap).mockResolvedValue({
    id: 'roadmap-1',
    organization_id: 'org-1',
    name: 'Career readiness',
    description: '',
    version_id: 'version-1',
    version_number: 1,
    status: 'draft',
    topics: [{ id: 'topic-1', title: 'Set goals' }],
    phases: [],
  })
  render(
    <MemoryRouter>
      <RoadmapsPage />
    </MemoryRouter>,
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Create manually' }),
  )
  fireEvent.change(await screen.findByLabelText('Roadmap name'), {
    target: { value: 'Career readiness' },
  })
  fireEvent.change(screen.getByLabelText('Starter topics, one per line'), {
    target: { value: 'Set goals' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create draft' }))
  await waitFor(() =>
    expect(api.createRoadmap).toHaveBeenCalledWith('org-1', {
      name: 'Career readiness',
      description: '',
      topics: [{ title: 'Set goals', description: '' }],
    }),
  )
  expect(
    await screen.findByRole('link', { name: 'Manage versions →' }),
  ).toHaveAttribute(
    'href',
    '/app/coordinator/roadmaps/roadmap-1/versions?organizationId=org-1',
  )
})
it('keeps creation behind an explicit action and exposes activity plan import', async () => {
  render(
    <MemoryRouter>
      <RoadmapsPage />
    </MemoryRouter>,
  )
  await screen.findByText('No roadmaps yet')
  expect(screen.queryByLabelText('Roadmap name')).not.toBeInTheDocument()
  expect(
    screen.getByRole('link', { name: 'Import activity plan' }),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Create manually' }))
  expect(screen.getByLabelText('Roadmap name')).toBeInTheDocument()
})
