import { forbidden, notFound } from './errors.js';

export const STAFF_ROLES = Object.freeze(['owner', 'admin', 'coordinator', 'mentor']);
export const LEARNING_RESOURCE_ROLES = Object.freeze(['owner', 'admin', 'coordinator']);

const rolesByAccountType = Object.freeze({
  student: new Set(['student']),
  coordinator: new Set(STAFF_ROLES),
});

export function hasAccountRoleCompatibility(accountType, role) {
  return rolesByAccountType[accountType]?.has(role) ?? false;
}

export function requireAccountType(user, acceptedTypes) {
  if (!acceptedTypes.includes(user?.account_type)) {
    throw forbidden(acceptedTypes.length === 1
      ? `${acceptedTypes[0][0].toUpperCase()}${acceptedTypes[0].slice(1)} account required`
      : 'Account type is not permitted');
  }
}

export async function requireOrganizationMember(prisma, user, organizationId) {
  const [organization, membership] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.organizationMembership.findFirst({ where: {
      organizationId, userId: user.id, status: 'active',
    } }),
  ]);
  if (!organization || organization.status !== 'active' || !membership ||
      !hasAccountRoleCompatibility(user.account_type, membership.role)) {
    throw forbidden('Organization access denied');
  }
  return { organization, membership };
}

export async function requireOrganizationRole(prisma, user, organizationId, acceptedRoles) {
  const scope = await requireOrganizationMember(prisma, user, organizationId);
  if (!acceptedRoles.includes(scope.membership.role)) throw forbidden('Organization role is not permitted');
  return scope;
}

export async function requirePublishedRoadmapVersion(prisma, organizationId, versionId) {
  const version = await prisma.roadmapVersion.findUnique({ where: { id: versionId } });
  const roadmap = version
    ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } })
    : null;
  if (!version || version.status !== 'published' || !roadmap || roadmap.organizationId !== organizationId) {
    throw notFound('Published roadmap version not found');
  }
  return { version, roadmap };
}

export async function requireCohortScope(prisma, cohortId) {
  const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } });
  if (!cohort || cohort.status !== 'active') throw notFound('Cohort not found');
  const [organization, version] = await Promise.all([
    prisma.organization.findUnique({ where: { id: cohort.organizationId } }),
    prisma.roadmapVersion.findUnique({ where: { id: cohort.roadmapVersionId } }),
  ]);
  const roadmap = version
    ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } })
    : null;
  if (!organization || organization.status !== 'active' || !version || version.status !== 'published' ||
      !roadmap || roadmap.organizationId !== organization.id) {
    throw notFound('Cohort not found');
  }
  return { cohort, organization, version, roadmap };
}

export async function requireCohortAccess(prisma, user, cohortId, {
  staffRoles = [],
  allowStudent = false,
} = {}) {
  const scope = await requireCohortScope(prisma, cohortId);
  const membershipScope = await requireOrganizationMember(prisma, user, scope.organization.id);
  const role = membershipScope.membership.role;
  if (staffRoles.includes(role)) return { ...scope, membership: membershipScope.membership };

  if (allowStudent && user.account_type === 'student' && role === 'student') {
    const enrollment = await prisma.cohortEnrollment.findFirst({ where: {
      cohortId: scope.cohort.id, userId: user.id, status: 'active',
    } });
    if (enrollment) return { ...scope, membership: membershipScope.membership, enrollment };
    throw notFound('Cohort not found');
  }

  throw forbidden('Cohort access is not permitted');
}

export async function requireAssignedTopicAccess(prisma, user, topicId) {
  requireAccountType(user, ['student']);
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  const week = topic ? await prisma.week.findUnique({ where: { id: topic.weekId } }) : null;
  const phase = week ? await prisma.phase.findUnique({ where: { id: week.phaseId } }) : null;
  const version = phase
    ? await prisma.roadmapVersion.findUnique({ where: { id: phase.roadmapVersionId } })
    : null;
  const roadmap = version
    ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } })
    : null;
  const organization = roadmap
    ? await prisma.organization.findUnique({ where: { id: roadmap.organizationId } })
    : null;
  if (!topic || !week || !phase || !version || version.status !== 'published' || !roadmap || !organization ||
      organization.status !== 'active') {
    throw notFound('Assigned topic not found');
  }

  const cohorts = await prisma.cohort.findMany({ where: {
    roadmapVersionId: version.id, organizationId: organization.id, status: 'active',
  } });
  for (const cohort of cohorts) {
    try {
      const access = await requireCohortAccess(prisma, user, cohort.id, { allowStudent: true });
      return { topic, week, phase, ...access };
    } catch (error) {
      if (error.status !== 403 && error.status !== 404) throw error;
    }
  }
  throw notFound('Assigned topic not found');
}
