import { expect, test } from 'vitest';
import { loadSettings } from '../../src/core/config.js';

test('object storage settings remain server-side', () => {
  const settings = loadSettings({
    OUTPOST_ENV: 'test', OUTPOST_DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    OUTPOST_OBJECT_ENDPOINT: 'http://localhost:9000',
    OUTPOST_OBJECT_BUCKET: 'activity-plans',
    OUTPOST_OBJECT_ACCESS_KEY: 'private-access',
    OUTPOST_OBJECT_SECRET_KEY: 'private-secret',
  });
  expect(settings.objectStorage).toEqual({
    endpoint: 'http://localhost:9000', bucket: 'activity-plans',
    accessKey: 'private-access', secretKey: 'private-secret',
  });
});
