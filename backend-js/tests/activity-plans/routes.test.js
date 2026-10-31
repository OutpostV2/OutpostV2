import express from 'express';
import request from 'supertest';
import { expect, test } from 'vitest';
import { errorHandler } from '../../src/core/errors.js';
import { registerActivityPlanRoutes } from '../../src/modules/activity-plans/routes.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const planId = '00000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000003';
const bytes = Buffer.from('%PDF-1.7\nprivate');

function appFor(filename, storage = { getSource: async () => bytes }) {
  const app = express();
  const prisma = {
    organization: { findUnique: async () => ({ id: organizationId, status: 'active' }) },
    organizationMembership: { findFirst: async () => ({ role: 'owner', status: 'active' }) },
    activityPlan: { findUnique: async () => ({ id: planId, organizationId, filename, objectKey: 'private-source' }) },
  };
  const requireUser = (req, _res, next) => { req.user = { id: userId, account_type: 'coordinator' }; next(); };
  registerActivityPlanRoutes(app, { prisma, requireUser, storage });
  app.use(errorHandler);
  return app;
}

test('delivers Unicode filenames as a safe UTF-8 authenticated attachment', async () => {
  const response = await request(appFor('कार्यक्रम café.pdf')).get(`/api/v1/organizations/${organizationId}/activity-plans/${planId}/source`);
  expect(response.status).toBe(200);
  expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
  expect(response.headers['content-disposition']).toContain(encodeURIComponent('कार्यक्रम café.pdf'));
  expect(response.headers['cache-control']).toBe('private, no-store');
  expect(response.body).toEqual(bytes);
});

test('returns an actionable storage-unavailable error for a failed upload', async () => {
  const app = appFor('source.pdf', { putSource: async () => { throw new Error('Object store unavailable'); } });
  const response = await request(app).post(`/api/v1/organizations/${organizationId}/activity-plans`)
    .field('name', 'Activity plan').attach('file', bytes, { filename: 'source.pdf', contentType: 'application/pdf' });
  expect(response.status).toBe(503);
  expect(response.body.error).toMatchObject({ code: 'not_ready', message: 'Source PDF storage is temporarily unavailable. Try uploading again.' });
});
