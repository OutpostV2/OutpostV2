import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as api from '../learningApi'
import RoadmapVersionsPage from './RoadmapVersionsPage'

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
  vi.mocked(api.listOrganizations).mockResolvedValue([
    { id: 'org-1', name: 'Campus' },
  ])
  vi.mocked(api.listRoadmapVersions).mockResolvedValue([original])
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
    <MemoryRouter
      initialEntries={[
        '/app/coordinator/roadmaps/roadmap-1/versions?organizationId=org-1',
      ]}
    >
      <Routes>
        <Route
          path="/app/coordinator/roadmaps/:roadmapId/versions"
          element={<RoadmapVersionsPage />}
        />
      </Routes>
    </MemoryRouter>,
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
