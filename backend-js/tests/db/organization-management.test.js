import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, test } from 'vitest';
import { errorHandler } from '../../src/core/errors.js';
import { createPrismaClient } from '../../src/db/client.js';
import { registerLearningRoutes } from '../../src/modules/learning/routes.js';

describe.skipIf(!(process.env.OUTPOST_DATABASE_URL || process.env.DATABASE_URL))('PostgreSQL organization management', () => {
  test('keeps invitations, membership changes, and ownership within the tenant', async () => {
    const prisma = createPrismaClient();
    const suffix = randomUUID().replaceAll('-', '');
    const users = [];
    const organizations = [];
    const createUser = async (label, accountType = 'coordinator', verified = true) => {
      const row = await prisma.user.create({ data: {
        displayName: label, username: `phase12_${label}_${suffix}`,
        primaryEmail: `phase12_${label}_${suffix}@example.edu`,
        emailVerifiedAt: verified ? new Date() : null, accountType,
      } });
      users.push(row.id);
      return row;
    };
    try {
      const firstOwner = await createUser('owner');
      const newOwner = await createUser('newowner');
      const parallelRecipient = await createUser('parallel');
      const outsider = await createUser('outsider');
      const app = express();
      app.use(express.json());
      const requireUser = async (req, _res, next) => {
        try {
          const user = await prisma.user.findUnique({ where: { id: req.get('X-Test-User') } });
          req.user = { id: user.id, account_type: user.accountType };
          next();
        } catch (error) { next(error); }
      };
      registerLearningRoutes(app, { prisma, settings: {}, requireUser });
      app.use(errorHandler);
      const as = (user) => ({ 'X-Test-User': user.id });
      const created = await request(app).post('/api/v1/organizations').set(as(firstOwner)).send({ name: `Campus ${suffix}` });
      expect(created.status).toBe(201);
      organizations.push(created.body.id);
      const other = await request(app).post('/api/v1/organizations').set(as(outsider)).send({ name: `Other ${suffix}` });
      expect(other.status).toBe(201);
      organizations.push(other.body.id);
      const path = `/api/v1/organizations/${created.body.id}`;
      expect((await request(app).get(`${path}/members`).set(as(newOwner))).status).toBe(403);
      const issued = await request(app).post(`${path}/invitations`).set(as(firstOwner))
        .send({ email: newOwner.primaryEmail, role: 'mentor' });
      expect(issued.status).toBe(201);
      expect((await request(app).get(`${path}/invitations`).set(as(firstOwner))).body[0]).not.toHaveProperty('code');
      const stored = await prisma.organizationInvitation.findFirst({ where: { organizationId: created.body.id } });
      expect(stored.tokenHash).not.toBe(issued.body.code);
      expect((await request(app).post('/api/v1/organization-invitations/accept').set(as(outsider))
        .send({ code: issued.body.code })).status).toBe(403);
      const accepted = await request(app).post('/api/v1/organization-invitations/accept').set(as(newOwner))
        .send({ code: issued.body.code });
      expect(accepted.status).toBe(200);
      expect((await request(app).post('/api/v1/organization-invitations/accept').set(as(newOwner))
        .send({ code: issued.body.code })).status).toBe(404);
      const parallelInvite = await request(app).post(`${path}/invitations`).set(as(firstOwner))
        .send({ email: parallelRecipient.primaryEmail, role: 'coordinator' });
      expect(parallelInvite.status).toBe(201);
      const accepts = await Promise.all([1, 2].map(() => request(app)
        .post('/api/v1/organization-invitations/accept').set(as(parallelRecipient))
        .send({ code: parallelInvite.body.code })));
      expect(accepts.map((result) => result.status).sort()).toEqual([200, 404]);
      expect(await prisma.organizationMembership.count({ where: {
        organizationId: created.body.id, userId: parallelRecipient.id,
      } })).toBe(1);
      const membership = await prisma.organizationMembership.findFirst({
        where: { organizationId: created.body.id, userId: newOwner.id },
      });
      expect(membership.role).toBe('mentor');
      expect((await request(app).patch(`/api/v1/organizations/${other.body.id}/members/${membership.id}`)
        .set(as(outsider)).send({ status: 'inactive' })).status).toBe(404);
      expect((await request(app).patch(`${path}/members/${membership.id}`).set(as(firstOwner))
        .send({ status: 'inactive' })).status).toBe(200);
      expect((await request(app).post(`${path}/ownership-transfer`).set(as(firstOwner))
        .send({ membership_id: membership.id })).status).toBe(409);
      expect((await request(app).patch(`${path}/members/${membership.id}`).set(as(firstOwner))
        .send({ status: 'active' })).status).toBe(200);
      expect((await request(app).post(`${path}/ownership-transfer`).set(as(firstOwner))
        .send({ membership_id: membership.id })).status).toBe(200);
      expect((await request(app).get(`${path}/members`).set(as(firstOwner))).status).toBe(403);
      expect((await request(app).get(`${path}/members`).set(as(newOwner))).status).toBe(200);
      expect(await prisma.organizationMembership.count({ where: { organizationId: created.body.id, role: 'owner' } })).toBe(1);
    } finally {
      await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
      await prisma.$disconnect();
    }
  }, 20_000);
});
