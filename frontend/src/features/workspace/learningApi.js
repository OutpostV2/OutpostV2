import { apiRequest } from '../../shared/api/client'
export function listOrganizations() {
  return apiRequest('/organizations')
}
export function createOrganization(name) {
  return apiRequest('/organizations', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}
export function listRoadmaps(organizationId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/roadmaps`,
  )
}
export function createRoadmap(organizationId, input) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/roadmaps`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
export function listCohorts(organizationId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/cohorts`,
  )
}
export function createCohort(organizationId, name, roadmapVersionId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/cohorts`,
    {
      method: 'POST',
      body: JSON.stringify({ name, roadmap_version_id: roadmapVersionId }),
    },
  )
}
export function joinCohort(inviteCode) {
  return apiRequest('/cohorts/join', {
    method: 'POST',
    body: JSON.stringify({ invite_code: inviteCode }),
  })
}
export function getMyLearning() {
  return apiRequest('/progress/me')
}
export function setTopicProgress(topicId, completed) {
  return apiRequest(`/progress/topics/${encodeURIComponent(topicId)}`, {
    method: 'PUT',
    body: JSON.stringify({ completed }),
  })
}
export function getCohortProgress(cohortId) {
  return apiRequest(`/cohorts/${encodeURIComponent(cohortId)}/progress`)
}
