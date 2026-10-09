import { fireEvent, render, screen, cleanup, act } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, it, expect, vi } from 'vitest'
import useUnsavedChanges from './useUnsavedChanges'
function Editor() {
  useUnsavedChanges(true)
  return <input aria-label="Draft text" defaultValue="Keep this draft" />
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
it('blocks browser history navigation while the user keeps unsaved edits', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const router = createMemoryRouter(
    [
      { path: '/edit', element: <Editor /> },
      { path: '/list', element: <h1>List</h1> },
    ],
    { initialEntries: ['/list', '/edit'] },
  )
  render(<RouterProvider router={router} />)
  fireEvent.change(screen.getByLabelText('Draft text'), {
    target: { value: 'My local edit' },
  })
  await act(async () => {
    await router.navigate(-1)
  })
  expect(screen.getByLabelText('Draft text')).toHaveValue('My local edit')
  expect(confirm).toHaveBeenCalled()
})
