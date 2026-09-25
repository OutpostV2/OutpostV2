import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/core/errors.js';
import { registerLearningRoutes } from '../../src/modules/learning/routes.js';

function fixture() {
  const calls = [];
  const prisma = {
    $transaction: async (fn) => fn(prisma),
    organization: {
      create: async ({ data }) => {
        calls.push(['organization.create', data]);
        return { id: '11111111-1111-4111-8111-111111111111', status: 'active', ...data };
      },
      findUnique: async () => null,
    },
    organizationMembership: {
      create: async ({ data }) => { calls.push(['membership.create', data]); },
      findFirst: async () => null,
    },
    cohort: { findFirst: async () => null },
  };
  const app = express();
  app.use(express.json());
  const requireUser = (req, _res, next) => {
    req.user = { id: req.get('X-Test-User') || '22222222-2222-4222-8222-222222222222', account_type: req.get('X-Test-Role') || 'student', display_name: 'Learner' };
    next();
  };
  registerLearningRoutes(app, { prisma, settings: {}, requireUser });
  app.use(errorHandler);
  return { app, calls };
}

describe('live learning route guardrails', () => {
  it('allows a coordinator to create an organization and makes membership atomic', async () => {
    const { app, calls } = fixture();
    const denied = await request(app).post('/api/v1/organizations').send({ name: 'Campus' });
    expect(denied.status).toBe(403);
    const created = await request(app).post('/api/v1/organizations').set('X-Test-Role', 'coordinator').send({ name: '  Campus  ' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: '11111111-1111-4111-8111-111111111111', name: 'Campus', role: 'owner' });
    expect(calls.map(([name]) => name)).toEqual(['organization.create', 'membership.create']);
    expect(calls[1][1]).toMatchObject({ organizationId: created.body.id, role: 'owner' });
  });

  it('requires active ownership and validates input before creating a roadmap', async () => {
    const { app } = fixture();
    const org = '11111111-1111-4111-8111-111111111111';
    expect((await request(app).post('/api/v1/organizations/' + org + '/roadmaps').set('X-Test-Role', 'coordinator').send({ name: 'Plan', topics: [{ title: 'Topic' }] })).status).toBe(403);
    expect((await request(app).post('/api/v1/organizations').set('X-Test-Role', 'coordinator').send({ name: 'X' })).status).toBe(422);
    expect((await request(app).post('/api/v1/cohorts/join').send({ invite_code: 'x'.repeat(24) })).status).toBe(404);
  });
});

function workflowFixture() {
  let sequence = 1;
  const makeId = () => '00000000-0000-4000-8000-' + String(sequence++).padStart(12, '0');
  const tables = Object.fromEntries(
    ['organization', 'organizationMembership', 'roadmap', 'roadmapVersion', 'phase', 'week', 'topic', 'cohort', 'cohortEnrollment', 'topicProgress', 'user']
      .map((name) => [name, []]),
  );
  tables.user.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', displayName: 'Learner' });
  const matches = (row, where = {}) => Object.entries(where).every(([key, value]) =>
    value && typeof value === 'object' && 'in' in value
      ? value.in.includes(row[key])
      : row[key] === value);
  const model = (name) => ({
    create: async ({ data }) => {
      const row = { id: makeId(), createdAt: new Date('2026-09-25T00:00:00Z'), status: 'active', ...data };
      tables[name].push(row);
      return row;
    },
    createMany: async ({ data }) => {
      for (const entry of data) {
        const keys = name === 'cohortEnrollment' ? ['cohortId', 'userId'] : ['organizationId', 'userId'];
        if (!tables[name].some((row) => keys.every((key) => row[key] === entry[key])))
          tables[name].push({ id: makeId(), status: 'active', ...entry });
      }
    },
    findMany: async ({ where = {} } = {}) => tables[name].filter((row) => matches(row, where)),
    findFirst: async ({ where }) => tables[name].find((row) => matches(row, where)) ?? null,
    findUnique: async ({ where }) => tables[name].find((row) => matches(row, where)) ?? null,
    count: async ({ where }) => tables[name].filter((row) => matches(row, where)).length,
    upsert: async ({ where, create, update }) => {
      const key = where.userId_topicId;
      const existing = tables[name].find((row) => matches(row, key));
      if (existing) Object.assign(existing, update);
      else tables[name].push({ id: makeId(), updatedAt: new Date('2026-09-25T00:00:00Z'), ...create });
    },
    deleteMany: async ({ where }) => {
      tables[name] = tables[name].filter((row) => !matches(row, where));
    },
  });
  const prisma = Object.fromEntries(Object.keys(tables).map((name) => [name, model(name)]));
  prisma.$transaction = async (fn) => fn(prisma);
  const app = express();
  app.use(express.json());
  const requireUser = (req, _res, next) => {
    req.user = {
      id: req.get('X-Test-User') || 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      account_type: req.get('X-Test-Role') || 'coordinator',
      display_name: req.get('X-Test-Name') || 'Coordinator',
    };
    next();
  };
  registerLearningRoutes(app, { prisma, settings: {}, requireUser });
  app.use(errorHandler);
  return { app, tables };
}

describe('live learning workflow', () => {
  it('creates an owned roadmap and cohort, joins a student, and reports completion', async () => {
    const { app } = workflowFixture();
    const coordinator = { 'X-Test-Role': 'coordinator', 'X-Test-User': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const student = { 'X-Test-Role': 'student', 'X-Test-User': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    const org = await request(app).post('/api/v1/organizations').set(coordinator).send({ name: 'Campus' });
    expect(org.status).toBe(201);
    expect((await request(app).get('/api/v1/organizations').set(coordinator)).body).toMatchObject([{ id: org.body.id, role: 'owner' }]);
    const roadmap = await request(app)
      .post('/api/v1/organizations/' + org.body.id + '/roadmaps')
      .set(coordinator)
      .send({ name: 'Career readiness', topics: [{ title: 'Set goals' }, { title: 'Build portfolio' }] });
    expect(roadmap.status).toBe(201);
    expect(roadmap.body.topics.map((topic) => topic.week)).toEqual([1, 2]);
    expect((await request(app).get('/api/v1/organizations/' + org.body.id + '/roadmaps').set(coordinator)).body).toHaveLength(1);
    const cohort = await request(app)
      .post('/api/v1/organizations/' + org.body.id + '/cohorts')
      .set(coordinator)
      .send({ name: '2026 cohort', roadmap_version_id: roadmap.body.version_id });
    expect(cohort.status).toBe(201);
    expect(cohort.body.invite_code.length).toBeGreaterThanOrEqual(20);
    expect((await request(app).get('/api/v1/organizations/' + org.body.id + '/cohorts').set(coordinator)).body).toHaveLength(1);
    expect((await request(app).post('/api/v1/cohorts/join').set(coordinator).send({ invite_code: cohort.body.invite_code })).status).toBe(403);
    const joined = await request(app).post('/api/v1/cohorts/join').set(student).send({ invite_code: cohort.body.invite_code });
    expect(joined.status).toBe(200);
    expect(joined.body.cohort_id).toBe(cohort.body.id);
    expect((await request(app).post('/api/v1/cohorts/join').set(student).send({ invite_code: cohort.body.invite_code })).status).toBe(200);
    const before = await request(app).get('/api/v1/progress/me').set(student);
    expect(before.body[0]).toMatchObject({ completed: 0, total: 2 });
    const topicId = roadmap.body.topics[0].id;
    expect((await request(app).put('/api/v1/progress/topics/' + topicId).set(student).send({ completed: true })).status).toBe(204);
    const after = await request(app).get('/api/v1/progress/me').set(student);
    expect(after.body[0]).toMatchObject({ completed: 1, total: 2, percent: 50 });
    const report = await request(app).get('/api/v1/cohorts/' + cohort.body.id + '/progress').set(coordinator);
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({ average_percent: 50, students: [{ completed: 1, total: 2 }] });
    expect((await request(app).get('/api/v1/cohorts/' + cohort.body.id + '/progress').set(student)).status).toBe(403);
    expect((await request(app).put('/api/v1/progress/topics/' + topicId).set(student).send({ completed: false })).status).toBe(204);
    expect((await request(app).get('/api/v1/progress/me').set(student)).body[0].completed).toBe(0);
  });
});

describe('FastAPI rounding compatibility', () => {
  it('rounds a half percentage to the nearest even integer', async () => {
    const { app } = workflowFixture();
    const coordinator = { 'X-Test-Role': 'coordinator' };
    const student = { 'X-Test-Role': 'student', 'X-Test-User': 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    const org = await request(app).post('/api/v1/organizations').set(coordinator).send({ name: 'Campus' });
    const roadmap = await request(app)
      .post('/api/v1/organizations/' + org.body.id + '/roadmaps')
      .set(coordinator)
      .send({ name: 'Eight topics', topics: Array.from({ length: 8 }, (_, index) => ({ title: 'Topic ' + index })) });
    const cohort = await request(app)
      .post('/api/v1/organizations/' + org.body.id + '/cohorts')
      .set(coordinator)
      .send({ name: '2026 cohort', roadmap_version_id: roadmap.body.version_id });
    await request(app).post('/api/v1/cohorts/join').set(student).send({ invite_code: cohort.body.invite_code });
    await request(app).put('/api/v1/progress/topics/' + roadmap.body.topics[0].id).set(student).send({ completed: true });
    const mine = await request(app).get('/api/v1/progress/me').set(student);
    expect(mine.body[0].percent).toBe(12);
  });
});

describe('organization boundary', () => {
  it('does not let an owner attach another organization’s roadmap version', async () => {
    const { app } = workflowFixture();
    const ownerA = { 'X-Test-Role': 'coordinator', 'X-Test-User': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    const ownerB = { 'X-Test-Role': 'coordinator', 'X-Test-User': 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    const first = await request(app).post('/api/v1/organizations').set(ownerA).send({ name: 'First Campus' });
    const second = await request(app).post('/api/v1/organizations').set(ownerB).send({ name: 'Other Campus' });
    const roadmap = await request(app)
      .post('/api/v1/organizations/' + first.body.id + '/roadmaps')
      .set(ownerA)
      .send({ name: 'First roadmap', topics: [{ title: 'Set goals' }] });
    expect((await request(app)
      .post('/api/v1/organizations/' + second.body.id + '/cohorts')
      .set(ownerB)
      .send({ name: 'Wrong cohort', roadmap_version_id: roadmap.body.version_id })).status).toBe(404);
    expect((await request(app).get('/api/v1/organizations/' + first.body.id + '/roadmaps').set(ownerB)).status).toBe(403);
  });
});
