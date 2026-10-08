import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';

test('source keys are tenant-scoped and contain no uploaded filename', async () => {
  const { sourceKey } = await import('../../src/modules/activity-plans/storage.js');
  const organizationId = randomUUID();
  const planId = randomUUID();
  const key = sourceKey(organizationId, planId);
  expect(key).toMatch(new RegExp(`^organizations/${organizationId}/activity-plans/${planId}/`));
  expect(key).toMatch(/\.pdf$/);
  expect(key).not.toContain('example');
});

describe.skipIf(!process.env.OUTPOST_OBJECT_ACCESS_KEY)('private MinIO activity-plan sources', () => {
  test('round-trips bytes and deletes only the chosen key', async () => {
    const { createObjectStorage, sourceKey } = await import('../../src/modules/activity-plans/storage.js');
    const storage = createObjectStorage({
      endpoint: process.env.OUTPOST_OBJECT_ENDPOINT,
      bucket: process.env.OUTPOST_OBJECT_BUCKET,
      accessKey: process.env.OUTPOST_OBJECT_ACCESS_KEY,
      secretKey: process.env.OUTPOST_OBJECT_SECRET_KEY,
    });
    await storage.ensureBucket();
    const key = sourceKey(randomUUID(), randomUUID());
    const bytes = Buffer.from('%PDF-1.7\nprivate activity plan');
    try {
      await storage.putSource(key, bytes);
      expect(await storage.getSource(key)).toEqual(bytes);
    } finally {
      await storage.deleteSource(key);
    }
    await expect(storage.getSource(key)).rejects.toThrow();
  });
});
