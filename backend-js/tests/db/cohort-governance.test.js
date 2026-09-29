import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { errorHandler } from '../../src/core/errors.js';
import { createPrismaClient } from '../../src/db/client.js';
import { registerLearningRoutes } from '../../src/modules/learning/routes.js';
import { removeTestOrganizations } from './cleanup.js';

describe.skipIf(!(process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL))('cohort join and enrollment governance in PostgreSQL', () => {
  test('keeps joins, governance, tenant scope, version pinning, and progress history consistent', async () => {
    const prisma = createPrismaClient();
    const suffix = randomUUID().replaceAll('-', '');
    const userIds = [];
    const organizationIds = [];
    const actors = new Map();
    const createUser = async (label, accountType) => {
      const user = await prisma.user.create({ data: {
        displayName: label, username: `p15_${label}_${suffix}`, accountType,
      } });
      userIds.push(user.id);
      actors.set(user.id, { id: user.id, account_type: accountType });
      return user;
    };
    try {
      const owner = await createUser('owner', 'coordinator');
      const otherOwner = await createUser('otherowner', 'coordinator');
      const student = await createUser('student', 'student');
      const organization = await prisma.organization.create({ data: {
        name: `Campus ${suffix}`, slug: `p15-campus-${suffix}`,
      } });
      organizationIds.push(organization.id);
      const otherOrganization = await prisma.organization.create({ data: {
        name: `Other ${suffix}`, slug: `p15-other-${suffix}`,
      } });
      organizationIds.push(otherOrganization.id);
      await prisma.organizationMembership.createMany({ data: [
        { organizationId: organization.id, userId: owner.id, role: 'owner' },
        { organizationId: otherOrganization.id, userId: otherOwner.id, role: 'owner' },
      ] });

      const app = express();
      app.use(express.json());
      const requireUser = (req, _response, next) => {
        req.user = actors.get(req.get('X-Actor'));
        next();
      };
      const redisClient = { eval: async () => 1 };
      registerLearningRoutes(app, { prisma, settings: {}, requireUser, redisClient });
      app.use(errorHandler);
      const as = (user) => ({ 'X-Actor': user.id });
      const roadmapPath = `/api/v1/organizations/${organization.id}/roadmaps`;
      const roadmap = await request(app).post(roadmapPath).set(as(owner)).send({
        name: 'Career readiness', topics: [{ title: 'Prepare portfolio' }],
      });
      expect(roadmap.status).toBe(201);
      const published = await request(app)
        .post(`${roadmapPath}/${roadmap.body.id}/versions/${roadmap.body.version_id}/publish`)
        .set(as(owner));
      expect(published.status).toBe(200);
      const cohort = await request(app).post(`/api/v1/organizations/${organization.id}/cohorts`).set(as(owner)).send({
        name: 'Review cohort', roadmap_version_id: roadmap.body.version_id,
      });
      expect(cohort.status).toBe(201);
      expect(cohort.body.invite_code).toHaveLength(43);
      const initialCode = cohort.body.invite_code;
      let stored = await prisma.cohort.findUnique({ where: { id: cohort.body.id } });
      expect(stored.inviteCodeHash).toBe(createHash('sha256').update(initialCode).digest('hex'));
      expect(stored.inviteCodeHash).not.toBe(initialCode);
      const listed = await request(app).get(`/api/v1/organizations/${organization.id}/cohorts`).set(as(owner));
      expect(listed.body[0]).toMatchObject({ join_code_status: 'active' });
      expect(listed.body[0]).not.toHaveProperty('invite_code');

      const invalid = await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: 'z'.repeat(43) });
      expect(invalid.status).toBe(404);
      expect(invalid.body.error.message).toBe('Cohort invite not found');
      const joined = await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: initialCode });
      expect(joined.status).toBe(200);
      expect((await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: initialCode })).status).toBe(200);
      expect(await prisma.cohortEnrollment.count({ where: { cohortId: cohort.body.id, userId: student.id } })).toBe(1);
      const topicId = roadmap.body.topics[0].id;
      expect((await request(app).put(`/api/v1/progress/topics/${topicId}`).set(as(student)).send({ completed: true })).status).toBe(204);

      expect((await request(app).delete(`/api/v1/cohorts/${cohort.body.id}/enrollments/me`).set(as(student))).status).toBe(204);
      expect((await prisma.cohortEnrollment.findUnique({ where: {
        cohortId_userId: { cohortId: cohort.body.id, userId: student.id },
      } })).endReason).toBe('student_withdrew');
      expect((await request(app).get('/api/v1/progress/me').set(as(student))).body).toEqual([]);
      expect((await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: initialCode })).status).toBe(200);
      expect((await request(app).get('/api/v1/progress/me').set(as(student))).body[0].completed).toBe(1);

      const rosterPath = `/api/v1/cohorts/${cohort.body.id}/enrollments`;
      const roster = await request(app).get(rosterPath).set(as(owner));
      expect(roster.body[0]).toMatchObject({ display_name: 'student', status: 'active' });
      expect(roster.body[0]).not.toHaveProperty('primary_email');
      expect((await request(app).post(`/api/v1/cohorts/${cohort.body.id}/join-code/rotate`).set(as(otherOwner))).status).toBe(403);
      expect((await request(app).get(rosterPath).set(as(otherOwner))).status).toBe(403);

      const enrollment = await prisma.cohortEnrollment.findUnique({ where: {
        cohortId_userId: { cohortId: cohort.body.id, userId: student.id },
      } });
      expect((await request(app).delete(`${rosterPath}/${enrollment.id}`).set(as(owner))).status).toBe(204);
      expect((await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: initialCode })).status).toBe(409);
      expect((await request(app).post(`${rosterPath}/${enrollment.id}/reactivate`).set(as(owner))).status).toBe(200);
      expect((await request(app).get('/api/v1/progress/me').set(as(student))).body[0].completed).toBe(1);

      const rotated = await request(app).post(`/api/v1/cohorts/${cohort.body.id}/join-code/rotate`).set(as(owner));
      expect(rotated.status).toBe(200);
      expect(rotated.body.invite_code).toHaveLength(43);
      expect((await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: initialCode })).status).toBe(404);
      expect((await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: rotated.body.invite_code })).status).toBe(200);
      const revoked = await request(app).delete(`/api/v1/cohorts/${cohort.body.id}/join-code`).set(as(owner));
      expect(revoked.status).toBe(204);
      const revokedJoin = await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: rotated.body.invite_code });
      expect(revokedJoin.status).toBe(404);
      expect(revokedJoin.body.error.message).toBe(invalid.body.error.message);

      const replacement = await request(app).post(`/api/v1/cohorts/${cohort.body.id}/join-code/rotate`).set(as(owner));
      expect(replacement.status).toBe(200);
      await prisma.cohort.update({ where: { id: cohort.body.id }, data: {
        inviteCodeExpiresAt: new Date(Date.now() - 1000),
      } });
      expect((await request(app).post('/api/v1/cohorts/join').set(as(student))
        .send({ invite_code: replacement.body.invite_code })).status).toBe(404);
      expect((await request(app).get(`/api/v1/organizations/${organization.id}/cohorts`).set(as(owner)))
        .body[0].join_code_status).toBe('expired');

      expect((await request(app).post(`${roadmapPath}/${roadmap.body.id}/versions/${roadmap.body.version_id}/archive`)
        .set(as(owner))).status).toBe(200);
      expect((await request(app).get('/api/v1/progress/me').set(as(student))).body[0])
        .toMatchObject({ cohort_id: cohort.body.id, completed: 1, total: 1 });
      stored = await prisma.cohort.findUnique({ where: { id: cohort.body.id } });
      expect(stored.roadmapVersionId).toBe(roadmap.body.version_id);
    } finally {
      await removeTestOrganizations(prisma, organizationIds, userIds);
      await prisma.$disconnect();
    }
  }, 45_000);
});
