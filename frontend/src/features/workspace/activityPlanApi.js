import { apiRequest } from '../../shared/api/client'
const base = (org) => `/organizations/${encodeURIComponent(org)}/activity-plans`
export const listPlans = (org) => apiRequest(base(org))
export const getPlan = (org, id) => apiRequest(`${base(org)}/${id}`)
export const uploadPlan = (org, name, file) => {
  const body = new FormData()
  body.append('name', name)
  body.append('file', file)
  return apiRequest(base(org), { method: 'POST', body })
}
export const savePlan = (org, id, plan) =>
  apiRequest(`${base(org)}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      revision: plan.revision,
      name: plan.name,
      proposal: plan.proposal,
      review_items: plan.review_items,
      review_confirmed: plan.review_confirmed,
    }),
  })
export const retryPlan = (org, id, revision) =>
  apiRequest(`${base(org)}/${id}/retry`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  })
export const convertPlan = (org, id, revision) =>
  apiRequest(`${base(org)}/${id}/convert`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  })
export const downloadPlan = (org, id) =>
  apiRequest(`${base(org)}/${id}/source`, { responseType: 'blob' })
