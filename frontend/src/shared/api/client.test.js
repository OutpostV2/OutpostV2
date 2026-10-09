import { afterEach, expect, it, vi } from 'vitest'
import { apiRequest, setAccessToken } from './client'
afterEach(() => {
  vi.unstubAllGlobals()
  setAccessToken(null)
})
it('uploads multipart with browser boundary and session authorization', async () => {
  const fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: async () => ({ id: 'plan' }),
  })
  vi.stubGlobal('fetch', fetch)
  setAccessToken('session')
  const body = new FormData()
  body.append('file', new Blob(['%PDF']), 'plan.pdf')
  await apiRequest('/plans', { method: 'POST', body })
  const options = fetch.mock.calls[0][1]
  expect(options.headers['Content-Type']).toBeUndefined()
  expect(options.headers.Authorization).toBe('Bearer session')
  expect(options.body).toBe(body)
})
it('downloads an authenticated source as a blob', async () => {
  const blob = new Blob(['%PDF'])
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => blob,
      json: async () => null,
    }),
  )
  expect(await apiRequest('/source', { responseType: 'blob' })).toBe(blob)
})
