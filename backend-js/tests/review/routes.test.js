import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler } from '../../src/core/errors.js';
import { registerReviewRoutes } from '../../src/modules/review/routes.js';

function fixture() {
  const rows = [];
  const prisma = {
    reviewTopicProgress: {
      findMany: async ({ where }) => rows.filter((row) => row.userId === where.userId),
      createMany: async ({ data }) => { for (const item of data) if (!rows.some((row) => row.userId === item.userId && row.topicKey === item.topicKey)) rows.push({ ...item, completedAt: new Date('2026-09-25T00:00:00Z') }); },
      deleteMany: async ({ where }) => {
        const remaining = rows.filter((row) => row.userId !== where.userId || (where.topicKey && row.topicKey !== where.topicKey));
        rows.splice(0, rows.length, ...remaining);
      },
    },
  };
  const app = express();
  app.use(express.json());
  const requireUser = (req, _res, next) => {
    const role = req.get('X-Test-Role');
    if (!role) return next(Object.assign(new Error('Authentication required'), { status: 401, code: 'unauthorized' }));
    req.user = { id: req.get('X-Test-User') || 'mira', display_name: 'Mira', account_type: role };
    next();
  };
  registerReviewRoutes(app, { prisma, settings: {}, requireUser });
  app.use(errorHandler);
  return app;
}

describe('review scenario contract', () => {
  it('persists only the current student’s topic completion and can reset it', async () => {
    const app = fixture();
    const mira = { 'X-Test-Role': 'student', 'X-Test-User': 'mira' };
    const dev = { 'X-Test-Role': 'student', 'X-Test-User': 'dev' };
    const initial = await request(app).get('/api/v1/review/overview').set(mira);
    expect(initial.status).toBe(200);
    expect(initial.headers['cache-control']).toBe('no-store');
    expect(initial.body).toMatchObject({ scenario: 'illustrative', student: { completed: 0, total: 6 }, coordinator: null });
    const updated = await request(app).put('/api/v1/review/progress/goals').set(mira).send({ completed: true });
    expect(updated.status).toBe(200);
    expect(updated.body.student.completed).toBe(1);
    expect(updated.body.student.next_topic.key).toBe('communication');
    expect((await request(app).get('/api/v1/review/overview').set(dev)).body.student.completed).toBe(0);
    expect((await request(app).delete('/api/v1/review/progress').set(mira)).status).toBe(204);
    expect((await request(app).get('/api/v1/review/overview').set(mira)).body.student.completed).toBe(0);
  });

  it('limits mutations to students and rejects unknown topics', async () => {
    const app = fixture();
    const student = { 'X-Test-Role': 'student' };
    const coordinator = { 'X-Test-Role': 'coordinator' };
    const overview = await request(app).get('/api/v1/review/overview').set(coordinator);
    expect(overview.status).toBe(200);
    expect(overview.body.coordinator.members).toHaveLength(4);
    expect((await request(app).put('/api/v1/review/progress/goals').set(coordinator).send({ completed: true })).status).toBe(403);
    expect((await request(app).delete('/api/v1/review/progress').set(coordinator)).status).toBe(403);
    expect((await request(app).put('/api/v1/review/progress/unknown').set(student).send({ completed: true })).status).toBe(404);
    expect((await request(app).put('/api/v1/review/progress/goals').set(student).send({ completed: 'yes' })).status).toBe(422);
  });
});
