import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  act,
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
  return router
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
it('lets a coordinator add the missing phase and week before regrouping activities', async () => {
  show()
  await screen.findByLabelText('Decision for source 1')
  fireEvent.click(screen.getByRole('button', { name: 'Add phase' }))
  expect(screen.getAllByLabelText('Phase title')).toHaveLength(2)
  fireEvent.click(screen.getAllByRole('button', { name: 'Add week' })[1])
  expect(screen.getAllByLabelText('Week title')).toHaveLength(2)
  fireEvent.change(screen.getByLabelText('Move activity to week'), {
    target: {
      value: screen.getByLabelText('Move activity to week').options[1].value,
    },
  })
  expect(screen.getByLabelText('Activity title')).toHaveValue('Explore')
  api.savePlan.mockImplementation(async (o, id, p) => p)
  fireEvent.click(screen.getByRole('button', { name: 'Save review' }))
  await waitFor(() => expect(api.savePlan).toHaveBeenCalled())
  const saved = api.savePlan.mock.calls[0][2]
  expect(saved.proposal.phases[0].weeks[0].topics).toEqual([])
  expect(saved.proposal.phases[1].weeks[0].topics[0].id).toBe('t')
  expect(saved.proposal.phases[1].weeks[0].topics[0].source_refs).toEqual(['r'])
})
it('requires confirmation again after changing the outline', async () => {
  api.getPlan.mockResolvedValue({
    ...structuredClone(plan),
    review_confirmed: true,
  })
  show()
  fireEvent.change(await screen.findByLabelText('Activity title'), {
    target: { value: 'Revised activity' },
  })
  expect(screen.getByLabelText(/I have checked/)).not.toBeChecked()
})
it('supports arrow-key switching between the mobile review tabs', async () => {
  show()
  const draft = await screen.findByRole('tab', { name: 'Draft' })
  draft.focus()
  fireEvent.keyDown(draft, { key: 'ArrowRight' })
  const source = screen.getByRole('tab', { name: 'Source' })
  expect(source).toHaveAttribute('aria-selected', 'true')
  expect(source).toHaveFocus()
  expect(source).toHaveAttribute('aria-controls', 'plan-source-panel')
})
it('clears the previous review while another organization’s plan is loading', async () => {
  const router = show()
  await screen.findByLabelText('Activity title')
  api.getPlan.mockReturnValue(new Promise(() => {}))
  await act(async () => {
    await router.navigate('/plans/p1?organizationId=other')
  })
  expect(screen.queryByLabelText('Activity title')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading activity plan')
})
it('opens the source decision linked to an activity’s stable reference', async () => {
  show()
  fireEvent.click(
    await screen.findByRole('button', { name: 'View source on page 1' }),
  )
  await waitFor(() =>
    expect(screen.getByLabelText('Decision for source 1')).toHaveFocus(),
  )
  expect(screen.getByRole('tab', { name: 'Source' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})
