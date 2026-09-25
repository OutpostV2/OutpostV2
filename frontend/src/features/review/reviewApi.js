import { apiRequest } from '../../shared/api/client'
export function getReviewOverview() {
  return apiRequest('/review/overview')
}
export function updateReviewProgress(key, completed) {
  return apiRequest(`/review/progress/${encodeURIComponent(key)}`, {
    method: 'PUT',
    body: JSON.stringify({ completed }),
  })
}
export function resetReviewProgress() {
  return apiRequest('/review/progress', { method: 'DELETE' })
}
