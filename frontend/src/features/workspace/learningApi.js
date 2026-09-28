import { apiRequest } from '../../shared/api/client'
export function listOrganizations() {
  return apiRequest('/organizations')
}
export function getOrganization(organizationId) {
  return apiRequest(`/organizations/${encodeURIComponent(organizationId)}`)
}
export function listOrganizationMembers(organizationId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/members`,
  )
}
export function updateOrganizationMember(
  organizationId,
  membershipId,
  changes,
) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(membershipId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(changes),
    },
  )
}
export function transferOrganizationOwnership(organizationId, membershipId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/ownership-transfer`,
    {
      method: 'POST',
      body: JSON.stringify({ membership_id: membershipId }),
    },
  )
}
export function listOrganizationInvitations(organizationId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/invitations`,
  )
}
export function createOrganizationInvitation(organizationId, email, role) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/invitations`,
    {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    },
  )
}
export function revokeOrganizationInvitation(organizationId, invitationId) {
  return apiRequest(
    `/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitationId)}`,
    {
      method: 'DELETE',
    },
  )
}
export function acceptOrganizationInvitation(code) {
  return apiRequest('/organization-invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
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
