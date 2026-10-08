import { z } from 'zod';
import { AppError, notFound } from '../../core/errors.js';
import { requireAccountType, requireCohortAccess, LEARNING_RESOURCE_ROLES } from '../../core/authorization.js';

const id = z.uuid();
const pageInput = z.strictObject({ limit: z.coerce.number().int().min(1).max(50).default(25), cursor: id.optional() });
const deadlineInput = z.strictObject({
  due_at: z.iso.datetime({ offset: true }),
  time_zone: z.string().max(100).refine((zone) => {
    if (zone !== 'UTC' && !zone.includes('/')) return false;
    try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return true; } catch { return false; }
  }, 'Use a valid IANA timezone, for example Asia/Kolkata or UTC'),
});
function parse(schema, value) { const result = schema.safeParse(value); if (!result.success) throw new AppError(422, 'validation_error', 'Invalid activity or deadline input', result.error.flatten()); return result.data; }
const staffAccess = (db, user, cohortId) => requireCohortAccess(db, user, cohortId, { staffRoles: LEARNING_RESOURCE_ROLES });
async function studentScopes(db, user) {
  requireAccountType(user, ['student']);
  const enrolled = await db.cohortEnrollment.findMany({ where: { userId: user.id, status: 'active' }, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] });
  const scopes = [];
  for (const row of enrolled) {
    try { scopes.push(await requireCohortAccess(db, user, row.cohortId, { allowStudent: true })); }
    catch (error) { if (![403, 404].includes(error.status)) throw error; }
  }
  return scopes;
}
async function weeksFor(db, versionId) {
  return db.week.findMany({ where: { phase: { roadmapVersionId: versionId } }, include: { phase: true, topics: { orderBy: [{ orderIndex: 'asc' }, { id: 'asc' }] } }, orderBy: [{ phase: { orderIndex: 'asc' } }, { orderIndex: 'asc' }, { id: 'asc' }] });
}
async function eligibleUsers(db, scope) {
  const enrolled = await db.cohortEnrollment.findMany({ where: { cohortId: scope.cohort.id, status: 'active' }, select: { userId: true } });
  const members = await db.organizationMembership.findMany({ where: { organizationId: scope.organization.id, role: 'student', status: 'active', userId: { in: enrolled.map((row) => row.userId) } }, select: { userId: true } });
  return db.user.findMany({ where: { id: { in: members.map((row) => row.userId) }, status: 'active', accountType: 'student' }, select: { id: true } });
}
async function activityPage(db, where, query) {
  const { limit, cursor } = parse(pageInput, query);
  if (cursor && !await db.activityEvent.findFirst({ where: { ...where, id: cursor }, select: { id: true } })) throw notFound('Activity cursor not found');
  const rows = await db.activityEvent.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { topic: { select: { title: true } }, user: { select: { displayName: true } } } });
  return { events: rows.slice(0, limit).map((row) => ({ id: row.id, organization_id: row.organizationId, user_id: row.userId, user_name: row.user.displayName, topic_id: row.topicId, topic_title: row.topic.title, event_type: row.eventType, old_status: row.oldStatus, new_status: row.newStatus, created_at: row.createdAt })), next_cursor: rows.length > limit ? rows[limit - 1].id : null };
}
export function weekStatus(deadline, completed, total, now) {
  if (!deadline) return 'unscheduled';
  if (!total) return 'no_topics';
  if (completed === total) return 'completed';
  return now > deadline.dueAt ? 'overdue' : 'upcoming';
}
const deadlineOut = (row) => row ? { due_at: row.dueAt, time_zone: row.timeZone, updated_at: row.updatedAt, updated_by: row.updatedBy } : null;
async function deadlineReport(db, scope, userId, now) {
  const weeks = await weeksFor(db, scope.version.id);
  const deadlines = await db.cohortWeekDeadline.findMany({ where: { cohortId: scope.cohort.id } });
  const byWeek = new Map(deadlines.map((row) => [row.weekId, row]));
  const progress = userId ? await db.topicProgress.findMany({ where: { userId, topicId: { in: weeks.flatMap((week) => week.topics.map((topic) => topic.id)) }, status: 'completed' }, select: { topicId: true } }) : [];
  const done = new Set(progress.map((row) => row.topicId));
  return { cohort_id: scope.cohort.id, cohort_name: scope.cohort.name, roadmap_version_id: scope.version.id, roadmap_version_number: scope.version.versionNumber, as_of: now, weeks: weeks.map((week) => {
    const completed = week.topics.filter((topic) => done.has(topic.id)).length;
    return { week_id: week.id, title: week.title, phase_title: week.phase.title, topic_count: week.topics.length, completed: userId ? completed : null, deadline: deadlineOut(byWeek.get(week.id)), status: userId ? weekStatus(byWeek.get(week.id), completed, week.topics.length, now) : byWeek.has(week.id) ? 'scheduled' : 'unscheduled' };
  }) };
}
export function registerActivityRoutes(app, { prisma, requireUser }) {
  app.get('/api/v1/progress/me/activity', requireUser, async (req, res) => {
    const scopes = await studentScopes(prisma, req.user);
    const topicRows = await prisma.topic.findMany({ where: { week: { phase: { roadmapVersionId: { in: scopes.map((scope) => scope.version.id) } } } }, select: { id: true } });
    res.set('Cache-Control', 'no-store').json(await activityPage(prisma, { userId: req.user.id, organizationId: { in: scopes.map((scope) => scope.organization.id) }, topicId: { in: topicRows.map((row) => row.id) } }, req.query));
  });
  app.get('/api/v1/cohorts/:cohortId/activity', requireUser, async (req, res) => {
    const scope = await staffAccess(prisma, req.user, parse(id, req.params.cohortId));
    const users = await eligibleUsers(prisma, scope);
    const topicRows = await prisma.topic.findMany({ where: { week: { phase: { roadmapVersionId: scope.version.id } } }, select: { id: true } });
    res.set('Cache-Control', 'no-store').json(await activityPage(prisma, { organizationId: scope.organization.id, userId: { in: users.map((row) => row.id) }, topicId: { in: topicRows.map((row) => row.id) } }, req.query));
  });
  app.get('/api/v1/progress/me/deadlines', requireUser, async (req, res) => {
    const scopes = await studentScopes(prisma, req.user); const now = new Date();
    const result = [];
    for (const scope of scopes) result.push(await deadlineReport(prisma, scope, req.user.id, now));
    res.set('Cache-Control', 'no-store').json(result);
  });
  app.get('/api/v1/cohorts/:cohortId/deadlines', requireUser, async (req, res) => {
    const scope = await staffAccess(prisma, req.user, parse(id, req.params.cohortId));
    res.set('Cache-Control', 'no-store').json(await deadlineReport(prisma, scope, null, new Date()));
  });
  async function changeDeadline(req, res, remove) {
    const cohortId = parse(id, req.params.cohortId), weekId = parse(id, req.params.weekId);
    const data = remove ? null : parse(deadlineInput, req.body);
    const initial = await staffAccess(prisma, req.user, cohortId);
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${initial.organization.id}::uuid FOR UPDATE`;
      const scope = await staffAccess(tx, req.user, cohortId);
      const week = await tx.week.findFirst({ where: { id: weekId, phase: { roadmapVersionId: scope.version.id } } });
      if (!week) throw notFound('Assigned week not found');
      const where = { cohortId_weekId: { cohortId, weekId } };
      const previous = await tx.cohortWeekDeadline.findUnique({ where });
      if (remove && !previous) return null;
      const dueAt = data ? new Date(data.due_at) : null;
      if (previous && data && previous.dueAt.getTime() === dueAt.getTime() && previous.timeZone === data.time_zone) return previous;
      const row = remove ? (await tx.cohortWeekDeadline.delete({ where }), null) : await tx.cohortWeekDeadline.upsert({ where, create: { cohortId, weekId, dueAt, timeZone: data.time_zone, updatedBy: req.user.id }, update: { dueAt, timeZone: data.time_zone, updatedBy: req.user.id, updatedAt: new Date() } });
      await tx.deadlineChange.create({ data: { cohortId, weekId, actorId: req.user.id, eventType: remove ? 'removed' : 'scheduled', oldDueAt: previous?.dueAt ?? null, oldTimeZone: previous?.timeZone ?? null, dueAt, timeZone: data?.time_zone ?? null } });
      return row;
    });
    if (remove) res.set('Cache-Control', 'no-store').status(204).end();
    else res.set('Cache-Control', 'no-store').json(deadlineOut(result));
  }
  app.put('/api/v1/cohorts/:cohortId/weeks/:weekId/deadline', requireUser, (req, res) => changeDeadline(req, res, false));
  app.delete('/api/v1/cohorts/:cohortId/weeks/:weekId/deadline', requireUser, (req, res) => changeDeadline(req, res, true));
}
