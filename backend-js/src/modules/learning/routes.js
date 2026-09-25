import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppError, forbidden, notFound } from '../../core/errors.js';

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
    const enrollment = cohorts.length
      ? await prisma.cohortEnrollment.findFirst({
          where: { cohortId: { in: cohorts.map((cohort) => cohort.id) }, userId: request.user.id, status: 'active' },
        })
      : null;
    if (!enrollment) throw notFound('Assigned topic not found');
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
    const users = enrollments.length
      ? await prisma.user.findMany({ where: { id: { in: enrollments.map((row) => row.userId) } } })
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
