import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, conflict, forbidden, notFound } from '../../core/errors.js';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const cleanName = z.string().min(2).max(200).transform((value) => value.trim()).refine((value) => value.length >= 2);
const organizationInput = z.strictObject({ name: cleanName });
const topicInput = z.strictObject({
  title: cleanName,
  description: z.string().max(1000).default(''),
});
const roadmapInput = z.strictObject({
  name: cleanName,
  description: z.string().max(2000).default(''),
  topics: z.array(topicInput).min(1).max(24),
});
const cohortInput = z.strictObject({ name: cleanName, roadmap_version_id: uuid });
const joinInput = z.strictObject({ invite_code: z.string().min(20).max(64) });
const progressInput = z.strictObject({ completed: z.boolean() });
const memberInput = z.strictObject({
  role: z.enum(['coordinator', 'admin', 'mentor']).optional(),
  status: z.enum(['active', 'inactive']).optional(),
}).refine((value) => value.role !== undefined || value.status !== undefined);
const transferInput = z.strictObject({ membership_id: uuid });
const invitationInput = z.strictObject({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  role: z.enum(['coordinator', 'admin', 'mentor']),
});
const acceptInvitationInput = z.strictObject({ code: z.string().min(40).max(128) });
const invitationDurationMs = 7 * 24 * 60 * 60 * 1000;
const codeDigest = (code) => createHash('sha256').update(code).digest('hex');
const invitationOut = (row) => ({
  id: row.id, organization_id: row.organizationId, email: row.email, role: row.role,
  status: row.status === 'pending' && row.expiresAt <= new Date() ? 'expired' : row.status,
  expires_at: row.expiresAt, created_at: row.createdAt,
});

function parse(schema, value, location = 'body') {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError(422, 'validation_error', 'Request validation failed',
    result.error.issues.map((issue) => ({
      loc: [location, ...issue.path],
      type: issue.code === 'unrecognized_keys' ? 'extra_forbidden' : issue.code,
    })));
}

function coordinator(user) {
  if (user.account_type !== 'coordinator') throw forbidden('Coordinator account required');
}
function student(user) {
  if (user.account_type !== 'student') throw forbidden('Student account required');
}
async function owner(prisma, user, organizationId) {
  coordinator(user);
  const [organization, membership] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    prisma.organizationMembership.findFirst({
      where: { organizationId, userId: user.id, role: 'owner', status: 'active' },
    }),
  ]);
  if (!organization || organization.status !== 'active' || !membership) throw forbidden('Organization access denied');
  return organization;
}
async function lockOrganization(tx, organizationId) {
  await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
}
function sorted(rows, dateField = 'createdAt') {
  return [...rows].sort((a, b) => {
    const first = new Date(a[dateField]).getTime() - new Date(b[dateField]).getTime();
    return first || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
async function topics(prisma, versionId) {
  const phases = await prisma.phase.findMany({ where: { roadmapVersionId: versionId } });
  if (!phases.length) return [];
  const weeks = await prisma.week.findMany({ where: { phaseId: { in: phases.map((phase) => phase.id) } } });
  if (!weeks.length) return [];
  const topicRows = await prisma.topic.findMany({ where: { weekId: { in: weeks.map((week) => week.id) } } });
  const phaseById = new Map(phases.map((phase) => [phase.id, phase]));
  const weekById = new Map(weeks.map((week) => [week.id, week]));
  return topicRows
    .sort((a, b) => {
      const wa = weekById.get(a.weekId), wb = weekById.get(b.weekId);
      const pa = phaseById.get(wa.phaseId), pb = phaseById.get(wb.phaseId);
      return pa.orderIndex - pb.orderIndex || wa.orderIndex - wb.orderIndex || a.orderIndex - b.orderIndex;
    })
    .map((topic) => {
      const week = weekById.get(topic.weekId);
      return { id: topic.id, title: topic.title, description: topic.description, week: week.orderIndex };
    });
}
async function roadmapOut(prisma, roadmap, version) {
  return {
    id: roadmap.id, organization_id: roadmap.organizationId, name: roadmap.name,
    description: roadmap.description, version_id: version.id, version_number: version.versionNumber,
    topics: await topics(prisma, version.id),
  };
}
async function cohortOut(prisma, cohort) {
  const version = await prisma.roadmapVersion.findUnique({ where: { id: cohort.roadmapVersionId } });
  const roadmap = version ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } }) : null;
  const count = await prisma.cohortEnrollment.count({ where: { cohortId: cohort.id, status: 'active' } });
  return {
    id: cohort.id, organization_id: cohort.organizationId, name: cohort.name,
    roadmap_version_id: cohort.roadmapVersionId, roadmap_name: roadmap?.name ?? 'Roadmap',
    invite_code: cohort.inviteCode, student_count: count,
  };
}
function roundEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  return fraction > 0.5 || (fraction === 0.5 && floor % 2 === 1) ? floor + 1 : floor;
}
function percent(completed, total) {
  return total ? roundEven(100 * completed / total) : 0;
}
function uuidParam(request, name) {
  return parse(uuid, request.params[name], 'path');
}

export function registerLearningRoutes(app, { prisma, settings: _settings, requireUser }) {
  app.post('/api/v1/organizations', requireUser, async (request, response) => {
    const data = parse(organizationInput, request.body);
    coordinator(request.user);
    const slugBase = data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 190) || 'organization';
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: { name: data.name, slug: slugBase + '-' + randomBytes(5).toString('hex') },
      });
      await tx.organizationMembership.create({
        data: { organizationId: organization.id, userId: request.user.id, role: 'owner' },
      });
      return organization;
    });
    response.status(201).json({ id: result.id, name: result.name, role: 'owner' });
  });

  app.get('/api/v1/organizations', requireUser, async (request, response) => {
    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: request.user.id, status: 'active' },
    });
    const organizations = memberships.length
      ? await prisma.organization.findMany({ where: { id: { in: memberships.map((row) => row.organizationId) }, status: 'active' } })
      : [];
    const byId = new Map(organizations.map((organization) => [organization.id, organization]));
    response.json(sorted(organizations).map((organization) => ({
      id: organization.id, name: organization.name,
      role: memberships.find((row) => row.organizationId === organization.id).role,
    })).filter((row) => byId.has(row.id)));
  });

  app.get('/api/v1/organizations/:organizationId', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const organization = await owner(prisma, request.user, organizationId);
    response.set('Cache-Control', 'no-store');
    response.json({ id: organization.id, name: organization.name, slug: organization.slug, role: 'owner' });
  });

  app.get('/api/v1/organizations/:organizationId/members', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    await owner(prisma, request.user, organizationId);
    const memberships = await prisma.organizationMembership.findMany({ where: { organizationId } });
    const users = memberships.length
      ? await prisma.user.findMany({
          where: { id: { in: memberships.map((membership) => membership.userId) } },
          select: { id: true, displayName: true, primaryEmail: true, accountType: true },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));
    response.set('Cache-Control', 'no-store');
    response.json(sorted(memberships, 'joinedAt').map((membership) => ({
      id: membership.id,
      user_id: membership.userId,
      display_name: byId.get(membership.userId)?.displayName ?? 'Unknown member',
      email: byId.get(membership.userId)?.primaryEmail ?? null,
      account_type: byId.get(membership.userId)?.accountType ?? null,
      role: membership.role,
      status: membership.status,
      joined_at: membership.joinedAt,
    })));
  });

  app.patch('/api/v1/organizations/:organizationId/members/:membershipId', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const membershipId = uuidParam(request, 'membershipId');
    const data = parse(memberInput, request.body);
    const changed = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      await owner(tx, request.user, organizationId);
      const target = await tx.organizationMembership.findFirst({ where: { id: membershipId, organizationId } });
      if (!target) throw notFound('Membership not found');
      if (target.role === 'owner') throw forbidden('Transfer ownership before changing the owner');
      if (data.role) {
        const user = await tx.user.findUnique({ where: { id: target.userId } });
        if (!user || user.accountType !== 'coordinator' || user.status !== 'active')
          throw forbidden('Staff role requires an active coordinator account');
      }
      const result = await tx.organizationMembership.update({ where: { id: target.id }, data });
      return { id: result.id, user_id: result.userId, role: result.role, status: result.status };
    });
    response.set('Cache-Control', 'no-store').json(changed);
  });

  app.delete('/api/v1/organizations/:organizationId/members/:membershipId', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const membershipId = uuidParam(request, 'membershipId');
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      await owner(tx, request.user, organizationId);
      const target = await tx.organizationMembership.findFirst({ where: { id: membershipId, organizationId } });
      if (!target) throw notFound('Membership not found');
      if (target.role === 'owner') throw forbidden('Transfer ownership before removing the owner');
      await tx.organizationMembership.update({ where: { id: target.id }, data: { status: 'inactive' } });
    });
    response.status(204).end();
  });

  app.post('/api/v1/organizations/:organizationId/ownership-transfer', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const { membership_id: membershipId } = parse(transferInput, request.body);
    const transferred = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      await owner(tx, request.user, organizationId);
      const target = await tx.organizationMembership.findFirst({ where: { id: membershipId, organizationId } });
      if (!target) throw notFound('Membership not found');
      if (target.userId === request.user.id || target.status !== 'active' || target.role === 'student')
        throw conflict('Ownership requires another active staff member');
      const user = await tx.user.findUnique({ where: { id: target.userId } });
      if (!user || user.accountType !== 'coordinator' || user.status !== 'active')
        throw conflict('Ownership requires an active coordinator account');
      const current = await tx.organizationMembership.findFirst({
        where: { organizationId, userId: request.user.id, role: 'owner', status: 'active' },
      });
      await tx.organizationMembership.update({ where: { id: current.id }, data: { role: 'coordinator' } });
      await tx.organizationMembership.update({ where: { id: target.id }, data: { role: 'owner' } });
      return { organization_id: organizationId, owner_user_id: target.userId };
    });
    response.set('Cache-Control', 'no-store').json(transferred);
  });

  app.get('/api/v1/organizations/:organizationId/invitations', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    await owner(prisma, request.user, organizationId);
    const invitations = await prisma.organizationInvitation.findMany({ where: { organizationId } });
    response.set('Cache-Control', 'no-store').json(sorted(invitations).map(invitationOut));
  });

  app.post('/api/v1/organizations/:organizationId/invitations', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const data = parse(invitationInput, request.body);
    const code = randomBytes(32).toString('base64url');
    const invitation = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      await owner(tx, request.user, organizationId);
      const recipient = await tx.user.findFirst({ where: { primaryEmail: data.email } });
      if (recipient) {
        const membership = await tx.organizationMembership.findFirst({
          where: { organizationId, userId: recipient.id },
        });
        if (membership) throw conflict('This account already has an organization membership');
      }
      const existing = await tx.organizationInvitation.findFirst({ where: { organizationId, email: data.email } });
      const values = {
        role: data.role, status: 'pending', tokenHash: codeDigest(code),
        expiresAt: new Date(Date.now() + invitationDurationMs),
        acceptedAt: null, acceptedBy: null, revokedAt: null,
      };
      return existing
        ? tx.organizationInvitation.update({ where: { id: existing.id }, data: values })
        : tx.organizationInvitation.create({ data: {
            organizationId, email: data.email, createdBy: request.user.id, ...values,
          } });
    });
    response.set('Cache-Control', 'no-store').status(201).json({ ...invitationOut(invitation), code });
  });

  app.delete('/api/v1/organizations/:organizationId/invitations/:invitationId', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const invitationId = uuidParam(request, 'invitationId');
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      await owner(tx, request.user, organizationId);
      const invitation = await tx.organizationInvitation.findFirst({ where: { id: invitationId, organizationId } });
      if (!invitation) throw notFound('Invitation not found');
      if (invitation.status === 'pending') await tx.organizationInvitation.update({
        where: { id: invitation.id }, data: { status: 'revoked', revokedAt: new Date() },
      });
    });
    response.status(204).end();
  });

  app.post('/api/v1/organization-invitations/accept', requireUser, async (request, response) => {
    const { code } = parse(acceptInvitationInput, request.body);
    coordinator(request.user);
    const invitation = await prisma.organizationInvitation.findFirst({ where: { tokenHash: codeDigest(code) } });
    if (!invitation) throw notFound('Invitation not found');
    const result = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, invitation.organizationId);
      const current = await tx.organizationInvitation.findFirst({ where: { id: invitation.id } });
      if (!current || current.tokenHash !== codeDigest(code) || current.status !== 'pending' || current.expiresAt <= new Date())
        throw notFound('Invitation not found');
      const organization = await tx.organization.findUnique({ where: { id: current.organizationId } });
      if (!organization || organization.status !== 'active') throw notFound('Invitation not found');
      const user = await tx.user.findUnique({ where: { id: request.user.id } });
      if (!user || user.status !== 'active' || user.accountType !== 'coordinator' || !user.emailVerifiedAt ||
          user.primaryEmail?.trim().toLowerCase() !== current.email)
        throw forbidden('A verified invitation email is required');
      const membership = await tx.organizationMembership.findFirst({
        where: { organizationId: current.organizationId, userId: user.id },
      });
      if (membership) throw conflict('This account already has an organization membership');
      await tx.organizationMembership.create({
        data: { organizationId: current.organizationId, userId: user.id, role: current.role },
      });
      await tx.organizationInvitation.update({ where: { id: current.id }, data: {
        status: 'accepted', acceptedAt: new Date(), acceptedBy: user.id,
      } });
      return { organization_id: organization.id, organization_name: organization.name, role: current.role };
    });
    response.set('Cache-Control', 'no-store').json(result);
  });

  app.post('/api/v1/organizations/:organizationId/roadmaps', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const data = parse(roadmapInput, request.body);
    await owner(prisma, request.user, organizationId);
    const { roadmap, version } = await prisma.$transaction(async (tx) => {
      const roadmap = await tx.roadmap.create({
        data: { organizationId, name: data.name, description: data.description.trim(), createdBy: request.user.id },
      });
      const version = await tx.roadmapVersion.create({
        data: { roadmapId: roadmap.id, versionNumber: 1, status: 'published', createdBy: request.user.id, publishedAt: new Date() },
      });
      const phase = await tx.phase.create({ data: { roadmapVersionId: version.id, title: 'Learning path', orderIndex: 1 } });
      for (const [index, item] of data.topics.entries()) {
        const week = await tx.week.create({ data: { phaseId: phase.id, title: 'Week ' + (index + 1), orderIndex: index + 1 } });
        await tx.topic.create({ data: { weekId: week.id, title: item.title, description: item.description.trim(), orderIndex: 1 } });
      }
      return { roadmap, version };
    });
    response.status(201).json(await roadmapOut(prisma, roadmap, version));
  });

  app.get('/api/v1/organizations/:organizationId/roadmaps', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    await owner(prisma, request.user, organizationId);
    const roadmaps = sorted(await prisma.roadmap.findMany({ where: { organizationId } }));
    const versions = roadmaps.length
      ? await prisma.roadmapVersion.findMany({ where: { roadmapId: { in: roadmaps.map((roadmap) => roadmap.id) }, status: 'published' } })
      : [];
    const byRoadmap = new Map();
    for (const version of versions) {
      const values = byRoadmap.get(version.roadmapId) ?? [];
      values.push(version);
      byRoadmap.set(version.roadmapId, values);
    }
    const output = [];
    for (const roadmap of roadmaps) {
      for (const version of byRoadmap.get(roadmap.id) ?? []) output.push(await roadmapOut(prisma, roadmap, version));
    }
    response.json(output);
  });

  app.post('/api/v1/organizations/:organizationId/cohorts', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    const data = parse(cohortInput, request.body);
    await owner(prisma, request.user, organizationId);
    const version = await prisma.roadmapVersion.findUnique({ where: { id: data.roadmap_version_id } });
    const roadmap = version ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } }) : null;
    if (!version || !roadmap || roadmap.organizationId !== organizationId || version.status !== 'published')
      throw notFound('Published roadmap version not found');
    const cohort = await prisma.cohort.create({
      data: { organizationId, roadmapVersionId: version.id, name: data.name, createdBy: request.user.id, inviteCode: randomBytes(24).toString('base64url') },
    });
    response.status(201).json(await cohortOut(prisma, cohort));
  });

  app.get('/api/v1/organizations/:organizationId/cohorts', requireUser, async (request, response) => {
    const organizationId = uuidParam(request, 'organizationId');
    await owner(prisma, request.user, organizationId);
    const cohorts = sorted(await prisma.cohort.findMany({ where: { organizationId, status: 'active' } }));
    response.json(await Promise.all(cohorts.map((cohort) => cohortOut(prisma, cohort))));
  });

  app.post('/api/v1/cohorts/join', requireUser, async (request, response) => {
    const data = parse(joinInput, request.body);
    student(request.user);
    const cohort = await prisma.cohort.findFirst({ where: { inviteCode: data.invite_code.trim(), status: 'active' } });
    if (!cohort) throw notFound('Cohort invite not found');
    const organization = await prisma.organization.findUnique({ where: { id: cohort.organizationId } });
    if (!organization || organization.status !== 'active') throw notFound('Cohort invite not found');
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organization.id);
      const existing = await tx.organizationMembership.findFirst({
        where: { organizationId: organization.id, userId: request.user.id },
      });
      if (existing && (existing.status !== 'active' || existing.role !== 'student'))
        throw forbidden('Active student membership required');
      await tx.organizationMembership.createMany({
        data: [{ organizationId: organization.id, userId: request.user.id, role: 'student' }], skipDuplicates: true,
      });
      await tx.cohortEnrollment.createMany({
        data: [{ cohortId: cohort.id, userId: request.user.id }], skipDuplicates: true,
      });
    });
    response.json({ cohort_id: cohort.id, cohort_name: cohort.name, organization_name: organization.name });
  });

  app.get('/api/v1/progress/me', requireUser, async (request, response) => {
    student(request.user);
    response.set('Cache-Control', 'no-store');
    const enrollments = await prisma.cohortEnrollment.findMany({ where: { userId: request.user.id, status: 'active' } });
    const cohorts = enrollments.length
      ? await prisma.cohort.findMany({ where: { id: { in: enrollments.map((row) => row.cohortId) }, status: 'active' } })
      : [];
    const result = [];
    for (const cohort of sorted(cohorts)) {
      const organization = await prisma.organization.findUnique({ where: { id: cohort.organizationId } });
      if (!organization || organization.status !== 'active') continue;
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId: cohort.organizationId, userId: request.user.id, role: 'student', status: 'active' },
      });
      if (!membership) continue;
      const version = await prisma.roadmapVersion.findUnique({ where: { id: cohort.roadmapVersionId } });
      const roadmap = version ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } }) : null;
      if (!roadmap) continue;
      const list = await topics(prisma, version.id);
      const progress = list.length
        ? await prisma.topicProgress.findMany({ where: { userId: request.user.id, topicId: { in: list.map((topic) => topic.id) } } })
        : [];
      const byTopic = new Map(progress.map((row) => [row.topicId, row]));
      const topicOutput = list.map((topic) => ({
        ...topic, completed: byTopic.has(topic.id),
        completed_at: byTopic.get(topic.id)?.updatedAt ?? null,
      }));
      result.push({
        cohort_id: cohort.id, cohort_name: cohort.name, organization_name: organization.name,
        roadmap_name: roadmap.name, completed: progress.length, total: list.length,
        percent: percent(progress.length, list.length), topics: topicOutput,
      });
    }
    response.json(result);
  });

  app.put('/api/v1/progress/topics/:topicId', requireUser, async (request, response) => {
    const topicId = uuidParam(request, 'topicId');
    const data = parse(progressInput, request.body);
    student(request.user);
    const topic = await prisma.topic.findUnique({ where: { id: topicId } });
    const week = topic ? await prisma.week.findUnique({ where: { id: topic.weekId } }) : null;
    const phase = week ? await prisma.phase.findUnique({ where: { id: week.phaseId } }) : null;
    const cohorts = phase ? await prisma.cohort.findMany({ where: { roadmapVersionId: phase.roadmapVersionId, status: 'active' } }) : [];
    const enrollments = cohorts.length ? await prisma.cohortEnrollment.findMany({
      where: { cohortId: { in: cohorts.map((cohort) => cohort.id) }, userId: request.user.id, status: 'active' },
    }) : [];
    let authorized = false;
    for (const enrollment of enrollments) {
      const cohort = cohorts.find((row) => row.id === enrollment.cohortId);
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId: cohort.organizationId, userId: request.user.id, role: 'student', status: 'active' },
      });
      const organization = membership ? await prisma.organization.findUnique({ where: { id: cohort.organizationId } }) : null;
      if (organization?.status === 'active') { authorized = true; break; }
    }
    if (!authorized) throw notFound('Assigned topic not found');
    if (data.completed) {
      await prisma.topicProgress.upsert({
        where: { userId_topicId: { userId: request.user.id, topicId } },
        create: { userId: request.user.id, topicId, status: 'completed' },
        update: { status: 'completed', updatedAt: new Date() },
      });
    } else {
      await prisma.topicProgress.deleteMany({ where: { userId: request.user.id, topicId } });
    }
    response.set('Cache-Control', 'no-store').status(204).end();
  });

  app.get('/api/v1/cohorts/:cohortId/progress', requireUser, async (request, response) => {
    const cohortId = uuidParam(request, 'cohortId');
    const cohort = await prisma.cohort.findUnique({ where: { id: cohortId } });
    if (!cohort || cohort.status !== 'active') throw notFound('Cohort not found');
    await owner(prisma, request.user, cohort.organizationId);
    response.set('Cache-Control', 'no-store');
    const version = await prisma.roadmapVersion.findUnique({ where: { id: cohort.roadmapVersionId } });
    const roadmap = version ? await prisma.roadmap.findUnique({ where: { id: version.roadmapId } }) : null;
    const list = await topics(prisma, cohort.roadmapVersionId);
    const enrollments = await prisma.cohortEnrollment.findMany({ where: { cohortId, status: 'active' } });
    const memberships = enrollments.length ? await prisma.organizationMembership.findMany({
      where: { organizationId: cohort.organizationId, userId: { in: enrollments.map((row) => row.userId) },
        role: 'student', status: 'active' },
    }) : [];
    const users = memberships.length
      ? await prisma.user.findMany({ where: { id: { in: memberships.map((row) => row.userId) } } })
      : [];
    users.sort((a, b) => a.displayName < b.displayName ? -1 : a.displayName > b.displayName ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const progress = users.length && list.length
      ? await prisma.topicProgress.findMany({ where: {
          userId: { in: users.map((user) => user.id) },
          topicId: { in: list.map((topic) => topic.id) },
          status: 'completed',
        } })
      : [];
    const done = new Set(progress.map((row) => row.userId + ':' + row.topicId));
    const students = users.map((user) => {
      const count = list.reduce((sum, topic) => sum + Number(done.has(user.id + ':' + topic.id)), 0);
      return { id: user.id, name: user.displayName, completed: count, total: list.length, percent: percent(count, list.length) };
    });
    const topicStats = list.map((topic) => {
      const count = users.reduce((sum, user) => sum + Number(done.has(user.id + ':' + topic.id)), 0);
      return { id: topic.id, title: topic.title, completed: count, total: users.length, percent: percent(count, users.length) };
    });
    response.json({
      cohort_id: cohort.id, cohort_name: cohort.name, roadmap_name: roadmap?.name ?? 'Roadmap',
      students, topics: topicStats,
      average_percent: students.length ? roundEven(students.reduce((sum, learner) => sum + learner.percent, 0) / students.length) : 0,
    });
  });
}
