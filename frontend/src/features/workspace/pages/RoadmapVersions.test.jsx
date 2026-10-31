import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../learningApi'
import * as plans from '../activityPlanApi'
import RoadmapVersionsPage from './RoadmapVersionsPage'

vi.mock('../activityPlanApi', () => ({
  listPlans: vi.fn().mockResolvedValue({ plans: [] }),
}))
vi.mock('../learningApi', () => ({
  listOrganizations: vi.fn(),
  listRoadmapVersions: vi.fn(),
  saveRoadmapDraft: vi.fn(),
  publishRoadmapVersion: vi.fn(),
  archiveRoadmapVersion: vi.fn(),
  copyRoadmapVersion: vi.fn(),
}))
const original = {
  id: 'roadmap-1',
  organization_id: 'org-1',
  name: 'Career path',
  description: '',
  version_id: 'version-1',
  version_number: 1,
  status: 'draft',
  topics: [
    { id: 'topic-1', title: 'Set goals', description: '', order_index: 1 },
  ],
  phases: [
    {
      id: 'phase-1',
      title: 'Learning path',
      order_index: 1,
      weeks: [
        {
          id: 'week-1',
          title: 'Week 1',
          order_index: 1,
          topics: [
            {
              id: 'topic-1',
              title: 'Set goals',
              description: '',
              order_index: 1,
            },
          ],
        },
      ],
    },
  ],
}
afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  plans.listPlans.mockResolvedValue({ plans: [] })
  vi.mocked(api.listOrganizations).mockResolvedValue([
    { id: 'org-1', name: 'Campus' },
  ])
  vi.mocked(api.listRoadmapVersions).mockResolvedValue([original])
})
it('takes the published version directly to its organization cohort setup', async () => {
  api.listRoadmapVersions.mockResolvedValue([
    { ...original, status: 'published' },
  ])
  const router = createMemoryRouter(
    [{ path: '/roadmaps/:roadmapId', element: <RoadmapVersionsPage /> }],
    { initialEntries: ['/roadmaps/roadmap-1?organizationId=org-1'] },
  )
  render(<RouterProvider router={router} />)
  const link = await screen.findByRole('link', { name: 'Assign to cohort' })
  expect(link).toHaveAttribute(
    'href',
    '/app/coordinator/learning?organizationId=org-1&roadmapVersionId=version-1#cohort-setup',
  )
})
it('saves a draft before explicit review and publication, then copies a published snapshot', async () => {
  const edited = {
    ...original,
    topics: [{ ...original.topics[0], title: 'Build skills' }],
    phases: [
      {
        ...original.phases[0],
        weeks: [
          {
            ...original.phases[0].weeks[0],
            topics: [
              {
                ...original.phases[0].weeks[0].topics[0],
                title: 'Build skills',
              },
            ],
          },
        ],
      },
    ],
  }
  vi.mocked(api.saveRoadmapDraft).mockResolvedValue(edited)
  vi.mocked(api.publishRoadmapVersion).mockResolvedValue({
    ...edited,
    status: 'published',
  })
  vi.mocked(api.copyRoadmapVersion).mockResolvedValue({
    ...edited,
    version_id: 'version-2',
    version_number: 2,
    status: 'draft',
  })
  render(
    <RouterProvider
      router={createMemoryRouter(
        [
          {
            path: '/app/coordinator/roadmaps/:roadmapId/versions',
            element: <RoadmapVersionsPage />,
          },
        ],
        {
          initialEntries: [
            '/app/coordinator/roadmaps/roadmap-1/versions?organizationId=org-1',
          ],
        },
      )}
    />,
  )
  fireEvent.change(await screen.findByLabelText('Topic 1'), {
    target: { value: 'Build skills' },
  })
  expect(
    screen.getByRole('button', { name: 'Review for publication' }),
  ).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  await waitFor(() =>
    expect(api.saveRoadmapDraft).toHaveBeenCalledWith(
      'org-1',
      'roadmap-1',
      'version-1',
      [
        {
          title: 'Learning path',
          weeks: [
            {
              title: 'Week 1',
              topics: [{ title: 'Build skills', description: '' }],
            },
          ],
        },
      ],
    ),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Review for publication' }),
  )
  expect(
    screen.getByRole('region', { name: 'Publication review' }),
  ).toHaveTextContent('1 phases · 1 weeks · 1 topics')
  fireEvent.click(screen.getByRole('button', { name: 'Publish version 1' }))
  await waitFor(() =>
    expect(api.publishRoadmapVersion).toHaveBeenCalledWith(
      'org-1',
      'roadmap-1',
      'version-1',
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Copy as new draft' }))
  await waitFor(() =>
    expect(api.copyRoadmapVersion).toHaveBeenCalledWith(
      'org-1',
      'roadmap-1',
      'version-1',
    ),
  )
  expect(
    await screen.findByRole('button', { name: /Version 2/ }),
  ).toBeInTheDocument()
})
it('shows the complete saved hierarchy in publication review and multiline descriptions', async () => {
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: '/r/:roadmapId', element: <RoadmapVersionsPage /> }],
        { initialEntries: ['/r/roadmap-1?organizationId=org-1'] },
      )}
    />,
  )
  expect((await screen.findByLabelText('Description')).tagName).toBe('TEXTAREA')
  fireEvent.click(
    screen.getByRole('button', { name: 'Review for publication' }),
  )
  expect(
    screen.getByRole('region', { name: 'Publication review' }),
  ).toHaveTextContent('Set goals')
})
it('explains invalid outline fields before save or publication', async () => {
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: '/r/:roadmapId', element: <RoadmapVersionsPage /> }],
        { initialEntries: ['/r/roadmap-1?organizationId=org-1'] },
      )}
    />,
  )
  fireEvent.change(await screen.findByLabelText('Topic 1'), {
    target: { value: '' },
  })
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()
  expect(
    screen.getByRole('button', { name: 'Review for publication' }),
  ).toBeDisabled()
  expect(
    screen.getByRole('region', { name: 'Outline needs attention' }),
  ).toHaveTextContent('Topic 1')
})
it('includes imported source warnings in the saved publication review', async () => {
  plans.listPlans.mockResolvedValue({
    plans: [
      {
        id: 'plan-1',
        roadmap_id: 'roadmap-1',
        warnings: [
          {
            id: 'warning-1',
            message: 'Check table reading order',
            page_number: 2,
            review_item_id: 'source-1',
          },
        ],
      },
    ],
  })
  render(
    <RouterProvider
      router={createMemoryRouter(
        [{ path: '/r/:roadmapId', element: <RoadmapVersionsPage /> }],
        { initialEntries: ['/r/roadmap-1?organizationId=org-1'] },
      )}
    />,
  )
  await screen.findByRole('link', { name: 'View source and review decisions' })
  fireEvent.click(
    screen.getByRole('button', { name: 'Review for publication' }),
  )
  const review = screen.getByRole('region', { name: 'Publication review' })
  expect(review).toHaveTextContent('Check table reading order')
  expect(review).toHaveTextContent('Page 2')
})
