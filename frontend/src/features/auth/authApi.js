import {
  apiRequest,
  clearAccessToken,
  hasAccessToken,
  setAccessToken,
} from '../../shared/api/client'
export function dashboardPath(accountType) {
  return accountType === 'coordinator' ? '/app/coordinator' : '/app/student'
}
let pendingRestore = null
export function currentUser() {
  return apiRequest('/me')
}
export async function registerWithPassword(input) {
  await apiRequest('/auth/password/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
async function acceptToken(result) {
  setAccessToken(result.access_token)
  try {
    return await currentUser()
  } catch (error) {
    clearAccessToken()
    throw error
  }
}
export async function signInWithPassword(identifier, password) {
  const result = await apiRequest('/auth/password/login', {
    method: 'POST',
    body: JSON.stringify({ identifier, password }),
  })
  return acceptToken(result)
}
export async function requestPhoneCode(phone) {
  await apiRequest('/auth/phone/request', {
    method: 'POST',
    body: JSON.stringify({ phone }),
  })
}
export async function verifyPhoneCode(phone, code) {
  const result = await apiRequest('/auth/phone/verify', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  })
  return acceptToken(result)
}
export async function restoreSession() {
  if (pendingRestore) return pendingRestore
  pendingRestore = (async () => {
    try {
      if (hasAccessToken()) {
        try {
          return await currentUser()
        } catch {
          clearAccessToken()
        }
      }
      const result = await apiRequest('/auth/refresh', {
        method: 'POST',
      })
      return await acceptToken(result)
    } catch {
      clearAccessToken()
      return null
    }
  })()
  try {
    return await pendingRestore
  } finally {
    pendingRestore = null
  }
}
export async function signOut() {
  try {
    if (hasAccessToken()) await apiRequest('/auth/logout', { method: 'POST' })
  } finally {
    clearAccessToken()
  }
}
export async function signOutAll() {
  try {
    await apiRequest('/auth/logout-all', { method: 'POST' })
  } finally {
    clearAccessToken()
  }
}
export function getSessions() {
  return apiRequest('/auth/sessions')
}
export function revokeSession(id) {
  return apiRequest(`/auth/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
export function requestPasswordReset(email) {
  return apiRequest('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}
export function resetPassword(token, password) {
  return apiRequest('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}
export function requestEmailVerification(email) {
  return apiRequest('/auth/email-verification/request', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}
export function confirmEmailVerification(token) {
  return apiRequest('/auth/email-verification/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}
