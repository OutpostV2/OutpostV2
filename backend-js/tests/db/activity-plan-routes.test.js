import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, test } from 'vitest';
import { errorHandler } from '../../src/core/errors.js';
import { createPrismaClient } from '../../src/db/client.js';
import { createObjectStorage } from '../../src/modules/activity-plans/storage.js';
import { processQueuedPlan } from '../../src/modules/activity-plans/worker.js';
import { removeTestOrganizations } from './cleanup.js';

async function sourcePdf() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage();
  ['Module 1: Foundations', 'Week 1: Orientation', '1. Set goals']
    .forEach((line, index) => page.drawText(line, { x: 40, y: 700 - index * 20, font }));
  return Buffer.from(await document.save());
}

describe.skipIf(!process.env.OUTPOST_DATABASE_URL || !process.env.OUTPOST_OBJECT_ACCESS_KEY)(
  'activity-plan API in PostgreSQL and MinIO', () => {
    test('protects source, detects stale review, and converts only once to a draft', async () => {
      const { registerActivityPlanRoutes } = await import('../../src/modules/activity-plans/routes.js');
      const prisma = createPrismaClient();
      const storage = createObjectStorage({
        endpoint: process.env.OUTPOST_OBJECT_ENDPOINT,
        bucket: process.env.OUTPOST_OBJECT_BUCKET,
        accessKey: process.env.OUTPOST_OBJECT_ACCESS_KEY,
        secretKey: process.env.OUTPOST_OBJECT_SECRET_KEY,
      });
      const suffix = randomUUID().replaceAll('-', '');
      const owner = await prisma.user.create({ data: { displayName: 'Plan Owner', username: `plan_owner_${suffix}`, accountType: 'coordinator' } });
      const outsider = await prisma.user.create({ data: { displayName: 'Outsider', username: `plan_other_${suffix}`, accountType: 'coordinator' } });
      const organization = await prisma.organization.create({ data: { name: 'Plan Org', slug: `plan-${suffix}` } });
      await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: owner.id, role: 'owner' } });
      const app = express();
      app.use(express.json());
      const requireUser = (req, _res, next) => {
        req.user = req.get('X-Actor') === 'other'
          ? { id: outsider.id, account_type: 'coordinator' }
          : { id: owner.id, account_type: 'coordinator' };
        next();
      };
      registerActivityPlanRoutes(app, { prisma, requireUser, storage });
      app.use(errorHandler);
      const base = `/api/v1/organizations/${organization.id}/activity-plans`;
      try {
        await storage.ensureBucket();
        const bytes = await sourcePdf();
        const uploaded = await request(app).post(base).field('name', 'Career plan')
          .attach('file', bytes, { filename: 'source.pdf', contentType: 'application/pdf' });
        expect(uploaded.status, JSON.stringify(uploaded.body)).toBe(201);
        expect(uploaded.body.status).toBe('queued');
        const path = `${base}/${uploaded.body.id}`;
        expect((await request(app).get(path).set('X-Actor', 'other')).status).toBe(403);
        expect((await request(app).get(`${path}/source`).set('X-Actor', 'other')).status).toBe(403);
        expect(await processQueuedPlan(prisma, storage)).toBe(uploaded.body.id);
        const plan = (await request(app).get(path)).body;
        expect(plan.status).toBe('ready');
        expect(plan.pages[0].text).toContain('Set goals');
        const source = await request(app).get(`${path}/source`);
        expect(source.status).toBe(200);
        expect(source.headers['x-content-type-options']).toBe('nosniff');
        expect(source.headers['content-disposition']).toContain('attachment');
        expect(source.body).toEqual(bytes);

        const unlinked = structuredClone(plan.review_items);
        unlinked.find((item) => item.text.includes('Set goals')).topic_id = null;
        expect((await request(app).patch(path).send({
          revision: plan.revision, name: plan.name,
          proposal: plan.proposal, review_items: unlinked,
          review_confirmed: true,
        })).status).toBe(422);

        const revised = await request(app).patch(path).send({
          revision: plan.revision, name: plan.name,
          proposal: plan.proposal, review_items: plan.review_items,
          review_confirmed: true,
        });
        expect(revised.status).toBe(200);
        expect((await request(app).patch(path).send({
          revision: plan.revision, name: plan.name,
          proposal: plan.proposal, review_items: plan.review_items,
          review_confirmed: true,
        })).status).toBe(409);
        const converted = await request(app).post(`${path}/convert`)
          .send({ revision: revised.body.revision });
        expect(converted.status).toBe(201);
        expect(converted.body.version_number).toBe(1);
        expect((await request(app).post(`${path}/convert`).send({ revision: revised.body.revision })).body)
          .toEqual(converted.body);
        const version = await prisma.roadmapVersion.findUnique({ where: { id: converted.body.version_id } });
        expect(version.status).toBe('draft');
      } finally {
        const plans = await prisma.activityPlan.findMany({ where: { organizationId: organization.id } });
        await prisma.activityPlan.deleteMany({ where: { organizationId: organization.id } });
        for (const plan of plans) await storage.deleteSource(plan.objectKey);
        await removeTestOrganizations(prisma, [organization.id], [owner.id, outsider.id]);
        await prisma.$disconnect();
        await storage.close();
      }
    }, 60_000);
  });
