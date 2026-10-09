import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ActivityPlanPage from './ActivityPlanPage'
import * as api from '../activityPlanApi'
vi.mock('../activityPlanApi', () => ({
  getPlan: vi.fn(),
  savePlan: vi.fn(),
  convertPlan: vi.fn(),
  retryPlan: vi.fn(),
  downloadPlan: vi.fn(),
}))
const plan = {
  id: 'p1',
  name: 'Plan',
  status: 'ready',
  revision: 2,
  filename: 'plan.pdf',
  pages: [{ page_number: 1, text: 'Activity 1: Explore' }],
  warnings: [],
  proposal: {
    phases: [
      {
        id: 'ph',
        title: 'Module one',
        weeks: [
          {
            id: 'w',
            title: 'Week one',
            topics: [
              {
                id: 't',
                title: 'Explore',
                description: 'Source details',
                source_refs: ['r'],
              },
            ],
          },
        ],
      },
    ],
  },
  review_items: [
    {
      id: 'r',
      page_number: 1,
      text: 'Activity 1: Explore',
      disposition: 'unresolved',
      topic_id: null,
      reason: '',
    },
  ],
  review_confirmed: false,
}
function show() {
  const router = createMemoryRouter(
    [{ path: '/plans/:planId', element: <ActivityPlanPage /> }],
    { initialEntries: ['/plans/p1?organizationId=o1'] },
  )
  render(<RouterProvider router={router} />)
}
beforeEach(() => {
  vi.clearAllMocks()
  api.getPlan.mockResolvedValue(structuredClone(plan))
})
afterEach(cleanup)
it('requires source resolution and confirmation, preserving edits when a revision save conflicts', async () => {
  show()
  await screen.findByLabelText('Decision for source 1')
  expect(
    screen.getByRole('button', { name: 'Create roadmap draft' }),
  ).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Decision for source 1'), {
    target: { value: 'excluded' },
  })
  fireEvent.change(screen.getByLabelText('Exclusion reason for source 1'), {
    target: { value: 'Administrative note' },
  })
  fireEvent.click(screen.getByLabelText(/I have checked/))
  api.savePlan.mockRejectedValue(
    new Error('Review changed. Reload before saving.'),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Review changed')
  expect(screen.getByLabelText('Exclusion reason for source 1')).toHaveValue(
    'Administrative note',
  )
  expect(
    screen.getByRole('button', { name: 'Create roadmap draft' }),
  ).toBeDisabled()
})
it('saves review before allowing conversion', async () => {
  show()
  await screen.findByLabelText('Decision for source 1')
  fireEvent.change(screen.getByLabelText('Decision for source 1'), {
    target: { value: 'included' },
  })
  fireEvent.change(screen.getByLabelText('Activity for source 1'), {
    target: { value: 't' },
  })
  fireEvent.click(screen.getByLabelText(/I have checked/))
  api.savePlan.mockImplementation(async (o, id, p) => ({ ...p, revision: 3 }))
  fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create roadmap draft' }),
    ).toBeEnabled(),
  )
  expect(screen.getByText('Saved')).toBeInTheDocument()
})
it('clears prior activity links when excluding source text', async () => {
  api.getPlan.mockResolvedValue({
    ...structuredClone(plan),
    review_items: [
      { ...plan.review_items[0], disposition: 'included', topic_id: 't' },
    ],
  })
  show()
  await screen.findByLabelText('Decision for source 1')
  fireEvent.change(screen.getByLabelText('Decision for source 1'), {
    target: { value: 'excluded' },
  })
  fireEvent.change(screen.getByLabelText('Exclusion reason for source 1'), {
    target: { value: 'Not part of curriculum' },
  })
  api.savePlan.mockImplementation(async (o, id, p) => p)
  fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
  await waitFor(() => expect(api.savePlan).toHaveBeenCalled())
  expect(api.savePlan.mock.calls[0][2].review_items[0].topic_id).toBeNull()
  expect(
    api.savePlan.mock.calls[0][2].proposal.phases[0].weeks[0].topics[0]
      .source_refs,
  ).toEqual([])
})
