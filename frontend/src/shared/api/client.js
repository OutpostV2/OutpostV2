/** One API transport for every feature. The access token stays in memory. */
export class ApiRequestError extends Error {
  status
  constructor(message, status) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}
const baseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(
  /\/$/,
  '',
)
let accessToken = null
export function hasAccessToken() {
  return accessToken !== null
}
export function setAccessToken(token) {
  accessToken = token
}
export function clearAccessToken() {
  accessToken = null
}
export async function apiRequest(path, options = {}) {
  let response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    })
  } catch {
    throw new Error(
      'Unable to reach Outpost. Check that the API is running and try again.',
    )
  }
  if (!response.ok) {
    let message = 'Something went wrong. Please try again.'
    try {
      const payload = await response.json()
      message = payload.error?.message || message
    } catch {
      // Some API errors intentionally have no JSON body.
    }
    throw new ApiRequestError(message, response.status)
  }
  if (response.status === 204 || response.status === 202) return undefined
  return await response.json()
}
