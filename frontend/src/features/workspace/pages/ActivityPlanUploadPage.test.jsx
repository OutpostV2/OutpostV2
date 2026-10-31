import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import ActivityPlanUploadPage, { UploadedPlans } from './ActivityPlanUploadPage'
import * as learning from '../learningApi'
import * as api from '../activityPlanApi'

vi.mock('../learningApi', () => ({ listOrganizations: vi.fn() }))
vi.mock('../activityPlanApi', () => ({
  listPlans: vi.fn(),
  uploadPlan: vi.fn(),
}))
const limits = { max_bytes: 10485760, max_pages: 50, max_characters: 200000 }
beforeEach(() => {
  vi.clearAllMocks()
  learning.listOrganizations.mockResolvedValue([
    { id: 'student-org', name: 'Student campus', role: 'student' },
    { id: 'staff-org', name: 'Staff campus', role: 'coordinator' },
  ])
  api.listPlans.mockResolvedValue({ plans: [], limits })
})
afterEach(cleanup)
it('offers only organizations with staff permission and ignores an unauthorized query selection', async () => {
  render(
    <MemoryRouter initialEntries={['/upload?organizationId=student-org']}>
      <ActivityPlanUploadPage />
    </MemoryRouter>,
  )
  await screen.findByRole('option', { name: 'Staff campus' })
  expect(
    screen.queryByRole('option', { name: 'Student campus' }),
  ).not.toBeInTheDocument()
  expect(screen.getByLabelText('Organization')).toHaveValue('staff-org')
  await waitFor(() => expect(api.listPlans).toHaveBeenCalledWith('staff-org'))
  expect(api.listPlans).not.toHaveBeenCalledWith('student-org')
})
it('keeps the selected file and plan name after a failed upload', async () => {
  api.uploadPlan.mockRejectedValue(new Error('Storage temporarily unavailable'))
  render(
    <MemoryRouter>
      <ActivityPlanUploadPage />
    </MemoryRouter>,
  )
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Upload activity plan' }),
    ).toBeEnabled(),
  )
  fireEvent.change(screen.getByLabelText('Plan name'), {
    target: { value: 'Learning plan' },
  })
  const file = new File(['%PDF-1.7'], 'learning.pdf', {
    type: 'application/pdf',
  })
  fireEvent.change(screen.getByLabelText('PDF file'), {
    target: { files: [file] },
  })
  fireEvent.submit(
    screen
      .getByRole('button', { name: 'Upload activity plan' })
      .closest('form'),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Storage temporarily unavailable',
  )
  expect(screen.getByLabelText('Plan name')).toHaveValue('Learning plan')
  expect(screen.getByLabelText('PDF file').files[0]).toBe(file)
})
it('does not show a prior organization’s plans while another organization loads', async () => {
  api.listPlans.mockResolvedValueOnce({
    plans: [
      {
        id: 'p1',
        name: 'Private plan',
        filename: 'private.pdf',
        status: 'ready',
      },
    ],
    limits,
  })
  const view = render(
    <MemoryRouter>
      <UploadedPlans organizationId="first" />
    </MemoryRouter>,
  )
  await screen.findByText('Private plan')
  api.listPlans.mockReturnValue(new Promise(() => {}))
  view.rerender(
    <MemoryRouter>
      <UploadedPlans organizationId="second" />
    </MemoryRouter>,
  )
  expect(screen.queryByText('Private plan')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
})
